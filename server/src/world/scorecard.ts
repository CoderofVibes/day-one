// Supplier scorecards (docs/UPGRADE_BRIEF.md §2.2): per supplier and material, over the trailing
// 90 days and the full year, from every plant's records. Pure: the same worlds and date give the
// same cards, and every number is recomputable from the records with the formula in config.ts
// SCORECARD. Lots a sister plant sent over are counted once, at the plant that bought them.

import { VENDORS } from "../seed/reference.ts";
import { addDays, month } from "./calendar.ts";
import { SCORECARD } from "./config.ts";
import type { World } from "./index.ts";

export interface Metrics {
  receipts: number;
  /** On-time receipts / receipts. */
  onTimeRate: number | null;
  /** Mean days past the promised day, over the late receipts. */
  avgDaysLate: number | null;
  tested: number;
  /** Released lots / tested lots. */
  qcPassRate: number | null;
  /** QC rejects in a row at the window's end. */
  consecutiveRejects: number;
  /** Average unit price on the window's POs, USDC base units per kg or each. */
  avgUnitPriceUsdc: number | null;
  /** The best qualified supplier's average unit price / this one's (1 = the cheapest). */
  priceCompetitiveness: number | null;
  bills: number;
  /** Matched bills / bills. */
  invoiceAccuracy: number | null;
  invited: number;
  /** Quotes returned / RFQs invited. */
  responsiveness: number | null;
}

export interface Card {
  vendor: string;
  name: string;
  qualification: string;
  material: string | null;
  trailing: Metrics;
  year: Metrics;
  /** 0–100, null when the window holds nothing to score. */
  scoreTrailing: number | null;
  scoreYear: number | null;
  /** "suspended" when the QC override applies, else the supplier's qualification. */
  status: string;
  override: string | null;
}

export interface Scorecards {
  asOf: string;
  windows: { trailing: { from: string; to: string }; year: { from: string; to: string } };
  weights: typeof SCORECARD.weights;
  formula: string;
  /** One card per supplier (all materials) and one per supplier and material. */
  suppliers: (Card & { materials: Card[] })[];
  /** Average PO unit price per supplier and material by month: [month, USDC base units]. */
  priceHistory: { vendor: string; material: string; months: [string, number][] }[];
}

export const FORMULA =
  "score = 100 × (35·QC + 30·on-time + 15·invoice accuracy + 10·price competitiveness + " +
  "10·responsiveness) / (sum of the weights scored), each component 0–1; a component with no " +
  "records in the window drops out. Two QC rejects in a row: suspended.";

interface Facts {
  receipts: { vendor: string; material: string; day: string; daysLate: number }[];
  qc: { vendor: string; material: string; at: string; released: boolean }[];
  lines: { vendor: string; material: string; day: string; unitPriceUsdc: number }[];
  bills: { vendor: string; materials: string[]; day: string; matched: boolean }[];
  quotes: { vendor: string; material: string; day: string; returned: boolean }[];
}

/** Every record a scorecard reads, flattened from the worlds. */
export function facts(worlds: readonly World[]): Facts {
  const out: Facts = { receipts: [], qc: [], lines: [], bills: [], quotes: [] };
  const rfqsSeen = new Set<string>();
  for (const w of worlds) {
    const vendorOf = new Map(w.pos.map((p) => [p.poNo, p.vendor]));
    for (const r of w.receipts) {
      const vendor = vendorOf.get(r.poNo);
      if (!vendor) continue;
      for (const material of new Set(r.lines.map((l) => l.material)))
        out.receipts.push({
          vendor,
          material,
          day: r.receivedAt.slice(0, 10),
          daysLate: r.daysLate,
        });
    }
    for (const l of w.lots) {
      if (!l.qc || l.transferNo) continue;
      out.qc.push({
        vendor: l.vendor,
        material: l.material,
        at: l.qc.at,
        released: l.qc.result === "released",
      });
    }
    for (const p of w.pos) {
      for (const l of p.lines)
        out.lines.push({
          vendor: p.vendor,
          material: l.material,
          day: p.orderedAt.slice(0, 10),
          unitPriceUsdc: l.unitPriceUsdc,
        });
    }
    for (const b of w.bills)
      out.bills.push({
        vendor: b.vendor,
        materials: b.lines.map((l) => l.material),
        day: b.billDate,
        matched: b.match === "matched",
      });
    for (const r of w.rfqs) {
      if (rfqsSeen.has(r.rfqNo)) continue;
      rfqsSeen.add(r.rfqNo);
      for (const q of r.quotes)
        out.quotes.push({
          vendor: q.vendor,
          material: r.material,
          day: r.at.slice(0, 10),
          // Every invited supplier on file quotes; Kevin excluding one is not a missed quote.
          returned: q.unitPriceUsdc > 0,
        });
    }
  }
  out.qc.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10_000) / 10_000);
const avg = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);

function metrics(
  f: Facts,
  vendor: string,
  material: string | null,
  from: string,
  to: string,
  best: ReadonlyMap<string, number>,
): Metrics {
  const mine = <T extends { vendor: string; material: string }>(xs: T[], day: (x: T) => string) =>
    xs.filter(
      (x) =>
        x.vendor === vendor &&
        (material === null || x.material === material) &&
        day(x) >= from &&
        day(x) <= to,
    );
  const receipts = mine(f.receipts, (r) => r.day);
  const late = receipts.filter((r) => r.daysLate > 0);
  const qc = mine(f.qc, (q) => q.at.slice(0, 10));
  let streak = 0;
  for (let i = qc.length - 1; i >= 0 && !qc[i]?.released; i--) streak++;
  const lines = mine(f.lines, (l) => l.day);
  const price = avg(lines.map((l) => l.unitPriceUsdc));
  // Competitiveness per material, averaged over the supplier's materials for the supplier card.
  const byMaterial = new Map<string, number[]>();
  for (const l of lines)
    byMaterial.set(l.material, [...(byMaterial.get(l.material) ?? []), l.unitPriceUsdc]);
  const comp: number[] = [];
  for (const [m, prices] of byMaterial) {
    const b = best.get(m);
    const a = avg(prices);
    if (b !== undefined && a) comp.push(Math.min(1, b / a));
  }
  const bills = f.bills.filter(
    (b) =>
      b.vendor === vendor &&
      (material === null || b.materials.includes(material)) &&
      b.day >= from &&
      b.day <= to,
  );
  const quotes = mine(f.quotes, (q) => q.day);
  return {
    receipts: receipts.length,
    onTimeRate: ratio(receipts.length - late.length, receipts.length),
    avgDaysLate:
      late.length === 0 ? null : Math.round((avg(late.map((r) => r.daysLate)) ?? 0) * 10) / 10,
    tested: qc.length,
    qcPassRate: ratio(qc.filter((q) => q.released).length, qc.length),
    consecutiveRejects: streak,
    avgUnitPriceUsdc: price === null ? null : Math.round(price),
    priceCompetitiveness: comp.length === 0 ? null : Math.round((avg(comp) ?? 0) * 10_000) / 10_000,
    bills: bills.length,
    invoiceAccuracy: ratio(bills.filter((b) => b.matched).length, bills.length),
    invited: quotes.length,
    responsiveness: ratio(quotes.filter((q) => q.returned).length, quotes.length),
  };
}

/** The 0–100 reputation score: SCORECARD's weights over the components the window has. */
export function score(m: Metrics): number | null {
  const w = SCORECARD.weights;
  const parts: [number, number | null][] = [
    [w.qc, m.qcPassRate],
    [w.onTime, m.onTimeRate],
    [w.invoiceAccuracy, m.invoiceAccuracy],
    [w.priceCompetitiveness, m.priceCompetitiveness],
    [w.responsiveness, m.responsiveness],
  ];
  const scored = parts.filter((p): p is [number, number] => p[1] !== null);
  const weight = scored.reduce((s, [k]) => s + k, 0);
  if (weight === 0) return null;
  return Math.round((100 * scored.reduce((s, [k, v]) => s + k * v, 0)) / weight);
}

/** The cheapest qualified supplier's average unit price per material in a window. */
function bestPrices(f: Facts, from: string, to: string) {
  const qualified = new Set(
    VENDORS.filter((v) => v.qualification === "qualified" || v.qualification === "conditional").map(
      (v) => v.code,
    ),
  );
  const sums = new Map<string, number[]>();
  for (const l of f.lines) {
    if (!qualified.has(l.vendor) || l.day < from || l.day > to) continue;
    const key = `${l.material}|${l.vendor}`;
    sums.set(key, [...(sums.get(key) ?? []), l.unitPriceUsdc]);
  }
  const best = new Map<string, number>();
  for (const [key, prices] of sums) {
    const [m = ""] = key.split("|");
    const a = avg(prices) ?? 0;
    if (!best.has(m) || a < (best.get(m) ?? 0)) best.set(m, a);
  }
  return best;
}

export function scorecards(worlds: readonly World[], asOf: string): Scorecards {
  const f = facts(worlds);
  const trailing = { from: addDays(asOf, -(SCORECARD.trailingDays - 1)), to: asOf };
  const year = { from: addDays(asOf, -(SCORECARD.yearDays - 1)), to: asOf };
  const bestTrailing = bestPrices(f, trailing.from, trailing.to);
  const bestYear = bestPrices(f, year.from, year.to);
  const card = (vendor: string, material: string | null): Card => {
    const v = VENDORS.find((x) => x.code === vendor);
    const t = metrics(f, vendor, material, trailing.from, trailing.to, bestTrailing);
    const y = metrics(f, vendor, material, year.from, year.to, bestYear);
    const over = y.consecutiveRejects >= SCORECARD.suspendAfterRejects;
    const qualification = v?.qualification ?? "unknown";
    return {
      vendor,
      name: v?.name ?? vendor,
      qualification,
      material,
      trailing: t,
      year: y,
      scoreTrailing: score(t),
      scoreYear: score(y),
      // A supplier that never qualified stays unqualified; a qualified one is suspended.
      status: over && qualification !== "unqualified" ? "suspended" : qualification,
      override: over ? `${y.consecutiveRejects} QC rejects in a row` : null,
    };
  };
  const pairs = new Map<string, Set<string>>();
  for (const x of [...f.receipts, ...f.lines, ...f.quotes]) {
    if (x.day > asOf) continue;
    pairs.set(x.vendor, (pairs.get(x.vendor) ?? new Set()).add(x.material));
  }
  const suppliers = [...pairs.keys()].sort().map((vendor) => ({
    ...card(vendor, null),
    materials: [...(pairs.get(vendor) ?? [])].sort().map((m) => card(vendor, m)),
  }));
  for (const s of suppliers) {
    // The supplier's override follows any of its materials'.
    const worst = s.materials.find((m) => m.override);
    if (worst && !s.override) {
      s.override = worst.override;
      s.status = worst.status;
    }
  }
  const history = new Map<string, Map<string, number[]>>();
  for (const l of f.lines) {
    if (l.day > asOf) continue;
    const key = `${l.vendor}|${l.material}`;
    const months = history.get(key) ?? new Map<string, number[]>();
    months.set(month(l.day), [...(months.get(month(l.day)) ?? []), l.unitPriceUsdc]);
    history.set(key, months);
  }
  return {
    asOf,
    windows: { trailing, year },
    weights: SCORECARD.weights,
    formula: FORMULA,
    suppliers,
    priceHistory: [...history.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, months]) => {
        const [vendor = "", material = ""] = key.split("|");
        return {
          vendor,
          material,
          months: [...months.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([m, prices]) => [m, Math.round(avg(prices) ?? 0)] as [string, number]),
        };
      }),
  };
}
