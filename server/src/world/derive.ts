// Derived views (docs/UPGRADE_BRIEF.md §2.1.10): daily snapshots, monthly series, indexes and
// Kevin's look-back over the legacy months. Everything here is computed from the records; no
// number in it is set by hand.

import { duplicateAmong, normalizeInvoiceNo } from "@day-one/erp/match";
import { priceDrift, type SettledPo } from "../ledger/books.ts";
import { MATERIALS, VENDORS } from "../seed/reference.ts";
import type { WeeklyDemand } from "./calendar.ts";
import { addDays, dates, month } from "./calendar.ts";
import { AP, type WorldConfig } from "./config.ts";
import type {
  Movement,
  WorldBatch,
  WorldBill,
  WorldLot,
  WorldPayment,
  WorldPo,
  WorldReceipt,
} from "./types.ts";

export interface DeriveInput {
  config: WorldConfig;
  pos: WorldPo[];
  receipts: WorldReceipt[];
  lots: WorldLot[];
  movements: Movement[];
  batches: WorldBatch[];
  bills: WorldBill[];
  payments: WorldPayment[];
  escrow: { at: string; poNo: string; deltaUsdc: number }[];
  demand: WeeklyDemand[];
}

const day = (iso: string) => iso.slice(0, 10);
const dollars = (usdc: number) =>
  `$${(usdc / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One value per day per series, columnar so a day is one index into each array. */
export function snapshots(input: DeriveInput) {
  const { start, end } = input.config.calendar;
  const days = dates(start, end);
  const lotMaterial = new Map(input.lots.map((l) => [l.lot, l.material]));
  const materials = [...new Set(input.lots.map((l) => l.material))].sort();
  const col = new Map(materials.map((m, i) => [m, i]));
  const byDay = new Map<string, Movement[]>();
  for (const m of input.movements) byDay.set(day(m[0]), [...(byDay.get(day(m[0])) ?? []), m]);
  const level = materials.map(() => 0);
  const onHand: number[][] = [];
  const lastReceipt = new Map<string, string>();
  for (const r of input.receipts) {
    const prev = lastReceipt.get(r.poNo);
    if (!prev || r.receivedAt > prev) lastReceipt.set(r.poNo, r.receivedAt);
  }
  const paidAt = new Map<string, string>();
  for (const p of input.payments) for (const b of p.bills) paidAt.set(b, p.paidAt);
  const openPoCount: number[] = [];
  const openPoUsdc: number[] = [];
  const apOpenUsdc: number[] = [];
  const escrowUsdc: number[] = [];
  const spendMtdUsdc: number[] = [];
  const batchesMtd: number[] = [];
  const escrowSorted = [...input.escrow].sort((a, b) => (a.at < b.at ? -1 : 1));
  let escrow = 0;
  let e = 0;
  for (const d of days) {
    for (const m of byDay.get(d) ?? []) {
      const i = col.get(lotMaterial.get(m[1]) ?? "");
      if (i !== undefined) level[i] = (level[i] ?? 0) + m[3];
    }
    onHand.push([...level]);
    const open = input.pos.filter(
      (p) => day(p.orderedAt) <= d && (lastReceipt.get(p.poNo) ?? "9999") > `${d}T23:59`,
    );
    openPoCount.push(open.length);
    openPoUsdc.push(open.reduce((s, p) => s + p.totalUsdc, 0));
    apOpenUsdc.push(
      input.bills
        .filter((b) => b.billDate <= d && (paidAt.get(b.billNo) ?? "9999") > `${d}T23:59`)
        .reduce((s, b) => s + b.amountUsdc, 0),
    );
    while (e < escrowSorted.length && day(escrowSorted[e]?.at ?? "") <= d) {
      escrow += escrowSorted[e]?.deltaUsdc ?? 0;
      e++;
    }
    escrowUsdc.push(escrow);
    const m = month(d);
    spendMtdUsdc.push(
      input.pos
        .filter((p) => month(p.orderedAt) === m && day(p.orderedAt) <= d)
        .reduce((s, p) => s + p.totalUsdc, 0),
    );
    batchesMtd.push(input.batches.filter((b) => month(b.date) === m && b.date <= d).length);
  }
  return {
    days,
    materials,
    onHand,
    openPoCount,
    openPoUsdc,
    apOpenUsdc,
    escrowUsdc,
    spendMtdUsdc,
    batchesMtd,
  };
}

/** Monthly series for charts: production, demand, spend by category, freight. */
export function monthly(input: DeriveInput) {
  const months = [
    ...new Set(dates(input.config.calendar.start, input.config.calendar.end).map(month)),
  ];
  const category = new Map(MATERIALS.map((m) => [m.code, m.category]));
  return months.map((m) => {
    const batches = input.batches.filter((b) => month(b.date) === m);
    const units: Record<string, number> = {};
    const count: Record<string, number> = {};
    for (const b of batches) {
      units[b.product] = (units[b.product] ?? 0) + b.actualUnits;
      count[b.product] = (count[b.product] ?? 0) + 1;
    }
    const demand: Record<string, number> = {};
    for (const w of input.demand.filter((x) => month(addDays(x.week, 3)) === m)) {
      demand[w.product] = (demand[w.product] ?? 0) + w.units;
    }
    const spend: Record<string, number> = {};
    let freightUsdc = 0;
    for (const po of input.pos.filter((p) => month(p.orderedAt) === m)) {
      for (const l of po.lines) {
        const c = category.get(l.material) ?? "other";
        spend[c] = (spend[c] ?? 0) + l.extendedUsdc;
      }
      freightUsdc += po.freightUsdc;
    }
    return { month: m, batches: count, units, demand, spendUsdc: spend, freightUsdc };
  });
}

export function indexes(input: DeriveInput) {
  const push = (map: Record<string, string[]>, key: string, value: string) => {
    const list = map[key] ?? [];
    if (!list.includes(value)) list.push(value);
    map[key] = list;
  };
  const lotToBatches: Record<string, string[]> = {};
  for (const b of input.batches)
    for (const c of b.consumption) push(lotToBatches, c.lot, b.batchNo);
  const materialToLots: Record<string, string[]> = {};
  for (const l of input.lots) push(materialToLots, l.material, l.lot);
  const supplierToPos: Record<string, string[]> = {};
  for (const p of input.pos) push(supplierToPos, p.vendor, p.poNo);
  const poToReceipts: Record<string, string[]> = {};
  for (const r of input.receipts) push(poToReceipts, r.poNo, r.receiptNo);
  const poToBills: Record<string, string[]> = {};
  for (const b of input.bills) push(poToBills, b.poNo, b.billNo);
  return { lotToBatches, materialToLots, supplierToPos, poToReceipts, poToBills };
}

/**
 * Kevin's look-back over the legacy months: what the paper process paid twice, the prices that
 * drifted, the rush freight and the batches issued over the formula. The duplicate rule is the
 * ERP's (erp/src/match.ts duplicateAmong); the drift rule is the books' (ledger/books.ts).
 */
export function lookBack(input: DeriveInput) {
  const legacyBills = input.bills.filter((b) => b.era === "legacy");
  const poIds = new Map(input.pos.map((p, i) => [p.poNo, i + 1]));
  const duplicates: {
    billNo: string;
    duplicateOf: string;
    why: string;
    amountUsdc: number;
    paid: boolean;
  }[] = [];
  const seen = new Map<
    string,
    (WorldBill & {
      tranId: string;
      normalizedTranId: string;
      poId: number;
      totalUsdc: number;
      tranDate: string;
    })[]
  >();
  for (const b of [...legacyBills].sort((x, y) =>
    x.billDate < y.billDate ? -1 : x.billDate > y.billDate ? 1 : 0,
  )) {
    const mine = seen.get(b.vendor) ?? [];
    const candidate = {
      ...b,
      tranId: b.billNo,
      normalizedTranId: normalizeInvoiceNo(b.billNo),
      poId: poIds.get(b.poNo) ?? 0,
      totalUsdc: b.amountUsdc,
      tranDate: b.billDate,
    };
    const hit = duplicateAmong(mine, candidate, AP.duplicateWindowDays, dollars);
    if (hit) {
      duplicates.push({
        billNo: b.billNo,
        duplicateOf: hit.bill.billNo,
        why: hit.why,
        amountUsdc: b.amountUsdc,
        paid: b.status === "paid",
      });
    } else {
      mine.push(candidate);
    }
    seen.set(b.vendor, mine);
  }

  const vendorName = new Map(VENDORS.map((v) => [v.code, v.name]));
  const materialOf = new Map(MATERIALS.map((m) => [m.code, m]));
  const settled: SettledPo[] = input.pos
    .filter((p) => p.era === "legacy" && p.status === "paid")
    .map((p, i) => ({
      id: i + 1,
      poNo: p.poNo,
      vendor: vendorName.get(p.vendor) ?? p.vendor,
      vendorAccount: null,
      receivedOn: null,
      releasedOn: null,
      freightUsdc: p.freightUsdc,
      totalUsdc: p.totalUsdc,
      paymentRef: null,
      recordRef: null,
      lines: p.lines.map((l, n) => {
        const m = materialOf.get(l.material);
        return {
          lineNo: n + 1,
          material: l.material,
          name: m?.name ?? l.material,
          dimension: m?.uom === "kg" ? "mass" : "count",
          qtyBase: l.qtyBase,
          unitPriceUsdc: l.unitPriceUsdc,
          extendedUsdc: l.extendedUsdc,
        };
      }),
    }));
  const drift = priceDrift(settled).map((d) => ({
    poNo: d.poNo,
    material: d.material,
    driftBp: d.driftBp,
    sentence: d.sentence,
  }));
  const rush = input.pos
    .filter((p) => p.era === "legacy" && p.rush)
    .map((p) => ({ poNo: p.poNo, freightUsdc: p.freightUsdc, incidents: p.incidents }));
  const overIssued = input.batches
    .filter((b) => b.era === "legacy" && b.overIssued.length > 0)
    .map((b) => ({ batchNo: b.batchNo, materials: b.overIssued }));
  return {
    label: "Before cutover · found by Kevin",
    duplicates,
    recoverableUsdc: duplicates.filter((d) => d.paid).reduce((s, d) => s + d.amountUsdc, 0),
    priceDrift: drift,
    rushFreight: rush,
    rushFreightUsdc: rush.reduce((s, r) => s + r.freightUsdc, 0),
    overIssued,
  };
}
