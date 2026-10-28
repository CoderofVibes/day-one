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

export function postJson(path: string, body: unknown = {}): Promise<ActionResult> {
  return request<ActionResult>("POST", path, JSON.stringify(body), "application/json");
}

export function postImage(path: string, file: Blob, name: string): Promise<ActionResult> {
  const query = `?name=${encodeURIComponent(name)}`;
  return request<ActionResult>("POST", `${path}${query}`, file, file.type || "image/jpeg");
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
