// Checks a lot passport in the browser (docs/REFERENCE_IDEAS_PLAN.md, C): each disclosed record
// is hashed again with Web Crypto, walked up its Merkle path to its day's root, and the root is
// compared with the anchor the contract holds, read straight from testnet RPC with a view call.
// No keys and no server: the same arithmetic as server/src/lots/merkle.ts (a test runs both on
// the same book), so anyone can check what the page shows.

export interface PassportLeaf {
  kind: "receipt" | "qc" | "batch" | "shipment" | "payment";
  id: string;
  plant: string;
  at: string;
  salt: string;
  record: Record<string, unknown>;
}
export interface PassportStep {
  sibling: string;
  side: "left" | "right";
}
export interface PassportEntry {
  leaf: PassportLeaf;
  refId: string;
  root: string;
  proof: PassportStep[];
  anchoredTx: string | null;
}
export interface Passport {
  version: 1;
  lot: string;
  contract: string | null;
  entries: PassportEntry[];
}

/** Keys sorted at every level, no whitespace: the same text server/src/canonical.ts hashes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const leafHash = (leaf: PassportLeaf) => sha256Hex(`L${canonicalJson(leaf)}`);

export async function rootFrom(leaf: string, proof: PassportStep[]): Promise<string> {
  let h = leaf;
  for (const s of proof)
    h = await sha256Hex(s.side === "right" ? `N${h}${s.sibling}` : `N${s.sibling}${h}`);
  return h;
}

/** What the contract holds for a ref_id: the anchored fingerprint, who anchored it and when. */
export interface OnChainAnchor {
  kind: string;
  hash: string;
  prev: string | null;
  by: string;
  at: string;
}

export const TESTNET_RPCS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];

/** `get_anchor` on the contract, as a read-only view call; null when nothing is anchored there. */
export async function readAnchor(
  contract: string,
  refId: string,
  fetcher: typeof fetch = fetch,
): Promise<OnChainAnchor | null> {
  const args = btoa(JSON.stringify({ ref_id: refId }));
  let lastError: unknown = null;
  for (const url of TESTNET_RPCS) {
    try {
      const res = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "lot-proof",
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: contract,
            method_name: "get_anchor",
            args_base64: args,
          },
        }),
      });
      const body = (await res.json()) as { result?: { result?: number[] }; error?: unknown };
      if (!body.result?.result) throw new Error(JSON.stringify(body.error ?? "no result"));
      const text = new TextDecoder().decode(new Uint8Array(body.result.result));
      return JSON.parse(text) as OnChainAnchor | null;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export type EntryVerdict =
  /** The record leads to its root and the contract holds that root. */
  | "proved"
  /** The record leads to its root; the root was not checked on chain (offline). */
  | "path-only"
  /** The record does not lead to the root it names: it was changed. */
  | "changed"
  /** The record leads to its root, but the contract holds a different root or none. */
  | "not-anchored";

export interface EntryCheck {
  key: string;
  refId: string;
  verdict: EntryVerdict;
}

/**
 * Checks every entry: the path always, and each distinct root against the chain when `online`.
 * A root the chain cannot be asked about leaves its entries at "path-only", never "proved".
 */
export async function checkPassport(
  p: Passport,
  options: { online: boolean; fetcher?: typeof fetch } = { online: true },
): Promise<{ entries: EntryCheck[]; chain: Record<string, OnChainAnchor | null | "unreachable"> }> {
  const chain: Record<string, OnChainAnchor | null | "unreachable"> = {};
  if (options.online && p.contract) {
    for (const refId of new Set(p.entries.map((e) => e.refId))) {
      try {
        chain[refId] = await readAnchor(p.contract, refId, options.fetcher);
      } catch {
        chain[refId] = "unreachable";
      }
    }
  }
  const entries: EntryCheck[] = [];
  for (const e of p.entries) {
    const key = `${e.leaf.kind}:${e.leaf.id}`;
    const reached = await rootFrom(await leafHash(e.leaf), e.proof);
    let verdict: EntryVerdict;
    if (reached !== e.root) verdict = "changed";
    else {
      const on = chain[e.refId];
      if (on === undefined || on === "unreachable") verdict = "path-only";
      else verdict = on && on.hash === e.root ? "proved" : "not-anchored";
    }
    entries.push({ key, refId: e.refId, verdict });
  }
  return { entries, chain };
}
