// The integration program's reads and writes (docs/VISION.md §6.12.3, api/src/journey.ts). Live,
// from the API; on a static host, from the walkthrough npm run web:data records at the end of
// the recorded run (web/src/data/journey.json), read-only and marked as recorded.

import type { ImportView, InboxItem } from "./api.ts";
import type { Source } from "./series.ts";

export interface JourneyItem {
  key: string;
  label: string;
  done: boolean;
  who: string;
  detail?: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  note?: string | null;
}
export interface JourneyStage {
  stage: number;
  key: "meet" | "sheets" | "paper" | "plan" | "rules" | "order" | "books" | "daily";
  title: string;
  summary: string;
  done: boolean;
  items: JourneyItem[];
}
export interface Journey {
  stages: JourneyStage[];
  current: number;
  done: number;
  tally: { label: string; value: number }[];
}
export interface CatalogProduct {
  code: string;
  name: string;
  form: "Tablets" | "Capsules" | "Powder";
  batchUnits: number;
  unitWeightMg: number;
  plants: string[];
  lines: { material: string; name: string; qtyPerBatchBase: number; overageBp: number }[];
}
export interface CatalogVendor {
  code: string;
  name: string;
  qualification: string;
  account: string | null;
  notes: string | null;
  supplies: { material: string; name: string; approved: boolean }[];
}
export interface Catalog {
  products: CatalogProduct[];
  vendors: CatalogVendor[];
}
export interface Reconciliation {
  ok: boolean;
  mode: string;
  contract: string;
  checks: { name: string; ok: boolean; skipped?: boolean; lines: string[] }[];
}
export interface PolicyDraft {
  request: string;
  understood: boolean;
  changes: { field: string; from: string; to: string }[];
  call?: { method: string; args: unknown };
  sentence: string;
}

/** What the static host shows: the program walked through on the recorded run. */
export interface RecordedJourney {
  at: string;
  journey: Journey;
  catalog: Catalog;
  reconciliation: Reconciliation;
  /** The inventory workbook's first rows, cell for cell, as Ray kept it. */
  workbook: { name: string; rows: (string | number | null)[][] };
  /** Kevin's reading of the workbook and the answers Ray gave. */
  importView: ImportView;
  /** The week's scans as Kevin read them and as Ray answered them. */
  scans: InboxItem[];
  /** Kevin's limits as the deployment configures them (CONTRACTS §8). */
  limits: { perPo: string; monthly: string; labCap: string; approver: string };
}

let recorded: Promise<RecordedJourney> | null = null;
export function loadRecorded(): Promise<RecordedJourney> {
  recorded ??= import("./data/journey.json").then((m) => m.default as unknown as RecordedJourney);
  return recorded;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  const parsed = text
    ? (JSON.parse(text) as T & { error?: string })
    : ({} as T & { error?: string });
  if (!res.ok) throw new Error(parsed.error ?? `${method} ${path}: ${res.status}`);
  return parsed;
}

export function readJourney(source: Source): Promise<Journey> {
  return source.live ? call<Journey>("GET", "api/journey") : loadRecorded().then((r) => r.journey);
}
export function readCatalog(source: Source): Promise<Catalog> {
  return source.live ? call<Catalog>("GET", "api/catalog") : loadRecorded().then((r) => r.catalog);
}
export function readReconciliation(source: Source): Promise<Reconciliation> {
  return source.live
    ? call<Reconciliation>("GET", "api/erp/reconcile")
    : loadRecorded().then((r) => r.reconciliation);
}

export function postDecision(input: {
  stage: number;
  item: string;
  decision?: "started" | "confirmed" | "approved" | "held";
  staff?: string;
  note?: string;
}): Promise<Journey> {
  return call<Journey>("POST", "api/journey/decisions", input);
}
export function postDropScans(all = false) {
  return call<{ items: InboxItem[] }>("POST", "api/batch-records/inbox", { all });
}
export function postPolicyDraft(request: string): Promise<PolicyDraft> {
  return call<PolicyDraft>("POST", "api/policy/draft", { request });
}
