// The Suppliers page's data (docs/UPGRADE_BRIEF.md §2.2, §5.6), from the twelve-month worlds: the
// scorecards on a weekly grid that runs through the recorded run's last day, so the page scores at
// the clock's date with the formula in scorecard.ts; and each supplier's records (receipts with
// their lead times, POs, lots with their QC, RFQs with every quote's landed cost, the incidents
// that name it, the monthly price) for the detail view, which the page cuts at the clock's date.
// Pure: the same worlds give the same view.

import { VENDORS } from "../seed/reference.ts";
import { addDays, daysBetween, month } from "./calendar.ts";
import type { World } from "./index.ts";
import { type Card, facts, scorecardsOf } from "./scorecard.ts";
import { extended, material } from "./sim.ts";

/** One card's numbers on every grid date; null before it has records, or with nothing to score. */
export interface SeriesCard {
  vendor: string;
  material: string | null;
  /** The 0–100 score over the trailing 90 days and over the year. */
  score: (number | null)[];
  scoreYear: (number | null)[];
  /** The trailing window's components, 0–1. */
  onTime: (number | null)[];
  qc: (number | null)[];
  price: (number | null)[];
  invoice: (number | null)[];
  responsiveness: (number | null)[];
  /** Mean days late over the trailing window's late receipts. */
  daysLate: (number | null)[];
  /** Each change of standing: [from this grid date, status, the QC override or null]. */
  status: [string, string, string | null][];
}

export type ReceiptRow = [
  day: string,
  leadDays: number,
  daysLate: number,
  poNo: string,
  plant: string,
];
export type PoRow = [
  poNo: string,
  day: string,
  plant: string,
  materials: string,
  totalUsdc: number,
];
export type LotRow = [
  lot: string,
  day: string,
  material: string,
  plant: string,
  qc: "released" | "rejected" | null,
  qcDay: string | null,
];

export interface RfqSummary {
  rfqNo: string;
  material: string;
  materialName: string;
  uom: "kg" | "ea";
  qtyBase: number;
  day: string;
  winner: string;
  quotes: {
    vendor: string;
    unitPriceUsdc: number;
    freightUsdc: number;
    leadDays: number;
    /** Price × quantity + freight: what Kevin ranks the qualified quotes by. */
    landedUsdc: number;
    status: "accepted" | "declined" | "excluded";
    reason: string | null;
  }[];
}

export interface SupplierView {
  /** Weekly dates, the recorded run's last day among them. */
  dates: string[];
  cards: SeriesCard[];
  names: Record<string, { name: string; qualification: string; account: string | null }>;
  materials: Record<string, { name: string; uom: "kg" | "ea" }>;
  records: Record<string, { receipts: ReceiptRow[]; pos: PoRow[]; lots: LotRow[] }>;
  rfqs: RfqSummary[];
  /** Average PO unit price per supplier, material and month over the whole world. */
  prices: { vendor: string; material: string; months: [string, number][] }[];
  incidents: { id: string; title: string; date: string; suppliers: string[]; narrative: string }[];
}

const day = (iso: string) => iso.slice(0, 10);

/** Every 7 days from `start` to `end`, through `pin`. */
export function weeklyGrid(start: string, end: string, pin: string): string[] {
  let first = pin;
  while (addDays(first, -7) >= start) first = addDays(first, -7);
  const out: string[] = [];
  for (let d = first; d <= end; d = addDays(d, 7)) out.push(d);
  return out;
}

export function supplierView(worlds: readonly World[], pin: string): SupplierView {
  const cal = worlds[0]?.meta.calendar;
  if (!cal) throw new Error("no worlds");
  const dates = weeklyGrid(addDays(cal.start, 7), cal.end, pin);
  const f = facts(worlds);
  const snapshots = dates.map((d) => scorecardsOf(f, d));

  const cards = new Map<string, SeriesCard>();
  const keyOf = (c: Card) => `${c.vendor}|${c.material ?? ""}`;
  snapshots.forEach((snap, i) => {
    for (const s of snap.suppliers)
      for (const c of [s, ...s.materials]) {
        const key = keyOf(c);
        let row = cards.get(key);
        if (!row) {
          const empty = () => dates.map(() => null);
          row = {
            vendor: c.vendor,
            material: c.material,
            score: empty(),
            scoreYear: empty(),
            onTime: empty(),
            qc: empty(),
            price: empty(),
            invoice: empty(),
            responsiveness: empty(),
            daysLate: empty(),
            status: [],
          };
          cards.set(key, row);
        }
        const date = dates[i] ?? "";
        row.score[i] = c.scoreTrailing;
        row.scoreYear[i] = c.scoreYear;
        row.onTime[i] = c.trailing.onTimeRate;
        row.qc[i] = c.trailing.qcPassRate;
        row.price[i] = c.trailing.priceCompetitiveness;
        row.invoice[i] = c.trailing.invoiceAccuracy;
        row.responsiveness[i] = c.trailing.responsiveness;
        row.daysLate[i] = c.trailing.avgDaysLate;
        const last = row.status.at(-1);
        if (!last || last[1] !== c.status || last[2] !== c.override)
          row.status.push([date, c.status, c.override]);
      }
  });

  const records: SupplierView["records"] = {};
  const of = (vendor: string) => {
    records[vendor] ??= { receipts: [], pos: [], lots: [] };
    return records[vendor];
  };
  for (const w of worlds) {
    const plant = w.meta.facility;
    const po = new Map(w.pos.map((p) => [p.poNo, p]));
    for (const p of w.pos)
      of(p.vendor).pos.push([
        p.poNo,
        day(p.orderedAt),
        plant,
        [...new Set(p.lines.map((l) => l.material))].join(", "),
        p.totalUsdc,
      ]);
    for (const r of w.receipts) {
      const p = po.get(r.poNo);
      if (!p) continue;
      of(p.vendor).receipts.push([
        day(r.receivedAt),
        daysBetween(day(p.orderedAt), day(r.receivedAt)),
        r.daysLate,
        r.poNo,
        plant,
      ]);
    }
    for (const l of w.lots) {
      if (l.transferNo) continue;
      of(l.vendor).lots.push([
        l.lot,
        day(l.receivedAt),
        l.material,
        plant,
        l.qc?.result ?? null,
        l.qc ? day(l.qc.at) : null,
      ]);
    }
  }
  for (const r of Object.values(records)) {
    r.receipts.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    r.pos.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    r.lots.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  }

  const rfqs = new Map<string, RfqSummary>();
  for (const w of worlds)
    for (const r of w.rfqs) {
      if (rfqs.has(r.rfqNo)) continue;
      const m = material(r.material);
      rfqs.set(r.rfqNo, {
        rfqNo: r.rfqNo,
        material: r.material,
        materialName: m.name,
        uom: m.uom,
        qtyBase: r.qtyBase,
        day: day(r.at),
        winner: r.winner,
        quotes: r.quotes.map((q) => ({
          vendor: q.vendor,
          unitPriceUsdc: q.unitPriceUsdc,
          freightUsdc: q.freightUsdc,
          leadDays: q.leadDays,
          landedUsdc: extended(r.material, r.qtyBase, q.unitPriceUsdc) + q.freightUsdc,
          status: q.status,
          reason: q.reason,
        })),
      });
    }

  const used = new Set(f.lines.map((l) => l.material));
  const materials: SupplierView["materials"] = {};
  for (const code of [...used, ...[...rfqs.values()].map((r) => r.material)].sort()) {
    const m = material(code);
    materials[code] = { name: m.name, uom: m.uom };
  }

  const prices = new Map<string, Map<string, number[]>>();
  for (const l of f.lines) {
    const key = `${l.vendor}|${l.material}`;
    const months = prices.get(key) ?? new Map<string, number[]>();
    months.set(month(l.day), [...(months.get(month(l.day)) ?? []), l.unitPriceUsdc]);
    prices.set(key, months);
  }

  const incidents = new Map<string, SupplierView["incidents"][number]>();
  for (const w of worlds)
    for (const i of w.incidents) {
      if (i.affected.suppliers.length === 0) continue;
      const seen = incidents.get(i.id);
      incidents.set(i.id, {
        id: i.id,
        title: i.title,
        date: i.date,
        suppliers: [...new Set([...(seen?.suppliers ?? []), ...i.affected.suppliers])].sort(),
        narrative: i.narrative,
      });
    }

  return {
    dates,
    cards: [...cards.values()].sort((a, b) =>
      `${a.vendor}|${a.material ?? ""}` < `${b.vendor}|${b.material ?? ""}` ? -1 : 1,
    ),
    names: Object.fromEntries(
      VENDORS.map((v) => [
        v.code,
        { name: v.name, qualification: v.qualification, account: v.account ?? null },
      ]),
    ),
    materials,
    records,
    rfqs: [...rfqs.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    prices: [...prices.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, months]) => {
        const [vendor = "", code = ""] = key.split("|");
        return {
          vendor,
          material: code,
          months: [...months.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(
              ([m, xs]) =>
                [m, Math.round(xs.reduce((s, x) => s + x, 0) / xs.length)] as [string, number],
            ),
        };
      }),
    incidents: [...incidents.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}
