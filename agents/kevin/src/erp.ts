// Where Kevin's workflow talks to the acquirer's ERP (docs/ERP.md §3.7). Each hook posts one
// Day One record through the connector by its ID and returns the one line the behind-the-
// curtain view prints as `erp:`. The ERP never decides a spending limit: the contract has
// already answered by the time a PO is mirrored, and the ERP records that answer.

import { poMirrorOf } from "@day-one/server/erp-connector/sync";
import type { BillResult, ErpConnector, PayeeCheck } from "@day-one/server/erp-connector/types";
import type { Ledger } from "@day-one/server/ledger/db";
import {
  batchInputs,
  batchRecords,
  facilities,
  lots,
  materials,
  poLines,
  purchaseOrders,
  receipts,
  vendors,
} from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { and, asc, eq } from "drizzle-orm";
import type { InvoiceReading } from "./invoices.ts";
import type { SubmittablePo } from "./submit.ts";

const usd = (units: number | bigint) => formatUsd(BigInt(units));
const short = (tx: string | null | undefined) => (tx ? `${tx.slice(0, 8)}…` : "none");

function qtyText(base: number, dimension: string) {
  if (dimension !== "mass") return `${base.toLocaleString("en-US")} ea`;
  return `${(base / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} kg`;
}

export class KevinErp {
  constructor(readonly connector: ErpConnector) {}

  get system() {
    return this.connector.system;
  }

  /** Step 2: the confirmed batch record's draws become one issue to production. */
  async batchConfirmed(db: Ledger, batchId: number): Promise<string> {
    const batch = db.select().from(batchRecords).where(eq(batchRecords.id, batchId)).get();
    if (!batch) throw new Error(`erp: batch ${batchId} missing`);
    const facility = db.select().from(facilities).where(eq(facilities.id, batch.facilityId)).get();
    const inputs = db
      .select({ input: batchInputs, lot: lots, material: materials })
      .from(batchInputs)
      .innerJoin(lots, eq(lots.id, batchInputs.lotId))
      .innerJoin(materials, eq(materials.id, lots.materialId))
      .where(eq(batchInputs.batchId, batchId))
      .orderBy(asc(batchInputs.id))
      .all();
    const ref = await this.connector.postInventoryMovement({
      kind: "production",
      ref: `batch:${batch.batchNo}`,
      facilityCode: facility?.code ?? "",
      date: (batch.confirmedAt ?? batch.completedAt ?? "").slice(0, 10),
      memo: `Batch record ${batch.batchNo}`,
      lines: inputs.map(({ input, lot, material }) => ({
        materialCode: material.code,
        lotCode: lot.lotCode,
        qtyBase: -input.actualBase,
        status: "good",
      })),
    });
    const kg = inputs.reduce(
      (s, i) => s + (i.material.dimension === "mass" ? i.input.actualBase : 0),
      0,
    );
    return `erp: inventoryAdjustment ${ref.tranId} — ${batch.batchNo} issued to production: ${inputs.length} lots, ${qtyText(kg, "mass")}, by Day One lot ID${ref.created ? "" : " (already posted)"}`;
  }

  /** Before `submit_po`: the vendor is approved in the ERP and its verified payout account is the one the contract would pay. */
  async checkPayee(po: SubmittablePo): Promise<{ check: PayeeCheck; line: string }> {
    const check = await this.connector.verifyPayee({
      vendorCode: po.vendor.code,
      account: po.vendor.account,
    });
    const line = check.ok
      ? `erp: vendor ${check.vendor?.code ?? po.vendor.code} ${po.vendor.name} is approved; payout account matches the vendor master`
      : `erp: vendor check for ${po.poNo} failed (${check.code}): ${check.message}`;
    return { check, line };
  }

  /** After the contract answered a `submit_po`: mirror the PO by number with the verdict and tx hashes. */
  async poSubmitted(db: Ledger, poId: number): Promise<string> {
    const po = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).get();
    if (!po) throw new Error(`erp: PO ${poId} missing`);
    const mirror = poMirrorOf(db, po);
    const ref = await this.connector.pushPurchaseOrder(mirror);
    const verdict =
      mirror.verdict === "funded"
        ? `funded (tx ${short(mirror.fundingTx)})${mirror.approvalTx ? `, approved on chain by ${mirror.approvedBy} (tx ${short(mirror.approvalTx)})` : ""}`
        : mirror.verdict === "awaitingApproval"
          ? "refused pending the director's approval"
          : mirror.verdict;
    const rule = /^Rule (\d+)/.exec(ref.note ?? "")?.[1];
    return `erp: purchaseOrder ${po.poNo} ${ref.created ? "mirrored" : "updated"} — contract verdict: ${verdict}; ERP approval ${ref.approvalStatus ?? "?"}${rule ? ` (matrix rule ${rule})` : ""}`;
  }

  /** Step 10: the matched receipt becomes an item receipt into quarantine, lot by lot. */
  async received(db: Ledger, receiptId: number): Promise<string> {
    const row = db
      .select({ receipt: receipts, po: purchaseOrders })
      .from(receipts)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, receipts.poId))
      .where(eq(receipts.id, receiptId))
      .get();
    if (!row) throw new Error(`erp: receipt ${receiptId} missing`);
    const lines = db
      .select({ lot: lots, line: poLines, material: materials })
      .from(lots)
      .innerJoin(poLines, eq(poLines.id, lots.poLineId))
      .innerJoin(materials, eq(materials.id, lots.materialId))
      .where(eq(poLines.poId, row.po.id))
      .orderBy(asc(poLines.lineNo))
      .all();
    const ref = await this.connector.postItemReceipt({
      poNo: row.po.poNo,
      ref: `RCV-${row.po.poNo}`,
      date: row.receipt.receivedAt.slice(0, 10),
      lines: lines.map(({ lot, line }) => ({
        poLine: line.lineNo,
        qtyBase: line.qtyBase,
        lotCode: lot.lotCode,
      })),
      memo: row.receipt.packingSlipFile ? `Packing slip ${row.receipt.packingSlipFile}` : null,
    });
    const what = lines
      .map(
        ({ lot, line, material }) =>
          `${qtyText(line.qtyBase, material.dimension)} ${material.code} lot ${lot.lotCode}`,
      )
      .join("; ");
    return `erp: itemReceipt ${ref.tranId} — ${row.po.poNo}: ${what} into quarantine, accrued at the PO price`;
  }

  /** The supplier's invoice, as Kevin read it, handed to the ERP for the 3-way match. */
  async invoiceRead(
    db: Ledger,
    reading: InvoiceReading,
  ): Promise<{ bill: BillResult | null; line: string }> {
    const po = db
      .select({ po: purchaseOrders, vendor: vendors })
      .from(purchaseOrders)
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .where(eq(purchaseOrders.poNo, reading.po_number))
      .get();
    if (!po)
      return {
        bill: null,
        line: `erp: vendorBill ${reading.invoice_no || "(no number)"} not posted: Kevin has no ${reading.po_number || "PO"}`,
      };
    const lines = db
      .select({ line: poLines, material: materials })
      .from(poLines)
      .innerJoin(materials, eq(materials.id, poLines.materialId))
      .where(eq(poLines.poId, po.po.id))
      .orderBy(asc(poLines.lineNo))
      .all();
    const money = (text: string) => {
      const m = /-?[\d,]+(?:\.\d+)?/.exec(text.replace(/\s/g, ""));
      return m ? Math.round(Number(m[0].replaceAll(",", "")) * 1_000_000) : 0;
    };
    const bill = await this.connector.postVendorBill({
      invoiceNo: reading.invoice_no,
      vendorCode: po.vendor.code,
      poNo: po.po.poNo,
      date: po.po.needBy?.slice(0, 10) ?? "2026-11-16",
      freightUsdc: money(reading.freight || "0"),
      totalUsdc: money(reading.total),
      lines: reading.lines.map((l, i) => {
        const target = lines[i];
        const perUnit = target?.material.dimension === "mass" ? 1_000_000 : 1;
        return {
          materialCode: target?.material.code ?? "",
          description: l.description,
          qtyBase: Math.round(Number(l.quantity.replaceAll(",", "")) * perUnit),
          unitPriceUsdc: money(l.unit_price),
          extendedUsdc: money(l.amount),
          poLine: target?.line.lineNo ?? null,
        };
      }),
    });
    const match =
      bill.matchStatus === "matched"
        ? "matched (bill = PO = receipt, within tolerance)"
        : bill.matchStatus === "duplicate"
          ? `duplicate of ${bill.duplicateOf}`
          : `exception: ${bill.exceptions.map((e) => e.code).join(", ")}`;
    const approval =
      bill.approvalStatus === "approved"
        ? "approved for payment"
        : bill.approvalStatus === "rejected"
          ? "rejected"
          : "held for Marcy";
    return {
      bill,
      line: `erp: vendorBill ${bill.invoiceNo} — ${usd(bill.totalUsdc)} against ${po.po.poNo}: 3-way match ${match}; ${approval}`,
    };
  }

  /** Step 11: QC's decision changes the lot's status; a release's payout is written back as the payment. */
  async qcDecided(
    db: Ledger,
    input: {
      lotCode: string;
      poNo: string;
      decision: "release" | "reject";
      reason?: string | undefined;
      txHash: string | null;
      explorerUrl: string | null;
      at: string;
    },
  ): Promise<string[]> {
    const row = db
      .select({
        lot: lots,
        material: materials,
        facility: facilities,
        po: purchaseOrders,
        vendor: vendors,
      })
      .from(lots)
      .innerJoin(materials, eq(materials.id, lots.materialId))
      .innerJoin(poLines, eq(poLines.id, lots.poLineId))
      .innerJoin(
        purchaseOrders,
        and(eq(purchaseOrders.id, poLines.poId), eq(purchaseOrders.poNo, input.poNo)),
      )
      .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
      .innerJoin(facilities, eq(facilities.id, purchaseOrders.shipToFacilityId))
      .where(eq(lots.lotCode, input.lotCode))
      .get();
    if (!row) throw new Error(`erp: lot ${input.lotCode} on ${input.poNo} missing`);
    const change = await this.connector.postQcDecision({
      ref: `QC-${input.lotCode}`,
      poNo: input.poNo,
      lotCode: input.lotCode,
      materialCode: row.material.code,
      facilityCode: row.facility.code,
      decision: input.decision,
      reason: input.reason ?? null,
      date: input.at.slice(0, 10),
    });
    const lines = [
      input.decision === "release"
        ? `erp: inventoryStatusChange ${change.tranId} — lot ${input.lotCode} quarantine → good; ${qtyText(
            row.lot.id
              ? (db
                  .select()
                  .from(poLines)
                  .where(eq(poLines.id, row.lot.poLineId ?? 0))
                  .get()?.qtyBase ?? 0)
              : 0,
            row.material.dimension,
          )} ${row.material.code} available at ${row.facility.name}`
        : `erp: inventoryStatusChange ${change.tranId} — lot ${input.lotCode} rejected and returned to ${row.vendor.name}; the receipt is reversed`,
    ];
    if (input.decision === "release" && input.txHash) {
      const payment = await this.connector.recordPayment({
        ref: input.txHash,
        vendorCode: row.vendor.code,
        poNo: input.poNo,
        date: input.at.slice(0, 10),
        amountUsdc: row.po.totalUsdc,
        method: "escrowRelease",
        txHash: input.txHash,
        explorerUrl: input.explorerUrl,
        memo: `Escrow released on QC release of ${input.lotCode}`,
      });
      lines.push(
        payment.onAccount
          ? `erp: vendorPayment ${payment.tranId} — ${usd(row.po.totalUsdc)} to ${row.vendor.name} held on account: ${payment.reason}; settlement ref ${short(input.txHash)}`
          : `erp: vendorPayment ${payment.tranId} — ${usd(row.po.totalUsdc)} applied to ${payment.appliedTo}; settlement ref ${short(input.txHash)} (explorer link on the payment)`,
      );
    }
    return lines;
  }
}
