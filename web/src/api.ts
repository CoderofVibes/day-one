// The HTTP API (api/, npm run api) as the screens call it. When GET /api/run answers, the UI
// runs live: each button sends one staff action and redraws from the state that comes back.
// When it does not answer (a static host), the UI replays the recorded run instead.

import type { RunData, Step } from "./run.ts";

export interface NextAction {
  phase: string;
  who: string | null;
  role: string | null;
  action: string;
  subject: string | null;
  choices: string[];
}

export interface LiveState extends RunData {
  mode: "replay" | "live";
  next: NextAction;
  stopped: string | null;
  ok: boolean | null;
  people: { name: string; role: string }[];
}

export interface ActionResult {
  steps: Step[];
  next: NextAction;
  stopped: string | null;
}

export interface PlantStock {
  onHandBase: number;
  usableBase: number;
  lots: number;
  low: boolean;
}
export interface MaterialStock {
  code: string;
  name: string;
  category: string;
  dimension: string;
  baseUnit: string;
  reorderPointBase: number | null;
  byPlant: Record<string, PlantStock>;
}
export interface DiscrepancyView {
  id: number;
  kind: string;
  status: string;
  lotCode: string | null;
  material: string | null;
  facility: string;
  expectedBase: number;
  observedBase: number;
  explanation: string | null;
  proposed: { facility: string; qtyDeltaBase: number; reason: string | null } | null;
  transferNo: string | null;
}
export interface PlantInventory {
  facilities: { code: string; name: string; role: string }[];
  materials: MaterialStock[];
  discrepancies: DiscrepancyView[];
}

export interface BatchBalance {
  batchNo: string;
  facility: string;
  product: string;
  completedAt: string | null;
  issuedBase: number;
  tablets: number;
  tabletsBase: number;
  qcBase: number;
  wasteBase: number;
  unaccountedBase: number;
  unaccountedBp: number;
  unitEffectBase: number;
  flagged: boolean;
}
export interface ProductPeriodBalance {
  facility: string;
  facilityName: string;
  product: string;
  from: string | null;
  to: string | null;
  batches: number;
  issuedBase: number;
  unaccountedBase: number;
  unaccountedBp: number;
  unitEffectBase: number;
  flagged: boolean;
}
export interface MassBalance {
  batches: BatchBalance[];
  periods: ProductPeriodBalance[];
  sentences: string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/** The run behind /api, or null when no API answers within `timeoutMs`. */
export async function probeApi(timeoutMs = 1500): Promise<LiveState | null> {
  // The API marks the page it serves (api/src/server.ts); Vite's dev server proxies /api.
  const served = document.querySelector('meta[name="day-one-api"]') !== null;
  if (!served && !import.meta.env.DEV) return null;
  try {
    const res = await fetch("api/run", { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    const body = (await res.json()) as Partial<LiveState>;
    return body.next && Array.isArray(body.steps) ? (body as LiveState) : null;
  } catch {
    return null;
  }
}

export function getState(): Promise<LiveState> {
  return request<LiveState>("GET", "api/run");
}

export function getInventory(): Promise<PlantInventory> {
  return request<PlantInventory>("GET", "api/inventory");
}

export function getMassBalance(): Promise<MassBalance> {
  return request<MassBalance>("GET", "api/mass-balance");
}

export interface SettledPo {
  poNo: string;
  vendor: string;
  receivedOn: string | null;
  releasedOn: string | null;
  totalUsdc: number;
  paymentRef: string | null;
  recordRef: string | null;
}
export interface PriceDrift {
  poNo: string;
  vendor: string;
  material: string;
  name: string;
  unit: string;
  unitPriceUsdc: number;
  trailingUsdc: number;
  trailingPoNos: string[];
  driftBp: number;
  sentence: string;
}
export interface Books {
  settled: SettledPo[];
  totalUsdc: number;
  alerts: PriceDrift[];
  sentences: string[];
}

export function getBooks(): Promise<Books> {
  return request<Books>("GET", "api/books");
}

/** The CSV the accounting view links to; the API answers with text/csv as a download. */
export interface PolicyAgent {
  account: string;
  name: string;
  perPoLimit: string;
  monthlyLimit: string;
  categories: string[];
  approver: string;
  active: boolean;
  spentThisMonth: string;
}
export interface PolicyChange {
  method: string;
  signer: string;
  tx: string;
  url: string | null;
  events: string[];
}
/** HQ's view of the limits the contract enforces now (api/src/session.ts PolicyState). */
export type PolicyState =
  | {
      reachable: true;
      policy: {
        readAt: string;
        period: number;
        budget: string;
        escrowed: string;
        agent: PolicyAgent | null;
        categories: { category: string; cap: string | null; spentThisMonth: string }[];
        suppliers: { account: string; status: string | null }[];
      };
      names: Record<string, string>;
      history: PolicyChange[];
    }
  | { reachable: false; error: string; history: PolicyChange[] };

export function getPolicy(): Promise<PolicyState> {
  return request<PolicyState>("GET", "api/policy");
}

export const BOOKS_EXPORT_URL = "api/books/export.csv";

/** Kevin's 5am brief for the acquired plant, one printable page. */
export const BRIEF_URL = "api/brief.html";

export function postReview(
  id: number,
  decision: "apply" | "dismiss",
): Promise<{ status: string; inventory: PlantInventory }> {
  return request(
    "POST",
    `api/discrepancies/${id}/review`,
    JSON.stringify({ decision }),
    "application/json",
  );
}

/** Kevin's proposed moves between plants and the approved ones still on the road. */
export interface TransferSuggestion {
  key: string;
  material: string;
  materialName: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  qtyBase: number;
  valueUsdc: number | null;
  sentence: string;
}
export interface TransferInTransit {
  transferNo: string;
  lotCode: string;
  material: string;
  materialName: string;
  dimension: string;
  from: string;
  to: string;
  qtyBase: number;
}
export interface TransferSuggestions {
  suggestions: TransferSuggestion[];
  inTransit: TransferInTransit[];
  /** Set after a decision or a receipt: Kevin's line about it. */
  sentence?: string;
  discrepancies?: { sentence: string }[];
}

export function getTransferSuggestions(): Promise<TransferSuggestions> {
  return request<TransferSuggestions>("GET", "api/transfer-suggestions");
}

export function postTransferDecision(
  key: string,
  decision: "approve" | "dismiss",
): Promise<TransferSuggestions> {
  return request(
    "POST",
    `api/transfer-suggestions/${encodeURIComponent(key)}/${decision}`,
    "{}",
    "application/json",
  );
}

export function postTransferReceipt(transferNo: string): Promise<TransferSuggestions> {
  return request("POST", `api/transfers/${transferNo}/receive`, "{}", "application/json");
}

export function postJson(path: string, body: unknown = {}): Promise<ActionResult> {
  return request<ActionResult>("POST", path, JSON.stringify(body), "application/json");
}

export function postImage(path: string, file: Blob, name: string): Promise<ActionResult> {
  const query = `?name=${encodeURIComponent(name)}`;
  return request<ActionResult>("POST", `${path}${query}`, file, file.type || "image/jpeg");
}

/** The import wizard (api/src/imports.ts). */
export type ImportAnswer =
  | { answer: "accept" }
  | { answer: "review" }
  | { answer: "quantity"; qty: number; unit: string };
export interface ImportFlag {
  id: string;
  row: number;
  kind: string;
  message: string;
  proposal: string | null;
  answers: ("accept" | "quantity" | "review")[];
}
export interface ImportView {
  id: string;
  fileName: string;
  sheets: string[];
  analysis: {
    sheet: string;
    headerRow: number;
    mapping: Record<string, number>;
    rows: { row: number }[];
    flags: ImportFlag[];
    message: string;
  };
  sales: { message: string; mismatches: { message: string }[] } | null;
  suggestedAnswers: Record<string, ImportAnswer> | null;
  posted: boolean;
  opening: OpeningLine[];
}
export interface OpeningLine {
  material: string;
  name: string;
  lots: string[];
  availableBase: number;
  holdBase: number;
}
export interface ImportReview {
  row: number;
  item: string;
  reason: string;
}
export type ImportResult =
  | { status: "posted"; plan: { lots: unknown[]; review: ImportReview[]; skipped: unknown[] } }
  | { status: "already_imported"; importId: number }
  | { status: "unresolved"; plan: { unresolved: string[] } };

export const IMPORT_FIXTURE = "INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx";

export function postImportFile(file: Blob, name: string): Promise<ImportView> {
  return request(
    "POST",
    `api/imports?name=${encodeURIComponent(name)}`,
    file,
    "application/octet-stream",
  );
}

export function postImportFixture(): Promise<ImportView> {
  return request(
    "POST",
    "api/imports",
    JSON.stringify({ file: IMPORT_FIXTURE }),
    "application/json",
  );
}

export function postImportConfirm(
  id: string,
  answers: Record<string, ImportAnswer>,
): Promise<{ result: ImportResult; opening: OpeningLine[] }> {
  return request(
    "POST",
    `api/imports/${id}/confirm`,
    JSON.stringify({ answers }),
    "application/json",
  );
}

async function request<T>(method: string, path: string, body?: BodyInit, type?: string) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = body;
    if (type) init.headers = { "content-type": type };
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let parsed: { error?: string; hint?: string } & T;
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new ApiError(res.status, text || `${method} ${path} failed`);
  }
  if (!res.ok) {
    throw new ApiError(res.status, parsed.error ?? `${method} ${path} failed`, parsed.hint);
  }
  return parsed as T;
}
