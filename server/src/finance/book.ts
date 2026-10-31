// One plant's money book from its twelve-month world (data/world/<plant>.json, docs/WORLD.md):
// the records money.ts reads, with each lot priced from its PO line and each bill matched to the
// payment that settled it.
//
// The world holds no bills for the anchor window (Jul 6 – Nov 16): the seed's POs are paid but
// their invoices live in the ERP. They are added here by the ERP's own rules, so the cash flow and
// AP aging have no gap: the bookkeeper pack's bills and checks as written (erp/src/seed/history.ts,
// the reissued OFH-3317-R held as a duplicate), the plant's earlier bills one day after receipt
// paid by check thirty days later (server/src/erp-connector/rebuild.ts earlierBills), and PO-1042's
// invoice NG-INV-24190 paid by the recorded escrow release on QC release.

import { AP_HISTORY_BILLS, AP_HISTORY_CHECKS } from "@day-one/erp/seed/history";
import { LIST_PRICE, MATERIALS } from "../seed/reference.ts";
import type { World } from "../world/index.ts";
import {
  addDays,
  type BillRec,
  type LotRec,
  landedCosts,
  type MoneyBook,
  type PaymentRec,
  type PoRec,
} from "./money.ts";

/** The invoice the recorded run's supplier sent for PO-1042 (data/attacks/invoices.json "genuine"). */
export const PO_1042_INVOICE = { invoiceNo: "NG-INV-24190", date: "2026-11-16" };

const category = new Map(MATERIALS.map((m) => [m.code, m.category as string]));
const uom = new Map(MATERIALS.map((m) => [m.code, m.uom as string]));

/** A material's list price per base unit: dollars per kg is USDC units per mg; per each, ×10⁶. */
function listCostPerBase(material: string): number {
  const price = LIST_PRICE[material] ?? 0;
  return uom.get(material) === "kg" ? price : price * 1_000_000;
}

/**
 * Each lot's cost per base unit: its PO line's landed cost; a lot without a PO (opening stock)
 * takes the last landed price paid for its material on or before it arrived, else the first after,
 * else the seed's list price.
 */
export function priceLots(world: Pick<World, "lots" | "pos">): LotRec[] {
  const line = new Map<string, number>();
  const paid: { material: string; at: string; cost: number }[] = [];
  for (const po of world.pos) {
    const costs = landedCosts(po.lines, po.freightUsdc);
    po.lines.forEach((l, i) => {
      const cost = costs[i] ?? 0;
      line.set(`${po.poNo}|${l.material}`, cost);
      paid.push({ material: l.material, at: po.orderedAt, cost });
    });
  }
  paid.sort((a, b) => (a.at < b.at ? -1 : 1));
  return world.lots.map((l) => {
    const own = l.poNo ? line.get(`${l.poNo}|${l.material}`) : undefined;
    const base = {
      lot: l.lot,
      material: l.material,
      category: category.get(l.material) ?? "excipient",
    };
    if (own !== undefined) return { ...base, costPerBase: own, costFrom: "po" as const };
    const same = paid.filter((p) => p.material === l.material);
    const before = same.filter((p) => p.at <= l.receivedAt).at(-1) ?? same[0];
    if (before) return { ...base, costPerBase: before.cost, costFrom: "last_price" as const };
    return { ...base, costPerBase: listCostPerBase(l.material), costFrom: "list_price" as const };
  });
}

/** The anchor window's bills and payments, by the ERP's rules (see the file's head). */
export function anchorPayables(world: Pick<World, "pos" | "receipts" | "escrow">) {
  const anchorPos = world.pos.filter((p) => p.era === "anchor");
  const mine = new Set(anchorPos.map((p) => p.poNo));
  const bills: BillRec[] = [];
  const payments: PaymentRec[] = [];
  const firstReceipt = new Map<string, string>();
  for (const r of world.receipts) {
    const prev = firstReceipt.get(r.poNo);
    if (!prev || r.receivedAt < prev) firstReceipt.set(r.poNo, r.receivedAt);
  }
  const pack = AP_HISTORY_BILLS.filter((b) => mine.has(b.poNo));
  const packPos = new Set(pack.map((b) => b.poNo));
  for (const po of anchorPos) {
    if (po.status !== "paid" || packPos.has(po.poNo) || po.poNo === "PO-1042") continue;
    const received = firstReceipt.get(po.poNo);
    if (!received) continue;
    const billDate = addDays(received, 1);
    const billNo = `${po.vendor}-${7_000 + Number(po.poNo.slice(3))}`;
    const paidAt = `${addDays(billDate, 30)}T10:00:00.000Z`;
    bills.push(bill(billNo, po.vendor, po.poNo, billDate, po.totalUsdc, paidAt, false));
    payments.push(pay(`Check for ${billNo}`, po.totalUsdc, paidAt, billNo, "check"));
  }
  const checks = new Map(AP_HISTORY_CHECKS.map((c) => [c.invoiceNo, c]));
  for (const b of pack) {
    const check = checks.get(b.invoiceNo);
    const amount = Math.round(b.total * 1_000_000);
    const paidAt = check ? `${check.date}T10:00:00.000Z` : null;
    // A bill nobody paid, for a PO and amount an earlier bill already carries: the duplicate the
    // ERP rejected at cutover (OFH-3317-R).
    const held =
      !check &&
      pack.some((o) => o !== b && o.poNo === b.poNo && o.total === b.total && o.date < b.date);
    bills.push(bill(b.invoiceNo, b.vendorCode, b.poNo, b.date, amount, paidAt, held));
    if (check && paidAt) payments.push(pay(check.checkNo, amount, paidAt, b.invoiceNo, "check"));
  }
  const po1042 = anchorPos.find((p) => p.poNo === "PO-1042");
  const release = world.escrow.find((e) => e.poNo === "PO-1042" && e.deltaUsdc < 0);
  if (po1042 && release) {
    bills.push(
      bill(
        PO_1042_INVOICE.invoiceNo,
        po1042.vendor,
        "PO-1042",
        PO_1042_INVOICE.date,
        po1042.totalUsdc,
        release.at,
        false,
      ),
    );
    payments.push(
      pay(
        "Escrow release PO-1042",
        po1042.totalUsdc,
        release.at,
        PO_1042_INVOICE.invoiceNo,
        "escrow_release",
      ),
    );
  }
  return { bills, payments };
}

function bill(
  billNo: string,
  vendor: string,
  poNo: string,
  billDate: string,
  amountUsdc: number,
  paidAt: string | null,
  held: boolean,
): BillRec {
  return {
    billNo,
    era: "anchor",
    vendor,
    poNo,
    billDate,
    dueDate: addDays(billDate, 30),
    amountUsdc,
    paidAt,
    held,
  };
}

function pay(
  paymentNo: string,
  amountUsdc: number,
  paidAt: string,
  billNo: string,
  rail: string,
): PaymentRec {
  return { paymentNo, era: "anchor", amountUsdc, paidAt, bills: [billNo], rail };
}

/** The plant's book: every record money.ts reads, from the world and the anchored payables. */
export function moneyBook(world: World): MoneyBook {
  const cal = world.meta.calendar;
  const paidAt = new Map<string, string>();
  for (const p of world.payments) for (const b of p.bills) paidAt.set(b, p.paidAt);
  const anchor = anchorPayables(world);
  const pos: PoRec[] = world.pos.map((p) => {
    const byCategory: Record<string, number> = {};
    for (const l of p.lines) {
      const c = category.get(l.material) ?? "excipient";
      byCategory[c] = (byCategory[c] ?? 0) + l.extendedUsdc;
    }
    return {
      poNo: p.poNo,
      era: p.era,
      vendor: p.vendor,
      orderedAt: p.orderedAt,
      totalUsdc: p.totalUsdc,
      freightUsdc: p.freightUsdc,
      byCategory,
      kevin: p.approval?.path === "auto" || p.approval?.path === "director_text",
    };
  });
  const fgOf = new Map(
    world.fgLots.flatMap((l) => (l.batchNo ? [[l.batchNo, l.fgLot] as const] : [])),
  );
  return {
    plant: world.meta.facility,
    name: world.meta.plant,
    calendar: { ...cal },
    bills: [
      ...world.bills.map((b) => ({
        billNo: b.billNo,
        era: b.era,
        vendor: b.vendor,
        poNo: b.poNo,
        billDate: b.billDate,
        dueDate: b.dueDate,
        amountUsdc: b.amountUsdc,
        paidAt: paidAt.get(b.billNo) ?? null,
        held: false,
      })),
      ...anchor.bills,
    ].sort((a, b) => (a.billDate < b.billDate ? -1 : a.billDate > b.billDate ? 1 : 0)),
    payments: [
      ...world.payments.map((p) => ({
        paymentNo: p.paymentNo,
        era: p.era,
        amountUsdc: p.amountUsdc,
        paidAt: p.paidAt,
        bills: p.bills,
        rail: p.rail,
      })),
      ...anchor.payments,
    ].sort((a, b) => (a.paidAt < b.paidAt ? -1 : a.paidAt > b.paidAt ? 1 : 0)),
    invoices: world.invoices.map((i) => ({
      invoiceNo: i.invoiceNo,
      customer: i.customer,
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      amountUsdc: i.amountUsdc,
      paidAt: i.paidAt ?? null,
    })),
    lots: priceLots(world),
    movements: world.movements.map(([at, lot, kind, qty]) => [at, lot, kind, qty]),
    batches: world.batches.map((b) => ({
      batchNo: b.batchNo,
      era: b.era,
      date: b.date,
      product: b.product,
      actualUnits: b.actualUnits,
      consumed: b.consumption.map((c) => [c.lot, c.actualBase] as [string, number]),
      fgLot: fgOf.get(b.batchNo) ?? null,
    })),
    fgLots: world.fgLots.map((l) => ({ fgLot: l.fgLot, product: l.product, batchNo: l.batchNo })),
    fgMovements: world.fgMovements.map(([at, fg, units]) => [at, fg, units]),
    pos,
    escrow: world.escrow.map((e) => ({
      at: e.at,
      poNo: e.poNo,
      deltaUsdc: e.deltaUsdc,
      source: e.at.slice(0, 10) <= cal.recordedEnd ? ("recorded" as const) : ("simulated" as const),
    })),
  };
}
