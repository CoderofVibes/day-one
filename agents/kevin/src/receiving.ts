// Delivery and QC (SPEC step 6, DEMO_SCRIPT steps 10–12). Tommy's packing slip is matched
// against the PO and against the supplier lot the supplier named on chain with `mark_shipped`;
// only a full match is confirmed, with Tommy's own key through the relayer, and the delivery
// becomes a new lot in quarantine. Priya's decision goes to the contract the same way: a
// release pays the supplier from escrow, a rejection returns the money to the plant budget.
// The contract decides who may do what; Kevin only reads the outcome.

import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import type { Ledger } from "@day-one/server/ledger/db";
import { appendLotEvent, type LedgerDb } from "@day-one/server/ledger/events";
import {
  lotBalances,
  lots,
  materials,
  poLines,
  purchaseOrders,
  qcDecisions,
  receipts,
  staff,
  vendors,
} from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { type AnchorItem, fingerprint } from "@day-one/server/records/anchors";
import { and, eq, like } from "drizzle-orm";

/** What Kevin reads off a packing slip. Quantities are in the material's base units. */
export interface PackingSlip {
  slipNo: string;
  poNo: string;
  vendorName: string;
  lines: {
    description: string;
    shippedBase: number;
    backorderedBase: number;
    supplierLot: string;
  }[];
  /** The photo, when there is one: its path and SHA-256. */
  file?: string;
  sha256?: string;
}

/** The parts of the contract's `PoRecord` this module reads. */
interface OnChainPo {
  status: string;
  supplier_lot: string | null;
}

export interface ChainContext {
  policyContract: string;
  now: string;
}

export interface ReceiveResult {
  status: "received" | "mismatch" | "refused" | "failed";
  sentences: string[];
  outcome?: LoggedOutcome;
  receiptId?: number;
  lotCodes: string[];
}

export interface QcResult {
  status: "released" | "rejected" | "payout_failed" | "refused" | "failed";
  sentences: string[];
  outcome?: LoggedOutcome;
}

const firstName = (name: string) => name.split(" ")[0] ?? name;

/** "700 kg" for mass (base mg), "2 ea" for counts. */
function formatQty(base: number, dimension: string) {
  if (dimension !== "mass") return `${base.toLocaleString("en-US")} ea`;
  const kg = (base / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `${kg} kg`;
}

/** "ASC-261116-01": material code, receipt date, then the next free number that day. */
function nextLotCode(db: LedgerDb, materialCode: string, now: string) {
  const prefix = `${materialCode}-${now.slice(2, 4)}${now.slice(5, 7)}${now.slice(8, 10)}-`;
  const taken = db
    .select({ code: lots.lotCode })
    .from(lots)
    .where(like(lots.lotCode, `${prefix}%`))
    .all().length;
  return `${prefix}${String(taken + 1).padStart(2, "0")}`;
}

function staffAccount(db: Ledger, staffId: number) {
  const person = db.select().from(staff).where(eq(staff.id, staffId)).get();
  if (!person?.nearAccountId) throw new Error(`staff ${staffId} has no NEAR account`);
  return { ...person, nearAccountId: person.nearAccountId };
}

export function loadPoWithLines(db: Ledger, poNo: string) {
  const row = db
    .select({ po: purchaseOrders, vendor: vendors })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(eq(purchaseOrders.poNo, poNo))
    .get();
  if (!row) throw new Error(`${poNo} does not exist`);
  const lines = db
    .select({ line: poLines, material: materials })
    .from(poLines)
    .innerJoin(materials, eq(materials.id, poLines.materialId))
    .where(eq(poLines.poId, row.po.id))
    .orderBy(poLines.lineNo)
    .all();
  return { ...row, lines };
}

/**
 * Matches the slip to the PO line by line: vendor, PO number, material, quantity and the
 * supplier lot recorded on chain. Returns one plain sentence per problem.
 */
export function matchPackingSlip(
  po: ReturnType<typeof loadPoWithLines>,
  slip: PackingSlip,
  onChain: OnChainPo | null,
): string[] {
  const problems: string[] = [];
  if (slip.poNo !== po.po.poNo) {
    problems.push(`The slip is for ${slip.poNo}, not ${po.po.poNo}.`);
  }
  if (slip.vendorName.trim().toLowerCase() !== po.vendor.name.toLowerCase()) {
    problems.push(
      `The slip is from ${slip.vendorName}, but ${po.po.poNo} is with ${po.vendor.name}.`,
    );
  }
  if (onChain?.status !== "Shipped") {
    problems.push(`${po.vendor.name} has not marked ${po.po.poNo} as shipped yet.`);
  }
  for (const { line, material } of po.lines) {
    const name = material.name.toLowerCase();
    const found = slip.lines.find((l) => l.description.trim().toLowerCase().startsWith(name));
    if (!found) {
      problems.push(`No ${name} on the slip.`);
      continue;
    }
    const diff = found.shippedBase - line.qtyBase;
    if (diff < 0) {
      const short = formatQty(-diff, material.dimension);
      problems.push(
        found.backorderedBase > 0
          ? `Short ${short} against ${po.po.poNo}; the slip shows ${formatQty(found.backorderedBase, material.dimension)} back-ordered.`
          : `Short ${short} against ${po.po.poNo}.`,
      );
    } else if (diff > 0) {
      problems.push(`${formatQty(diff, material.dimension)} more than ${po.po.poNo} ordered.`);
    }
    if (onChain?.supplier_lot && found.supplierLot !== onChain.supplier_lot) {
      problems.push(
        `Supplier lot ${found.supplierLot} on the slip, but ${po.vendor.name} shipped ${onChain.supplier_lot}.`,
      );
    }
  }
  return problems;
}

/** Tommy's packing slip: match it, confirm on chain, post the lots in quarantine. */
export async function receiveDelivery(
  db: Ledger,
  chain: ChainClient,
  input: { slip: PackingSlip; receiverStaffId: number },
  ctx: ChainContext,
): Promise<ReceiveResult> {
  const { slip } = input;
  const po = loadPoWithLines(db, slip.poNo);
  const receiver = staffAccount(db, input.receiverStaffId);
  const onChain = (await chain.view({
    contractId: ctx.policyContract,
    method: "get_po",
    args: { po_id: po.po.poNo },
  })) as OnChainPo | null;

  const receipt = {
    poId: po.po.id,
    facilityId: po.po.shipToFacilityId,
    packingSlipFile: slip.file ?? null,
    packingSlipSha256: slip.sha256 ?? null,
    receivedBy: receiver.id,
    receivedAt: ctx.now,
  };
  const problems = matchPackingSlip(po, slip, onChain);
  if (problems.length) {
    const row = db
      .insert(receipts)
      .values({ ...receipt, matchStatus: "mismatch", mismatchNotes: problems.join(" ") })
      .returning()
      .get();
    return {
      status: "mismatch",
      receiptId: row.id,
      lotCodes: [],
      sentences: [...problems, `Receipt of ${po.po.poNo} is on hold until someone decides.`],
    };
  }

  const outcome = await chain.call({
    kind: "confirm_receipt",
    signerId: receiver.nearAccountId,
    predecessorId: receiver.nearAccountId,
    receiverId: ctx.policyContract,
    method: "confirm_receipt",
    args: { po_id: po.po.poNo },
    viaRelayer: true,
    related: { type: "purchase_order", id: po.po.id },
  });
  if (outcome.status !== "success") {
    return {
      status: outcome.status,
      outcome,
      lotCodes: [],
      sentences: [
        outcome.status === "refused"
          ? `Receipt of ${po.po.poNo} was refused: ${outcome.errorMessage}`
          : `Receipt of ${po.po.poNo} did not go through; please try again in a minute.`,
      ],
    };
  }

  const posted = db.transaction((tx) => {
    const row = tx
      .insert(receipts)
      .values({ ...receipt, matchStatus: "matched" })
      .returning()
      .get();
    const posted = po.lines.map(({ line, material }) => {
      const slipLine = slip.lines.find((l) =>
        l.description.trim().toLowerCase().startsWith(material.name.toLowerCase()),
      );
      const lotCode = nextLotCode(tx, material.code, ctx.now);
      const lot = tx
        .insert(lots)
        .values({
          lotCode,
          materialId: material.id,
          vendorId: po.vendor.id,
          vendorLotCode: slipLine?.supplierLot ?? null,
          poLineId: line.id,
        })
        .returning()
        .get();
      const event = {
        lotId: lot.id,
        facilityId: po.po.shipToFacilityId,
        refType: "po" as const,
        refId: po.po.id,
        actorType: "staff" as const,
        actorId: receiver.id,
        occurredAt: ctx.now,
      };
      appendLotEvent(tx, { ...event, kind: "received", qtyDeltaBase: line.qtyBase });
      appendLotEvent(tx, { ...event, kind: "quarantined", qtyDeltaBase: 0 });
      return { lotCode, line, material, supplierLot: slipLine?.supplierLot ?? "" };
    });
    tx.update(purchaseOrders)
      .set({ status: "received" })
      .where(eq(purchaseOrders.id, po.po.id))
      .run();
    return { receiptId: row.id, posted };
  });

  const what = posted.posted
    .map(
      (p) =>
        `${formatQty(p.line.qtyBase, p.material.dimension)} ${p.material.name.toLowerCase()}, supplier lot ${p.supplierLot}`,
    )
    .join("; ");
  const lotCodes = posted.posted.map((p) => p.lotCode);
  const lotsText =
    lotCodes.length === 1 ? `Lot ${lotCodes[0]} is` : `Lots ${lotCodes.join(", ")} are`;
  return {
    status: "received",
    outcome,
    receiptId: posted.receiptId,
    lotCodes,
    sentences: [
      `${firstName(receiver.name)} photographed the packing slip. Matches ${po.po.poNo}: ${what}. ${lotsText} in quarantine.`,
    ],
  };
}

/** Priya's QC decision on a quarantined lot from a PO. */
export async function decideQc(
  db: Ledger,
  chain: ChainClient,
  input: {
    lotCode: string;
    decision: "release" | "reject";
    qcStaffId: number;
    reason?: string | undefined;
  },
  ctx: ChainContext,
): Promise<QcResult> {
  const row = db
    .select({ lot: lots, po: purchaseOrders, vendor: vendors })
    .from(lots)
    .innerJoin(poLines, eq(poLines.id, lots.poLineId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(eq(lots.lotCode, input.lotCode))
    .get();
  if (!row) throw new Error(`${input.lotCode} is not a lot from a purchase order`);
  const { lot, po, vendor } = row;
  if (lot.state !== "quarantine") {
    return { status: "refused", sentences: [`Lot ${lot.lotCode} is not in quarantine.`] };
  }
  const qc = staffAccount(db, input.qcStaffId);
  const release = input.decision === "release";
  const reason = input.reason?.trim() || "Failed incoming QC.";

  const outcome = await chain.call({
    kind: release ? "qc_release" : "qc_reject",
    signerId: qc.nearAccountId,
    predecessorId: qc.nearAccountId,
    receiverId: ctx.policyContract,
    method: release ? "qc_release" : "qc_reject",
    args: release ? { po_id: po.poNo } : { po_id: po.poNo, reason },
    viaRelayer: true,
    related: { type: "purchase_order", id: po.id },
  });
  const who = firstName(qc.name);
  if (outcome.status !== "success") {
    return {
      status: outcome.status,
      outcome,
      sentences: [
        outcome.status === "refused"
          ? `QC decision on lot ${lot.lotCode} was refused: ${outcome.errorMessage}`
          : `QC decision on lot ${lot.lotCode} did not go through; please try again in a minute.`,
      ],
    };
  }
  // A release is two steps on chain: the payout, then a callback that records whether it
  // landed. The transaction succeeds either way; the callback's event says which.
  if (release && !outcome.events.some((e) => e.event === "po_released")) {
    return {
      status: "payout_failed",
      outcome,
      sentences: [
        `${who} released lot ${lot.lotCode}, but the payment to ${vendor.name} did not go through. The money is still held; release again to retry.`,
      ],
    };
  }

  const amount = formatUsd(BigInt(po.totalUsdc));
  const event = {
    lotId: lot.id,
    facilityId: lot.currentFacilityId ?? po.shipToFacilityId,
    refType: "qc" as const,
    refId: po.id,
    actorType: "staff" as const,
    actorId: qc.id,
    occurredAt: ctx.now,
  };
  db.transaction((tx) => {
    tx.insert(qcDecisions)
      .values({
        lotId: lot.id,
        poId: po.id,
        decision: release ? "released" : "rejected",
        decidedBy: qc.id,
        decidedAt: ctx.now,
        chainTxId: outcome.id,
      })
      .run();
    if (release) {
      appendLotEvent(tx, { ...event, kind: "released", qtyDeltaBase: 0 });
    } else {
      appendLotEvent(tx, { ...event, kind: "rejected", qtyDeltaBase: 0, reason });
      const onHand =
        tx
          .select({ qty: lotBalances.onHandBase })
          .from(lotBalances)
          .where(and(eq(lotBalances.lotId, lot.id), eq(lotBalances.facilityId, event.facilityId)))
          .get()?.qty ?? 0;
      if (onHand > 0) {
        appendLotEvent(tx, {
          ...event,
          kind: "wasted",
          qtyDeltaBase: -onHand,
          reason: `Returned to ${vendor.name}.`,
        });
      }
    }
    tx.update(purchaseOrders)
      .set({ status: release ? "paid" : "rejected" })
      .where(eq(purchaseOrders.id, po.id))
      .run();
  });

  return release
    ? {
        status: "released",
        outcome,
        sentences: [`${who} released lot ${lot.lotCode}.`, `${po.poNo} — paid ${amount}.`],
      }
    : {
        status: "rejected",
        outcome,
        sentences: [
          `${who} rejected lot ${lot.lotCode}: ${reason}`,
          `${po.poNo} refunded: ${amount} is back in the plant budget, and the lot goes back to ${vendor.name}.`,
        ],
      };
}

/**
 * A matched receipt as an anchorable record: what arrived, against which PO, from which
 * slip photo, and the lots it became. The salt keeps the fingerprint unguessable.
 */
export function receiptAnchorItem(db: Ledger, receiptId: number, salt: string): AnchorItem {
  const row = db
    .select({ receipt: receipts, po: purchaseOrders })
    .from(receipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, receipts.poId))
    .where(eq(receipts.id, receiptId))
    .get();
  if (row?.receipt.matchStatus !== "matched") {
    throw new Error(`receipt ${receiptId} is not a matched receipt`);
  }
  const received = db
    .select({ lot: lots.lotCode, supplierLot: lots.vendorLotCode, material: materials.code })
    .from(lots)
    .innerJoin(poLines, eq(poLines.id, lots.poLineId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(eq(poLines.poId, row.po.id))
    .orderBy(lots.lotCode)
    .all();
  const record = {
    po_no: row.po.poNo,
    po_hash: row.po.poHash,
    packing_slip_sha256: row.receipt.packingSlipSha256,
    received_at: row.receipt.receivedAt,
    lots: received,
  };
  return {
    kind: "receipt",
    refId: `RCV-${row.po.poNo}`,
    hash: fingerprint(record, salt),
    prev: null,
    ledger: { refId: receiptId },
  };
}
