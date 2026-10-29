// The RPC behind every live call, made to survive a slow or dead testnet endpoint. near-api-js
// retries some HTTP errors itself, but not Node's "fetch failed", never times a request out, and
// its own FailoverRpcProvider also switches on a contract's refusal and then hides the refusal
// under "Exceeded 2 providers". This wrapper times each request out, moves to the next endpoint
// only when the network failed, and keeps the endpoint that answered for the calls after it.
// Moving a send to another endpoint resends the same signed transaction (same hash), so nothing
// can be signed or paid twice.

import { JsonRpcProvider } from "near-api-js";

/** The public testnet RPC the live run falls back to when NEAR_RPC_URL does not answer. */
export const TESTNET_FALLBACK_RPC = "https://rpc.testnet.near.org";
export const DEFAULT_TESTNET_RPC = "https://test.rpc.fastnear.com";

/** Long enough for send_tx to wait for execution; views answer in well under a second. */
const SEND_TIMEOUT_MS = 90_000;
const VIEW_TIMEOUT_MS = 20_000;
const SENDS = new Set(["sendTransaction", "sendTransactionUntil", "sendTransactionAsync"]);

/** The endpoints to try in order: NEAR_RPC_URL (or the given one), then the public fallback. */
export function rpcUrls(
  network: string,
  primary: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const first = primary ?? env.NEAR_RPC_URL ?? DEFAULT_TESTNET_RPC;
  const fallback = network === "testnet" ? (env.NEAR_RPC_FALLBACK_URL ?? TESTNET_FALLBACK_RPC) : "";
  return [...new Set([first, fallback].filter(Boolean))];
}

/** No endpoint answered; the message names them and says what to do, in plain words. */
export class RpcUnavailableError extends Error {
  override name = "RpcUnavailableError";
}

const NETWORK = [
  /fetch failed/i,
  /failed to fetch/i,
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR/,
  /socket hang up/i,
  /did not answer in \d+ s/,
  /Exceeded \d+ attempts/i,
  /Internal server error|Bad Gateway|unavailable$|Timeout error|Too Many Requests/i,
];

/** True when the request never got a real answer (as opposed to the chain answering "no"). */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof RpcUnavailableError) return true;
  const cause = (error as { cause?: unknown }).cause;
  const codes = [error.message, (cause as { code?: string } | undefined)?.code ?? ""];
  if (typeof cause === "number" && [408, 429, 500, 502, 503, 504].includes(cause)) return true;
  return codes.some((text) => NETWORK.some((re) => re.test(text)));
}

function withTimeout<T>(work: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${url} did not answer in ${Math.round(ms / 1000)} s`)),
      ms,
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export interface ResilientOptions {
  /** Builds the provider for one endpoint; a JsonRpcProvider with short retries by default. */
  make?: (url: string) => object;
  sendTimeoutMs?: number;
  viewTimeoutMs?: number;
}

/**
 * A provider over several endpoints that behaves like one JsonRpcProvider. Every method call
 * goes to the endpoint that last answered; a network failure or a timeout moves it to the next.
 */
export function resilientProvider(urls: string[], options: ResilientOptions = {}): JsonRpcProvider {
  if (!urls.length) throw new Error("no RPC endpoint");
  const make =
    options.make ??
    ((url: string) => new JsonRpcProvider({ url }, { retries: 4, wait: 300, backoff: 1.5 }));
  const providers = urls.map((url) => make(url) as Record<string | symbol, unknown>);
  let active = 0;

  const call = async (method: string | symbol, args: unknown[]) => {
    const timeout = SENDS.has(String(method))
      ? (options.sendTimeoutMs ?? SEND_TIMEOUT_MS)
      : (options.viewTimeoutMs ?? VIEW_TIMEOUT_MS);
    let last: unknown;
    for (let tried = 0; tried < providers.length; tried++) {
      const at = (active + tried) % providers.length;
      const provider = providers[at] as Record<string | symbol, unknown>;
      const fn = provider[method] as (...a: unknown[]) => Promise<unknown>;
      try {
        const result = await withTimeout(
          Promise.resolve(fn.apply(provider, args)),
          timeout,
          urls[at] as string,
        );
        active = at;
        return result;
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        last = error;
      }
    }
    const why = last instanceof Error ? last.message : String(last);
    throw new RpcUnavailableError(
      `NEAR ${urls.length > 1 ? "RPC endpoints" : "RPC endpoint"} ${urls.join(" and ")} did not answer (${why}). ` +
        "Check the internet connection, or set NEAR_RPC_URL in .env to another testnet RPC; npm run preflight checks it.",
    );
  };

  return new Proxy(providers[0] as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || prop === "constructor") return value;
      return (...args: unknown[]) => call(prop, args);
    },
  }) as JsonRpcProvider;
}
