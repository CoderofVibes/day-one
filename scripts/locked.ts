// npm run locked: shows that the spend-policy contract's code cannot change. It asks testnet for
// the contract account's access keys (a read; no keys needed) and passes when there are none: with
// no key, no one can deploy new code to the account or sign as it. HQ still governs through the
// contract's own owner methods. --offline checks the recorded key deletion instead
// (data/contract-lock.json). --json prints one JSON line after the text.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { rpcUrls } from "../server/src/chain/rpc.ts";

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(join(root, "data/contract-lock.json"), "utf8")) as {
  account: string;
  network: string;
  deletedKey: string;
  deletedAt: string;
  transaction: string;
  explorer: string;
};
const json = process.argv.includes("--json");
const offline = process.argv.includes("--offline");

async function keys(url: string): Promise<string[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "locked",
      method: "query",
      params: { request_type: "view_access_key_list", finality: "final", account_id: lock.account },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as {
    result?: { keys: { public_key: string }[] };
    error?: unknown;
  };
  if (!body.result) throw new Error(`RPC error: ${JSON.stringify(body.error)}`);
  return body.result.keys.map((k) => k.public_key);
}

let ok: boolean;
let found: string[] | null = null;
if (offline) {
  ok =
    /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(lock.transaction) &&
    lock.deletedKey.startsWith("ed25519:");
  console.log(
    `${lock.account}: its only key was deleted on ${lock.deletedAt} in transaction ${lock.transaction} (${lock.explorer}). Recorded only; run without --offline to ask testnet.`,
  );
} else {
  let lastError: unknown = null;
  for (const url of rpcUrls(lock.network, undefined)) {
    try {
      found = await keys(url);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (found === null) {
    console.log(`testnet RPC unreachable: ${String(lastError)}`);
    process.exit(1);
  }
  ok = found.length === 0;
  console.log(
    ok
      ? `${lock.account} has no access keys on testnet, so its code cannot change. Deleted on ${lock.deletedAt}: ${lock.explorer}`
      : `${lock.account} still has ${found.length} access key(s): ${found.join(", ")}`,
  );
}
if (json) console.log(JSON.stringify({ account: lock.account, offline, ok, keys: found }));
process.exitCode = ok ? 0 : 1;
