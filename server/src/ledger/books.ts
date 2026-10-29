// The bookkeeper pack (FEATURES_V2 §2), Day One's half of it: what Ruth imports into
// QuickBooks and what Kevin flags on the way. Pure reads over settled purchase orders, no
// writes and no chain calls. One CSV row per PO line, freight as its own line, so the Amount
// column sums to the settled total to the cent; a PO that is still escrowed, unreleased,
// cancelled or refunded never appears as paid. The price-drift alert compares each line's unit
// price with the vendor's trailing average for the material over earlier settled POs.
//
// Invoices are the acquirer ERP's records (OPEN_QUESTIONS #32: one owner per record), so the
// duplicate-invoice check lives in the ERP integration, not here.

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ledger } from "./db.ts";
import {
  anchors,
  chainTx,
  materials,
  poLines,
  purchaseOrders,
  qcDecisions,
  receipts,
  vendors,
} from "./schema.ts";

/** A unit price more than this far from the vendor's trailing price is flagged (10%). */
export const DRIFT_THRESHOLD_BP = 1000;
/** A PO is settled once QC released the delivery and the supplier was paid. */
const SETTLED = ["released", "paid"] as const;
const BASE = 1_000_000n;

export interface SettledLine {
  lineNo: number;
  material: string;
  name: string;
  qtyBase: number;
  dimension: string;
  unitPriceUsdc: number;
  extendedUsdc: number;
}

export interface SettledPo {
  id: number;
  poNo: string;
  vendor: string;
  vendorAccount: string | null;
  /** Plain dates, YYYY-MM-DD. */
  receivedOn: string | null;
  releasedOn: string | null;
  freightUsdc: number;
  totalUsdc: number;
  /** The transaction that paid the supplier from escrow; null for POs paid before Day One. */
  paymentRef: string | null;
  /** The transaction that anchored the receipt; null when the receipt was not anchored. */
  recordRef: string | null;
  lines: SettledLine[];
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

/** Settled POs in order of settlement, each with its lines, receipt and references. */
export function settledPurchaseOrders(db: Ledger): SettledPo[] {
  const txHash = (id: number | null) =>
    id === null
      ? null
      : (db.select({ hash: chainTx.txHash }).from(chainTx).where(eq(chainTx.id, id)).get()?.hash ??
        null);
  const pos = db
    .select({ po: purchaseOrders, vendor: vendors })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(inArray(purchaseOrders.status, [...SETTLED]))
    .orderBy(asc(purchaseOrders.id))
    .all();
  const settled = pos.map(({ po, vendor }) => {
    const receipt = db
      .select()
      .from(receipts)
      .where(eq(receipts.poId, po.id))
      .orderBy(asc(receipts.id))
      .get();
    const releases = db
      .select()
      .from(qcDecisions)
      .where(and(eq(qcDecisions.poId, po.id), eq(qcDecisions.decision, "released")))
      .orderBy(asc(qcDecisions.id))
      .all();
    const paid = releases.find((r) => r.chainTxId !== null) ?? releases.at(-1);
    const anchor = receipt
      ? db
          .select()
          .from(anchors)
          .where(and(eq(anchors.subjectType, "receipt"), eq(anchors.refId, receipt.id)))
          .get()
      : undefined;
    const lines = db
      .select({ line: poLines, material: materials })
      .from(poLines)
      .innerJoin(materials, eq(materials.id, poLines.materialId))
      .where(eq(poLines.poId, po.id))
      .orderBy(asc(poLines.lineNo))
      .all();
    return {
      id: po.id,
      poNo: po.poNo,
      vendor: vendor.name,
      vendorAccount: vendor.nearAccountId,
      receivedOn: day(receipt?.receivedAt),
      releasedOn: day(paid?.decidedAt),
      freightUsdc: po.freightUsdc,
      totalUsdc: po.totalUsdc,
      paymentRef: txHash(paid?.chainTxId ?? null),
      recordRef: txHash(anchor?.chainTxId ?? null),
      lines: lines.map(({ line, material }) => ({
        lineNo: line.lineNo,
        material: material.code,
        name: material.name,
        qtyBase: line.qtyBase,
        dimension: material.dimension,
        unitPriceUsdc: line.unitPriceUsdc,
        extendedUsdc: line.extendedUsdc,
      })),
    };
  });
  // Settlement order: when the delivery was released, then the PO itself.
  return settled.sort(
    (a, b) => (a.releasedOn ?? "").localeCompare(b.releasedOn ?? "") || a.id - b.id,
  );
}

/** USDC base units as a plain decimal for a spreadsheet: "1700.00", "0.021". */
export function plainDollars(units: number | bigint, minDecimals = 2): string {
  const n = BigInt(units);
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / BASE;
  let fraction = (abs % BASE).toString().padStart(6, "0");
  while (fraction.length > minDecimals && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return `${sign}${whole}.${fraction}`;
}

/** A quantity in base units as the inventory unit: kg to three decimals, or a count. */
export function plainQuantity(qtyBase: number, dimension: string) {
  if (dimension !== "mass") return { quantity: String(qtyBase), unit: "ea" };
  return { quantity: plainDollars(qtyBase, 3), unit: "kg" };
}

export const EXPORT_COLUMNS = [
  "PO",
  "Vendor",
  "Received",
  "Released",
  "Material",
  "Description",
  "Quantity",
  "Unit",
  "Unit price",
  "Amount",
  "Payment ref",
  "Record ref",
] as const;

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

/** One row per PO line, then one for the freight when the PO carried any. */
export function exportRows(settled: readonly SettledPo[]): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const po of settled) {
    const base = {
      PO: po.poNo,
      Vendor: po.vendor,
      Received: po.receivedOn ?? "",
      Released: po.releasedOn ?? "",
      "Payment ref": po.paymentRef ?? "",
      "Record ref": po.recordRef ?? "",
    };
    for (const line of po.lines) {
      const { quantity, unit } = plainQuantity(line.qtyBase, line.dimension);
      rows.push({
        ...base,
        Material: line.material,
        Description: line.name,
        Quantity: quantity,
        Unit: unit,
        "Unit price": plainDollars(line.unitPriceUsdc),
        Amount: plainDollars(line.extendedUsdc),
      });
    }
    if (po.freightUsdc > 0) {
      rows.push({
        ...base,
        Material: "",
        Description: "Freight",
        Quantity: "1",
        Unit: "",
        "Unit price": plainDollars(po.freightUsdc),
        Amount: plainDollars(po.freightUsdc),
      });
    }
  }
  return rows;
}

/** RFC 4180: comma separated, CRLF, a field quoted when it holds a comma, a quote or a newline. */
export function toCsv(rows: readonly ExportRow[]): string {
  const cell = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const lines = [
    EXPORT_COLUMNS.join(","),
    ...rows.map((row) => EXPORT_COLUMNS.map((c) => cell(row[c])).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export interface PriceDrift {
  poNo: string;
  vendor: string;
  material: string;
  name: string;
  unit: string;
  unitPriceUsdc: number;
  /** The vendor's quantity-weighted unit price over the earlier settled POs listed. */
  trailingUsdc: number;
  trailingPoNos: string[];
  /** Basis points above (positive) or below the trailing price. */
  driftBp: number;
  sentence: string;
}

const perUnit = (dimension: string) => (dimension === "mass" ? BASE : 1n);
const dollars = (units: number | bigint, unit: string) => `$${plainDollars(units)}/${unit}`;

/** Lines whose unit price is more than `thresholdBp` off the vendor's trailing price. */
export function priceDrift(
  settled: readonly SettledPo[],
  thresholdBp = DRIFT_THRESHOLD_BP,
): PriceDrift[] {
  const history = new Map<string, { qty: bigint; amount: bigint; poNos: string[] }>();
  const alerts: PriceDrift[] = [];
  for (const po of settled) {
    for (const line of po.lines) {
      const key = `${po.vendor}\u0000${line.material}`;
      const seen = history.get(key);
      const unit = perUnit(line.dimension);
      if (seen && seen.qty > 0n) {
        // Trailing price per inventory unit, rounded half up.
        const trailing = (seen.amount * unit * 2n + seen.qty) / (seen.qty * 2n);
        const driftBp = Number(((BigInt(line.unitPriceUsdc) - trailing) * 10_000n) / trailing);
        if (Math.abs(driftBp) > thresholdBp) {
          const { unit: unitName } = plainQuantity(line.qtyBase, line.dimension);
          const pct = `${(Math.abs(driftBp) / 100).toFixed(1)}%`;
          alerts.push({
            poNo: po.poNo,
            vendor: po.vendor,
            material: line.material,
            name: line.name,
            unit: unitName,
            unitPriceUsdc: line.unitPriceUsdc,
            trailingUsdc: Number(trailing),
            trailingPoNos: [...seen.poNos],
            driftBp,
            sentence:
              `${po.vendor} billed ${line.name.toLowerCase()} at ` +
              `${dollars(line.unitPriceUsdc, unitName)} on ${po.poNo}, ` +
              `${driftBp > 0 ? "up" : "down"} ${pct} on its ${dollars(trailing, unitName)} ` +
              `trailing price (${seen.poNos.join(", ")}). It was a real, received order, ` +
              "so it is in the export with both prices; worth a call before the next one.",
          });
        }
      }
      history.set(key, {
        qty: (seen?.qty ?? 0n) + BigInt(line.qtyBase),
        amount: (seen?.amount ?? 0n) + BigInt(line.extendedUsdc),
        poNos: [...(seen?.poNos ?? []), po.poNo],
      });
    }
  }
  return alerts;
}

export interface Books {
  settled: SettledPo[];
  rows: ExportRow[];
  columns: readonly string[];
  /** The sum of the settled POs, which the Amount column reconciles to. */
  totalUsdc: number;
  alerts: PriceDrift[];
  /** Kevin's note at the top of the export. */
  sentences: string[];
}

export function books(db: Ledger): Books {
  const settled = settledPurchaseOrders(db);
  const rows = exportRows(settled);
  const totalUsdc = settled.reduce((sum, po) => sum + po.totalUsdc, 0);
  const alerts = priceDrift(settled);
  const fromEscrow = settled.filter((po) => po.paymentRef).length;
  const n = settled.length;
  const sentences = [
    n === 0
      ? "No settled purchase orders yet."
      : `${n} settled purchase order${n === 1 ? "" : "s"}, $${withCommas(plainDollars(totalUsdc))}, ` +
        "each matched to a receipt" +
        (fromEscrow
          ? `; ${fromEscrow} paid from escrow on QC release, the rest by check before Day One.`
          : ", all paid by check before Day One."),
    ...alerts.map((a) => a.sentence),
  ];
  return { settled, rows, columns: EXPORT_COLUMNS, totalUsdc, alerts, sentences };
}

export function booksCsv(db: Ledger) {
  return toCsv(books(db).rows);
}

function withCommas(plain: string) {
  const [whole = "", fraction] = plain.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`;
}
