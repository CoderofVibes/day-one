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
