// The Suppliers page's reads (docs/UPGRADE_BRIEF.md §2.2, §5.6): the scorecards at the clock's
// date from the weekly grid npm run web:data writes (server/src/world/supplierView.ts, scored by
// server/src/world/scorecard.ts with the weights in config.ts SCORECARD), each supplier's credential
// in staff words, its records cut at the clock, and "Why Kevin picks them" from an RFQ's quotes.
// Pure, so the page and the tests read the same numbers.

import { dollars, qty } from "./charts.tsx";
import type { SupplierStanding } from "./reads.ts";
import type { Tone } from "./run.ts";

export interface Weights {
  qc: number;
  onTime: number;
  invoiceAccuracy: number;
  priceCompetitiveness: number;
  responsiveness: number;
}

export interface SeriesCard {
  vendor: string;
  material: string | null;
  score: (number | null)[];
  scoreYear: (number | null)[];
  onTime: (number | null)[];
  qc: (number | null)[];
  price: (number | null)[];
  invoice: (number | null)[];
  responsiveness: (number | null)[];
  daysLate: (number | null)[];
  status: [string, string, string | null][];
}

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
    landedUsdc: number;
    status: "accepted" | "declined" | "excluded";
    reason: string | null;
  }[];
}

export interface CredentialTx {
  supplier: string;
  method: string;
  signer: string;
  ok: boolean;
  hash: string;
  url: string;
  what: string;
  recordedAt: string;
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

export interface SuppliersData {
  /** The recorded run's last day: the generated era after it is simulated. */
  asOf: string;
  windows: { trailing: { from: string; to: string }; year: { from: string; to: string } };
  weights: Weights;
  formula: string;
  view: {
    dates: string[];
    cards: SeriesCard[];
    names: Record<string, { name: string; qualification: string; account: string | null }>;
    materials: Record<string, { name: string; uom: "kg" | "ea" }>;
    records: Record<string, { receipts: ReceiptRow[]; pos: PoRow[]; lots: LotRow[] }>;
    rfqs: RfqSummary[];
    prices: { vendor: string; material: string; months: [string, number][] }[];
    incidents: {
      id: string;
      title: string;
      date: string;
      suppliers: string[];
      narrative: string;
    }[];
  };
  recorded: { rfqs: RfqSummary[]; credentialTxs: CredentialTx[] };
}

let loaded: Promise<SuppliersData> | null = null;

export function readSuppliers(): Promise<SuppliersData> {
  loaded ??= import("./data/suppliers.json").then((m) => m.default as unknown as SuppliersData);
  return loaded;
}

/** The formula's terms, from the weights the scorecards were computed with. */
export const COMPONENTS: { key: keyof Weights; label: string; what: string }[] = [
  { key: "qc", label: "QC", what: "released lots / tested lots" },
  { key: "onTime", label: "on-time", what: "on-time receipts / receipts" },
  { key: "invoiceAccuracy", label: "invoice accuracy", what: "matched bills / bills" },
  {
    key: "priceCompetitiveness",
    label: "price competitiveness",
    what: "best qualified average unit price / this supplier's",
  },
  { key: "responsiveness", label: "responsiveness", what: "quotes returned / RFQs invited" },
];

export function formulaText(w: Weights): string {
  const sum = COMPONENTS.reduce((s, c) => s + w[c.key], 0);
  return `score = 100 × (${COMPONENTS.map((c) => `${w[c.key]}·${c.label}`).join(" + ")}) / ${sum}`;
}

// ------------------------------------------------------------------ the clock's date

/** The last grid date on or before `date`; -1 before the first. */
export function gridIndex(dates: readonly string[], date: string): number {
  let i = -1;
  for (let k = 0; k < dates.length && (dates[k] ?? "") <= date; k++) i = k;
  return i;
}

export interface At {
  /** The 90-day score; null with nothing to score or when two QC rejects in a row override it. */
  score: number | null;
  scoreYear: number | null;
  onTime: number | null;
  qc: number | null;
  price: number | null;
  invoice: number | null;
  responsiveness: number | null;
  daysLate: number | null;
  status: string;
  override: string | null;
}

/** A card on grid date `i`; null when it had no records yet. */
export function cardAt(c: SeriesCard, dates: readonly string[], i: number): At | null {
  const date = dates[i];
  if (date === undefined) return null;
  const run = [...c.status].reverse().find(([from]) => from <= date);
  if (!run) return null;
  const [, status, override] = run;
  return {
    score: override ? null : (c.score[i] ?? null),
    scoreYear: override ? null : (c.scoreYear[i] ?? null),
    onTime: c.onTime[i] ?? null,
    qc: c.qc[i] ?? null,
    price: c.price[i] ?? null,
    invoice: c.invoice[i] ?? null,
    responsiveness: c.responsiveness[i] ?? null,
    daysLate: c.daysLate[i] ?? null,
    status,
    override,
  };
}

// ------------------------------------------------------------------ credentials

export type Credential = "active" | "suspended" | "revoked" | "expired" | "not qualified";

export const CREDENTIAL_TONE: Record<Credential, Tone> = {
  active: "paid",
  suspended: "refused",
  revoked: "refused",
  expired: "waiting",
  "not qualified": "refused",
};

/** The credential the contract reported for a supplier: by its account, or its name's first word. */
export function standingOf(
  vendor: string,
  names: SuppliersData["view"]["names"],
  standings: readonly SupplierStanding[],
): SupplierStanding | undefined {
  const n = names[vendor];
  if (!n) return undefined;
  return standings.find(
    (s) =>
      s.supplier === n.account ||
      n.name.toLowerCase().startsWith(`${s.supplier.split(/[-.]/)[0] ?? "?"} `),
  );
}

/** The credential chip: the contract's recorded standing first, the scorecard's status else. */
export function credentialOf(status: string, standing?: SupplierStanding): Credential {
  if (standing?.standing === "Revoked") return "revoked";
  if (standing?.standing === "Expired") return "expired";
  if (standing?.standing === "Suspended") return "suspended";
  if (status === "suspended") return "suspended";
  if (status === "unqualified") return "not qualified";
  return "active";
}

// ------------------------------------------------------------------ the leaderboard

export interface MaterialRow extends At {
  material: string;
  name: string;
}

export interface LeaderRow extends At {
  vendor: string;
  name: string;
  credential: Credential;
  /** The 90-day score on each grid date up to the clock, for the trend sparkline. */
  trend: { date: string; score: number }[];
  materials: MaterialRow[];
}

/** Score first (empty last), then the year's score, then the name: the leaderboard's order. */
export function byScore(a: At & { name: string }, b: At & { name: string }): number {
  const s = (x: number | null) => (x === null ? -1 : x);
  return s(b.score) - s(a.score) || s(b.scoreYear) - s(a.scoreYear) || a.name.localeCompare(b.name);
}

/** Every supplier with records by the clock's date, scored at the last grid date on or before it. */
export function leaderboard(
  data: SuppliersData,
  date: string,
  standings: readonly SupplierStanding[],
  trendWeeks = 26,
): LeaderRow[] {
  const { dates, cards, names, materials } = data.view;
  const i = gridIndex(dates, date);
  if (i < 0) return [];
  const rows: LeaderRow[] = [];
  for (const c of cards) {
    if (c.material !== null) continue;
    const at = cardAt(c, dates, i);
    if (!at) continue;
    const name = names[c.vendor]?.name ?? c.vendor;
    const trend: LeaderRow["trend"] = [];
    for (let k = Math.max(0, i - trendWeeks + 1); k <= i; k++) {
      const v = c.score[k];
      if (v !== null && v !== undefined) trend.push({ date: dates[k] ?? "", score: v });
    }
    const mats = cards
      .filter((m) => m.vendor === c.vendor && m.material !== null)
      .flatMap((m): MaterialRow[] => {
        const a = cardAt(m, dates, i);
        const code = m.material ?? "";
        return a ? [{ ...a, material: code, name: materials[code]?.name ?? code }] : [];
      })
      .sort(byScore);
    rows.push({
      ...at,
      vendor: c.vendor,
      name,
      credential: credentialOf(at.status, standingOf(c.vendor, names, standings)),
      trend,
      materials: mats,
    });
  }
  return rows.sort(byScore);
}

// ------------------------------------------------------------------ the detail view

/** A supplier's records as they stood on the clock's date: QC results only once they were in. */
export function recordsAt(data: SuppliersData, vendor: string, date: string) {
  const r = data.view.records[vendor] ?? { receipts: [], pos: [], lots: [] };
  return {
    receipts: r.receipts.filter((x) => x[0] <= date),
    pos: r.pos.filter((x) => x[1] <= date),
    lots: r.lots
      .filter((x) => x[1] <= date)
      .map((x): LotRow => (x[5] && x[5] <= date ? x : [x[0], x[1], x[2], x[3], null, null])),
  };
}

/** The RFQs a supplier quoted on by the clock's date, newest first, the recorded run's included. */
export function rfqsFor(data: SuppliersData, vendor: string, date: string, n = 3): RfqSummary[] {
  return [
    ...data.recorded.rfqs.map((r) => ({ r, recorded: true })),
    ...data.view.rfqs.map((r) => ({ r, recorded: false })),
  ]
    .filter(({ r }) => r.day <= date && r.quotes.some((q) => q.vendor === vendor))
    .sort((a, b) =>
      a.r.day === b.r.day ? Number(b.recorded) - Number(a.recorded) : a.r.day < b.r.day ? 1 : -1,
    )
    .slice(0, n)
    .map(({ r }) => r);
}

const plainReason = (reason: string | null) => (reason ?? "excluded").replace(/^vendor /, "");

/**
 * Two lines on an RFQ: who Kevin selected and why (the lowest landed cost of the qualified quotes,
 * fastest on a tie), then the runner-up and who was left out. `scoreOf` adds the supplier's score.
 */
export function whyLines(
  rfq: RfqSummary,
  nameOf: (vendor: string) => string,
  scoreOf: (vendor: string) => number | null,
): [string, string] {
  const eligible = rfq.quotes
    .filter((q) => q.status !== "excluded")
    .sort((a, b) => a.landedUsdc - b.landedUsdc || a.leadDays - b.leadDays);
  const winner = rfq.quotes.find((q) => q.vendor === rfq.winner);
  const unit = rfq.uom === "kg" ? "/kg" : " each";
  const scored = (v: string) => {
    const s = scoreOf(v);
    return s === null ? "" : `; score ${s}`;
  };
  const amount = qty(rfq.qtyBase, rfq.uom === "kg" ? "mass" : "count");
  const first = winner
    ? `${nameOf(winner.vendor)} selected: ${
        eligible[0]?.vendor === winner.vendor ? "lowest landed cost of the qualified quotes, " : ""
      }${dollars(winner.landedUsdc)} for ${amount}${rfq.uom === "ea" ? " each" : ""} (${dollars(winner.unitPriceUsdc)}${unit} + ${dollars(winner.freightUsdc)} freight), ${winner.leadDays} days${scored(winner.vendor)}.`
    : `No quote selected on ${rfq.rfqNo}.`;
  const runner = eligible.find((q) => q.vendor !== rfq.winner);
  const out = rfq.quotes.filter((q) => q.status === "excluded");
  const second = [
    runner
      ? `${nameOf(runner.vendor)} runner-up at ${dollars(runner.landedUsdc)} (${dollars(runner.unitPriceUsdc)}${unit}, ${runner.leadDays} days${scored(runner.vendor)})`
      : "No other qualified quote",
    ...out.map(
      (q) =>
        `${nameOf(q.vendor)} excluded at ${dollars(q.unitPriceUsdc)}${unit}: ${plainReason(q.reason)}`,
    ),
  ].join("; ");
  return [first, `${second}.`];
}
