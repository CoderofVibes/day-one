// Every money formula of the Money page (docs/UPGRADE_BRIEF.md §2.4), pure and per plant: cash
// flow, AP aging, inventory value by class, turns and days on hand, dead stock, escrow over time,
// spend against budget, Kevin's commitment headroom, the PO-size histogram, the savings ledger at
// a date and "Kevin paid for himself". Each function takes one plant's book (or several, for
// "All") and a date or window; the page takes both from the sim clock. Money is USDC base units
// (6 decimals) as in the ledger; quantities are base units (mg or each).
//
// The browser imports this file (@day-one/server/finance/money), so it imports nothing: the
// record shapes below are the world's (server/src/world/types.ts), trimmed to what a formula reads.

export type Era = "legacy" | "anchor" | "simulated";

export interface BillRec {
  billNo: string;
  era: Era;
  vendor: string;
  poNo: string;
  billDate: string;
  dueDate: string;
  amountUsdc: number;
  /** When the payment that settled it went out; null while open. */
  paidAt: string | null;
  /** Held as a duplicate: never payable, so never in AP. */
  held: boolean;
}

export interface PaymentRec {
  paymentNo: string;
  era: Era;
  amountUsdc: number;
  paidAt: string;
  bills: string[];
  rail: string;
}

export interface ArInvoiceRec {
  invoiceNo: string;
  customer: string;
  invoiceDate: string;
  dueDate: string;
  amountUsdc: number;
  paidAt: string | null;
}

export interface LotRec {
  lot: string;
  material: string;
  /** The seed's material category: active, excipient, packaging, lab_chemical. */
  category: string;
  /** USDC base units per base unit: the PO line's price plus its share of the PO's freight. */
  costPerBase: number;
  /** "po" when the lot's PO priced it, "last_price" when it came without one (opening stock). */
  costFrom: "po" | "last_price" | "list_price";
}

/** A signed change to a lot's quantity: [at, lot, kind, qtyBase]. */
export type MoveRec = [at: string, lot: string, kind: string, qtyBase: number];

export interface BatchRec {
  batchNo: string;
  era: Era;
  date: string;
  product: string;
  actualUnits: number;
  /** [lot, actual qtyBase drawn]; the batch's waste is inside these draws. */
  consumed: [lot: string, qtyBase: number][];
  fgLot: string | null;
}

export interface FgLotRec {
  fgLot: string;
  product: string;
  batchNo: string | null;
}

/** A signed change to a finished-goods lot: [at, fgLot, units]. */
export type FgMoveRec = [at: string, fgLot: string, units: number];

export interface PoRec {
  poNo: string;
  era: Era;
  vendor: string;
  orderedAt: string;
  totalUsdc: number;
  freightUsdc: number;
  /** Line value by material category. */
  byCategory: Record<string, number>;
  /** Kevin drafted it under the spend policy (approval path auto or director_text). */
  kevin: boolean;
}

export interface EscrowRec {
  at: string;
  poNo: string;
  deltaUsdc: number;
  /** Recorded on testnet (the anchor segment) or simulated after it. */
  source: "recorded" | "simulated";
}

export interface Calendar {
  start: string;
  spliceIn: string;
  t0: string;
  recordedEnd: string;
  end: string;
}

export interface MoneyBook {
  plant: string;
  name: string;
  calendar: Calendar;
  bills: BillRec[];
  payments: PaymentRec[];
  invoices: ArInvoiceRec[];
  lots: LotRec[];
  movements: MoveRec[];
  batches: BatchRec[];
  fgLots: FgLotRec[];
  fgMovements: FgMoveRec[];
  pos: PoRec[];
  escrow: EscrowRec[];
}

export interface Window {
  from: string;
  to: string;
}

export interface Overhead {
  laborUsd: number;
  utilitiesUsd: number;
  rentUsd: number;
}
export type BudgetTable = Readonly<Record<string, number>>;

const DAY = 86_400_000;
const USD = 1_000_000;

export const day = (iso: string) => iso.slice(0, 10);
export const month = (iso: string) => iso.slice(0, 7);
const ms = (iso: string) => Date.parse(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
/** The end of a date-only day, so "at 2026-11-09" includes everything that day. */
export const endOf = (iso: string) => (iso.length === 10 ? `${iso}T23:59:59.999Z` : iso);
export const addDays = (date: string, n: number) =>
  new Date(ms(day(date)) + n * DAY).toISOString().slice(0, 10);
const daysInMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const daysBetween = (a: string, b: string) => Math.round((ms(day(b)) - ms(day(a))) / DAY);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** The era a date falls in on the plant's calendar. */
export function eraOf(cal: Calendar, date: string): Era {
  const d = day(date);
  if (d < cal.spliceIn) return "legacy";
  return d <= cal.recordedEnd ? "anchor" : "simulated";
}

/** The trailing window ending at `at`: twelve months by default, never before the book starts. */
export function trailing(cal: Calendar, at: string, days = 365): Window {
  const from = addDays(at, -days + 1);
  return { from: from < cal.start ? cal.start : from, to: endOf(at) };
}

// ------------------------------------------------------------------ 1. cash flow

export interface CashMonth {
  month: string;
  /** Days of the month inside the window: overhead is prorated by them. */
  days: number;
  era: Era;
  vendorPaymentsUsdc: number;
  overheadUsdc: number;
  laborUsdc: number;
  utilitiesUsdc: number;
  rentUsdc: number;
  receiptsUsdc: number;
  cashOutUsdc: number;
  netUsdc: number;
  cumulativeUsdc: number;
}

/** Overhead for `days` days of a month: the monthly constant prorated, in USDC base units. */
export function overheadFor(o: Overhead, ym: string, days: number) {
  const share = days / daysInMonth(ym);
  const labor = Math.round(o.laborUsd * USD * share);
  const utilities = Math.round(o.utilitiesUsd * USD * share);
  const rent = Math.round(o.rentUsd * USD * share);
  return { labor, utilities, rent, total: labor + utilities + rent };
}

/**
 * Monthly cash flow over the window. Cash out = vendor payments by paid date + modeled overhead;
 * cash in = customer receipts by paid date (each invoice's due date plus the customer's lateness).
 */
export function cashFlow(book: MoneyBook, w: Window, overhead: Overhead): CashMonth[] {
  const months: string[] = [];
  for (let d = day(w.from); d <= day(w.to); d = addDays(`${month(d)}-01`, daysInMonth(month(d)))) {
    months.push(month(d));
  }
  let cumulative = 0;
  return months.map((ym) => {
    const first = `${ym}-01` < day(w.from) ? day(w.from) : `${ym}-01`;
    const lastDay = `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
    const last = lastDay > day(w.to) ? day(w.to) : lastDay;
    const days = daysBetween(first, last) + 1;
    const inMonth = (iso: string | null) =>
      iso !== null && month(iso) === ym && iso >= w.from && iso <= w.to;
    const vendor = sum(book.payments.filter((p) => inMonth(p.paidAt)).map((p) => p.amountUsdc));
    const receipts = sum(book.invoices.filter((i) => inMonth(i.paidAt)).map((i) => i.amountUsdc));
    const o = overheadFor(overhead, ym, days);
    const out = vendor + o.total;
    cumulative += receipts - out;
    return {
      month: ym,
      days,
      era: eraOf(book.calendar, `${ym}-15`),
      vendorPaymentsUsdc: vendor,
      overheadUsdc: o.total,
      laborUsdc: o.labor,
      utilitiesUsdc: o.utilities,
      rentUsdc: o.rent,
      receiptsUsdc: receipts,
      cashOutUsdc: out,
      netUsdc: receipts - out,
      cumulativeUsdc: cumulative,
    };
  });
}

/** Cash on hand at `at`, modeled: opening cash + every receipt − every payment − overhead to date. */
export function cashOnHand(
  book: MoneyBook,
  at: string,
  openingCashUsd: number,
  overhead: Overhead,
): number {
  const flow = cashFlow(book, { from: book.calendar.start, to: endOf(at) }, overhead);
  return openingCashUsd * USD + (flow.at(-1)?.cumulativeUsdc ?? 0);
}

// ------------------------------------------------------------------ 2. AP aging

export const AGING_BUCKETS = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "Current";
  if (daysPastDue <= 30) return "1–30";
  if (daysPastDue <= 60) return "31–60";
  if (daysPastDue <= 90) return "61–90";
  return "90+";
}

export interface ApAging {
  at: string;
  totalUsdc: number;
  buckets: {
    bucket: AgingBucket;
    totalUsdc: number;
    bills: (BillRec & { daysPastDue: number })[];
  }[];
  /** Duplicates held at the time: not payable, so outside AP. */
  held: BillRec[];
  /** Bills paid after their due date so far, and by how many days on average. */
  paidLate: { count: number; avgDaysLate: number };
}

/** Open vendor bills at `at`, bucketed by days past due. */
export function apAging(book: MoneyBook, at: string): ApAging {
  const t = endOf(at);
  const open = book.bills.filter(
    (b) => !b.held && b.billDate <= day(t) && (b.paidAt === null || b.paidAt > t),
  );
  const buckets = AGING_BUCKETS.map((bucket) => {
    const bills = open
      .map((b) => ({ ...b, daysPastDue: daysBetween(b.dueDate, t) }))
      .filter((b) => agingBucket(b.daysPastDue) === bucket)
      .sort((a, b) => b.daysPastDue - a.daysPastDue);
    return { bucket, totalUsdc: sum(bills.map((b) => b.amountUsdc)), bills };
  });
  const late = book.bills
    .filter((b) => b.paidAt !== null && b.paidAt <= t && day(b.paidAt) > b.dueDate)
    .map((b) => daysBetween(b.dueDate, b.paidAt as string));
  return {
    at: t,
    totalUsdc: sum(buckets.map((b) => b.totalUsdc)),
    buckets,
    held: book.bills.filter((b) => b.held && b.billDate <= day(t)),
    paidLate: {
      count: late.length,
      avgDaysLate: late.length ? Math.round((sum(late) / late.length) * 10) / 10 : 0,
    },
  };
}

// ------------------------------------------------------------------ 3. inventory value

export interface PricedLine {
  material: string;
  qtyBase: number;
  extendedUsdc: number;
}

/**
 * Cost per base unit of each line of a PO: its own price plus the PO's freight allocated by line
 * value. `cost = (extended + freight × extended / Σ extended) / qty`.
 */
export function landedCosts(lines: PricedLine[], freightUsdc: number): number[] {
  const total = sum(lines.map((l) => l.extendedUsdc));
  return lines.map((l) => {
    const freight = total > 0 ? (freightUsdc * l.extendedUsdc) / total : 0;
    return l.qtyBase > 0 ? (l.extendedUsdc + freight) / l.qtyBase : 0;
  });
}

/** Each lot's balance at `at`: the sum of its movements up to then. */
export function balancesAt(movements: MoveRec[], at: string): Map<string, number> {
  const t = endOf(at);
  const out = new Map<string, number>();
  for (const [when, lot, , qty] of movements) {
    if (when > t) continue;
    out.set(lot, (out.get(lot) ?? 0) + qty);
  }
  return out;
}

export const INVENTORY_CLASSES = ["raw", "packaging", "lab", "wip", "finished"] as const;
export type InventoryClass = (typeof INVENTORY_CLASSES)[number];
export const CLASS_OF_CATEGORY: Record<string, InventoryClass> = {
  active: "raw",
  excipient: "raw",
  packaging: "packaging",
  lab_chemical: "lab",
};

export interface InventoryValue {
  at: string;
  byClass: Record<InventoryClass, number>;
  /** Raw materials, packaging and lab stock: what turns and days on hand are measured on. */
  materialsUsdc: number;
  totalUsdc: number;
  byMaterial: { material: string; category: string; qtyBase: number; valueUsdc: number }[];
  /** Batches whose materials are drawn and whose finished goods are not yet made. */
  wipBatches: string[];
}

/** What a batch's draws cost: Σ qty × the drawn lot's cost per base unit. */
export function batchCost(batch: BatchRec, costs: Map<string, LotRec>): number {
  return Math.round(
    sum(batch.consumed.map(([lot, qty]) => qty * (costs.get(lot)?.costPerBase ?? 0))),
  );
}

/**
 * Cost per finished unit per finished-goods lot: its batch's draws over the units it made.
 * Opening lots (no batch) take the product's first batch's unit cost.
 */
export function fgUnitCosts(book: MoneyBook, costs = lotIndex(book)): Map<string, number> {
  const byBatch = new Map(book.batches.map((b) => [b.batchNo, b]));
  const first = new Map<string, number>();
  const out = new Map<string, number>();
  for (const b of [...book.batches].sort((x, y) => (x.date < y.date ? -1 : 1))) {
    const unit = b.actualUnits > 0 ? batchCost(b, costs) / b.actualUnits : 0;
    if (!first.has(b.product)) first.set(b.product, unit);
  }
  for (const l of book.fgLots) {
    const b = l.batchNo ? byBatch.get(l.batchNo) : undefined;
    out.set(
      l.fgLot,
      b && b.actualUnits > 0 ? batchCost(b, costs) / b.actualUnits : (first.get(l.product) ?? 0),
    );
  }
  return out;
}

export const lotIndex = (book: MoneyBook) => new Map(book.lots.map((l) => [l.lot, l]));

/** Inventory value at `at` = Σ on-hand qty × lot cost, by class; WIP at draw cost; FG at batch cost. */
export function inventoryValue(
  book: MoneyBook,
  at: string,
  costs = lotIndex(book),
): InventoryValue {
  const t = endOf(at);
  const byClass: Record<InventoryClass, number> = {
    raw: 0,
    packaging: 0,
    lab: 0,
    wip: 0,
    finished: 0,
  };
  const perMaterial = new Map<string, { category: string; qtyBase: number; valueUsdc: number }>();
  for (const [lot, qty] of balancesAt(book.movements, t)) {
    if (qty <= 0) continue;
    const info = costs.get(lot);
    if (!info) continue;
    const value = Math.round(qty * info.costPerBase);
    byClass[CLASS_OF_CATEGORY[info.category] ?? "raw"] += value;
    const m = perMaterial.get(info.material) ?? {
      category: info.category,
      qtyBase: 0,
      valueUsdc: 0,
    };
    m.qtyBase += qty;
    m.valueUsdc += value;
    perMaterial.set(info.material, m);
  }
  const made = new Map<string, string>();
  for (const [when, fg, units] of book.fgMovements) {
    if (units > 0 && !made.has(fg)) made.set(fg, when);
  }
  const wipBatches: string[] = [];
  for (const b of book.batches) {
    if (b.date > day(t) || !b.fgLot) continue;
    const madeAt = made.get(b.fgLot);
    if (madeAt !== undefined && madeAt > t && `${b.date}T00:00:00.000Z` <= t) {
      byClass.wip += batchCost(b, costs);
      wipBatches.push(b.batchNo);
    }
  }
  const unit = fgUnitCosts(book, costs);
  const fgOnHand = new Map<string, number>();
  for (const [when, fg, units] of book.fgMovements) {
    if (when <= t) fgOnHand.set(fg, (fgOnHand.get(fg) ?? 0) + units);
  }
  for (const [fg, units] of fgOnHand) {
    if (units > 0) byClass.finished += Math.round(units * (unit.get(fg) ?? 0));
  }
  const materialsUsdc = byClass.raw + byClass.packaging + byClass.lab;
  return {
    at: t,
    byClass,
    materialsUsdc,
    totalUsdc: materialsUsdc + byClass.wip + byClass.finished,
    byMaterial: [...perMaterial]
      .map(([material, m]) => ({ material, ...m }))
      .sort((a, b) => b.valueUsdc - a.valueUsdc),
    wipBatches,
  };
}

/** Inventory value by class at the end of each month of the window (the last at `w.to`). */
export function inventoryTrend(book: MoneyBook, w: Window) {
  const costs = lotIndex(book);
  const out: { month: string; era: Era; byClass: Record<InventoryClass, number> }[] = [];
  for (let d = day(w.from); d <= day(w.to); d = addDays(`${month(d)}-01`, daysInMonth(month(d)))) {
    const ym = month(d);
    const end = `${ym}-${String(daysInMonth(ym)).padStart(2, "0")}`;
    const at = end > day(w.to) ? day(w.to) : end;
    out.push({
      month: ym,
      era: eraOf(book.calendar, at),
      byClass: inventoryValue(book, at, costs).byClass,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 4. turns, days on hand, dead stock

/** Material cost of goods sold: Σ draw cost of the batches made in the window (waste included). */
export function cogs(book: MoneyBook, w: Window, costs = lotIndex(book)) {
  const batches = book.batches.filter((b) => b.date >= day(w.from) && b.date <= day(w.to));
  const byMaterial = new Map<string, number>();
  for (const b of batches) {
    for (const [lot, qty] of b.consumed) {
      const info = costs.get(lot);
      if (!info) continue;
      byMaterial.set(info.material, (byMaterial.get(info.material) ?? 0) + qty * info.costPerBase);
    }
  }
  return {
    usdc: sum(batches.map((b) => batchCost(b, costs))),
    batches: batches.length,
    byMaterial: new Map([...byMaterial].map(([m, v]) => [m, Math.round(v)])),
  };
}

export interface Turns {
  /** Annualized: COGS over the window, scaled to a year, over the average materials value. */
  turns: number;
  cogsUsdc: number;
  avgInventoryUsdc: number;
  windowDays: number;
  /** The days the average was sampled on (weekly, and `at`). */
  samples: number;
}

/** Inventory turns (annualized) = trailing-12-month material COGS / average materials value. */
export function inventoryTurns(book: MoneyBook, at: string, costs = lotIndex(book)): Turns {
  const w = trailing(book.calendar, at);
  const windowDays = daysBetween(w.from, at) + 1;
  const c = cogs(book, w, costs);
  const values: number[] = [];
  for (let d = day(w.from); d < day(at); d = addDays(d, 7)) {
    values.push(inventoryValue(book, d, costs).materialsUsdc);
  }
  values.push(inventoryValue(book, at, costs).materialsUsdc);
  const avg = sum(values) / values.length;
  const turns = avg > 0 ? ((c.usdc / avg) * 365) / windowDays : 0;
  return {
    turns: Math.round(turns * 10) / 10,
    cogsUsdc: c.usdc,
    avgInventoryUsdc: Math.round(avg),
    windowDays,
    samples: values.length,
  };
}

/** Days on hand = materials value at `at` / (trailing 90-day material COGS / 90). */
export function daysOnHand(book: MoneyBook, at: string, costs = lotIndex(book)) {
  const w = trailing(book.calendar, at, 90);
  const span = daysBetween(w.from, at) + 1;
  const c = cogs(book, w, costs);
  const value = inventoryValue(book, at, costs).materialsUsdc;
  const perDay = c.usdc / span;
  return {
    days: perDay > 0 ? Math.round(value / perDay) : null,
    valueUsdc: value,
    cogsUsdc: c.usdc,
    windowDays: span,
  };
}

export interface DeadStock {
  material: string;
  category: string;
  lots: string[];
  qtyBase: number;
  valueUsdc: number;
  /** The last draw of the material, or null when none is on record. */
  lastConsumed: string | null;
}

/**
 * Dead stock at `at`: materials with stock on hand, received more than `days` ago, and no draw
 * in the last `days` days.
 */
export function deadStock(book: MoneyBook, at: string, days: number, costs = lotIndex(book)) {
  const t = endOf(at);
  const cutoff = `${addDays(at, -days)}T23:59:59.999Z`;
  const lastDraw = new Map<string, string>();
  const firstIn = new Map<string, string>();
  for (const [when, lot, kind] of book.movements) {
    if (when > t) continue;
    const info = costs.get(lot);
    if (!info) continue;
    if (kind === "consumed") lastDraw.set(info.material, when);
    if (kind === "received" && !firstIn.has(lot)) firstIn.set(lot, when);
  }
  const out = new Map<string, DeadStock>();
  for (const [lot, qty] of balancesAt(book.movements, t)) {
    const info = costs.get(lot);
    if (!info || qty <= 0) continue;
    const last = lastDraw.get(info.material) ?? null;
    if (last !== null && last > cutoff) continue;
    if ((firstIn.get(lot) ?? t) > cutoff) continue;
    const d = out.get(info.material) ?? {
      material: info.material,
      category: info.category,
      lots: [],
      qtyBase: 0,
      valueUsdc: 0,
      lastConsumed: last,
    };
    d.lots.push(lot);
    d.qtyBase += qty;
    d.valueUsdc += Math.round(qty * info.costPerBase);
    out.set(info.material, d);
  }
  return [...out.values()].sort((a, b) => b.valueUsdc - a.valueUsdc);
}

// ------------------------------------------------------------------ 5. escrow

export interface EscrowView {
  at: string;
  /** Funded − released − refunded, at `at`. */
  heldUsdc: number;
  byPo: { poNo: string; heldUsdc: number; source: "recorded" | "simulated" }[];
  /** The balance after each change up to `at`. */
  timeline: { at: string; balanceUsdc: number; poNo: string; deltaUsdc: number; source: string }[];
}

export function escrowAt(book: MoneyBook, at: string): EscrowView {
  const t = endOf(at);
  const events = book.escrow
    .filter((e) => e.at <= t)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const per = new Map<string, { heldUsdc: number; source: "recorded" | "simulated" }>();
  let balance = 0;
  const timeline = events.map((e) => {
    balance += e.deltaUsdc;
    const p = per.get(e.poNo) ?? { heldUsdc: 0, source: e.source };
    p.heldUsdc += e.deltaUsdc;
    per.set(e.poNo, p);
    return {
      at: e.at,
      balanceUsdc: balance,
      poNo: e.poNo,
      deltaUsdc: e.deltaUsdc,
      source: e.source,
    };
  });
  return {
    at: t,
    heldUsdc: balance,
    byPo: [...per]
      .filter(([, p]) => p.heldUsdc !== 0)
      .map(([poNo, p]) => ({ poNo, ...p }))
      .sort((a, b) => b.heldUsdc - a.heldUsdc),
    timeline,
  };
}

// ------------------------------------------------------------------ 6. spend vs budget

export const SPEND_CATEGORIES = ["active", "excipient", "packaging", "lab_chemical", "freight"];

export interface SpendCell {
  category: string;
  month: string;
  spendUsdc: number;
  budgetUsdc: number;
  /** Spend over budget, basis points (10,000 = on budget). */
  ofBudgetBp: number;
}

/** PO value by category (freight is its own) and order month, against the monthly budget. */
export function spendVsBudget(book: MoneyBook, w: Window, budgets: BudgetTable): SpendCell[] {
  const cells: SpendCell[] = [];
  const months = new Set<string>();
  for (let d = day(w.from); d <= day(w.to); d = addDays(`${month(d)}-01`, daysInMonth(month(d)))) {
    months.add(month(d));
  }
  for (const ym of months) {
    const pos = book.pos.filter(
      (p) => month(p.orderedAt) === ym && p.orderedAt >= w.from && p.orderedAt <= w.to,
    );
    for (const category of SPEND_CATEGORIES) {
      const spend =
        category === "freight"
          ? sum(pos.map((p) => p.freightUsdc))
          : sum(pos.map((p) => p.byCategory[category] ?? 0));
      const budget = Math.round((budgets[category] ?? 0) * USD);
      cells.push({
        category,
        month: ym,
        spendUsdc: spend,
        budgetUsdc: budget,
        ofBudgetBp: budget > 0 ? Math.round((spend * 10_000) / budget) : 0,
      });
    }
  }
  return cells;
}

/** What Kevin has committed this month (his POs, ordered by `at`) against his monthly limit. */
export function kevinHeadroom(book: MoneyBook, at: string, monthlyLimitUsd: number) {
  const t = endOf(at);
  const pos = book.pos.filter(
    (p) => p.kevin && month(p.orderedAt) === month(t) && p.orderedAt <= t,
  );
  const committed = sum(pos.map((p) => p.totalUsdc));
  const limit = monthlyLimitUsd * USD;
  return {
    month: month(t),
    committedUsdc: committed,
    limitUsdc: limit,
    headroomUsdc: limit - committed,
    pos: pos.map((p) => p.poNo),
  };
}

/** PO totals in the window in `binUsd` bins; the per-PO limit marks which ones needed a director. */
export function poSizeHistogram(book: MoneyBook, w: Window, binUsd: number, limitUsd: number) {
  const pos = book.pos.filter((p) => p.orderedAt >= w.from && p.orderedAt <= w.to);
  const top = Math.max(limitUsd * 2, ...pos.map((p) => p.totalUsdc / USD));
  const bins: { fromUsd: number; toUsd: number; legacy: number; kevin: number; pos: string[] }[] =
    [];
  for (let lo = 0; lo < top; lo += binUsd)
    bins.push({ fromUsd: lo, toUsd: lo + binUsd, legacy: 0, kevin: 0, pos: [] });
  for (const p of pos) {
    const i = Math.min(bins.length - 1, Math.floor(p.totalUsdc / USD / binUsd));
    const bin = bins[i];
    if (!bin) continue;
    if (p.kevin) bin.kevin += 1;
    else bin.legacy += 1;
    bin.pos.push(p.poNo);
  }
  return {
    bins,
    limitUsd,
    overLimit: pos.filter((p) => p.totalUsdc > limitUsd * USD).map((p) => p.poNo),
    overLimitKevin: pos.filter((p) => p.kevin && p.totalUsdc > limitUsd * USD).map((p) => p.poNo),
  };
}

// ------------------------------------------------------------------ 7. savings ledger

export type SavingType =
  | "group_buy"
  | "transfer"
  | "sealed_bid"
  | "over_consumption"
  | "duplicate_invoice"
  | "price_drift"
  | "rush_freight";

export interface SavingEntry {
  id: string;
  type: SavingType;
  plant: string;
  title: string;
  amountUsdc: number;
  /** Identified when found; realized when the money stayed with the plant. */
  status: "identified" | "realized";
  /** The day it was identified, and the day it was realized (null while only identified). */
  identifiedAt: string;
  realizedAt: string | null;
  /** The records the amount comes from; no record backs two entries (a test proves it). */
  evidence: string[];
  formula: string;
  /** The arithmetic with this entry's own numbers. */
  working: string;
  era: Era;
}

export interface SavingsAt {
  at: string;
  realizedUsdc: number;
  identifiedUsdc: number;
  /** Entries known by `at`, each with its status as of `at`. */
  entries: (SavingEntry & { statusAt: "identified" | "realized" })[];
}

/** The ledger as of `at`, for some plants: what was known, and what was realized since `since`. */
export function savingsAt(
  entries: SavingEntry[],
  at: string,
  plants: readonly string[],
  since: string,
): SavingsAt {
  const t = endOf(at);
  const known = entries
    .filter((e) => plants.includes(e.plant) && `${e.identifiedAt}` <= t)
    .map((e) => ({
      ...e,
      statusAt:
        e.realizedAt !== null && e.realizedAt <= t
          ? ("realized" as const)
          : ("identified" as const),
    }));
  const realized = known.filter(
    (e) => e.statusAt === "realized" && day(e.realizedAt ?? "") >= since,
  );
  return {
    at: t,
    realizedUsdc: sum(realized.map((e) => e.amountUsdc)),
    identifiedUsdc: sum(known.filter((e) => e.statusAt === "identified").map((e) => e.amountUsdc)),
    entries: known,
  };
}

/** Every evidence id that backs more than one entry: empty for an honest ledger. */
export function doubleCounted(entries: SavingEntry[]): string[] {
  const seen = new Map<string, number>();
  for (const e of entries)
    for (const id of new Set(e.evidence)) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
}

// ------------------------------------------------------------------ 8. Kevin paid for himself

export interface KevinCostConfig {
  feeUsdPerMonth: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  usdPerAnswer: number;
}

export interface RecordedAnswer {
  file: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** One answer's inference: its tokens at the assumed rate, or the per-answer rate without them. */
export function answerCostUsdc(a: RecordedAnswer, c: KevinCostConfig): number {
  if (a.inputTokens === null || a.outputTokens === null) return Math.round(c.usdPerAnswer * USD);
  // Tokens × dollars per million tokens is micro-dollars: USDC base units already.
  return Math.round(a.inputTokens * c.inputUsdPerMTok + a.outputTokens * c.outputUsdPerMTok);
}

export interface KevinCost {
  days: number;
  plants: number;
  feeUsdc: number;
  inferenceUsdc: number;
  /** Testnet gas: paid in testnet NEAR, shown as ≈ $0. */
  gasUsdc: 0;
  totalUsdc: number;
  answers: number;
  metered: number;
}

/**
 * Kevin's cost from T0 to `at`: the assumed fee for each plant he runs at, by the day, plus the
 * recorded answers' inference (all of it from T0: they are the run's) and gas at ≈ $0.
 */
export function kevinCostAt(
  at: string,
  t0: string,
  plants: number,
  answers: RecordedAnswer[],
  c: KevinCostConfig,
): KevinCost {
  const days = day(at) < t0 ? 0 : daysBetween(t0, at) + 1;
  const fee = Math.round(((c.feeUsdPerMonth * USD * 12) / 365) * days * plants);
  const inference = days > 0 ? sum(answers.map((a) => answerCostUsdc(a, c))) : 0;
  return {
    days,
    plants,
    feeUsdc: fee,
    inferenceUsdc: inference,
    gasUsdc: 0,
    totalUsdc: fee + inference,
    answers: answers.length,
    metered: answers.filter((a) => a.inputTokens !== null).length,
  };
}

export interface PaidForHimself {
  valueUsdc: number;
  realizedUsdc: number;
  identifiedUsdc: number;
  costUsdc: number;
  /** Value over cost; null before any cost. */
  ratio: number | null;
  /** Toward break-even, 0 to 1 (1 once value covers cost). */
  breakEven: number;
  /** When each counted saving landed, with the running total. */
  timeline: { at: string; id: string; amountUsdc: number; runningUsdc: number }[];
}

/** "Kevin paid for himself": realized savings since T0 over his cost; identified only on request. */
export function paidForHimself(
  s: SavingsAt,
  cost: KevinCost,
  since: string,
  includeIdentified: boolean,
): PaidForHimself {
  const counted = s.entries
    .filter((e) =>
      e.statusAt === "realized" ? day(e.realizedAt ?? "") >= since : includeIdentified,
    )
    .map((e) => ({ at: e.statusAt === "realized" ? (e.realizedAt as string) : e.identifiedAt, e }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let running = 0;
  const timeline = counted.map(({ at, e }) => {
    running += e.amountUsdc;
    return { at, id: e.id, amountUsdc: e.amountUsdc, runningUsdc: running };
  });
  const value = running;
  return {
    valueUsdc: value,
    realizedUsdc: s.realizedUsdc,
    identifiedUsdc: s.identifiedUsdc,
    costUsdc: cost.totalUsdc,
    ratio: cost.totalUsdc > 0 ? Math.round((value / cost.totalUsdc) * 10) / 10 : null,
    breakEven: cost.totalUsdc > 0 ? Math.min(1, value / cost.totalUsdc) : value > 0 ? 1 : 0,
    timeline,
  };
}
