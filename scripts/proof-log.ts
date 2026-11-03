// npm run proof [-- --check] [-- --live]: writes PROOF.md from the testnet recordings
// (scripts/lib/proofLog.ts). --check exits 1 when the committed PROOF.md differs from what the
// recordings give; --live also asks testnet RPC for every recorded transaction and checks it
// exists and ended as recorded (success, or the contract's refusal). Needs no keys.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allTransactions, buildProofLog, PROOF_FILE } from "./lib/proofLog.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const text = buildProofLog(root);
const path = join(root, PROOF_FILE);

if (argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  } catch {}
  if (current !== text) {
    console.log(`${PROOF_FILE} is stale: run npm run proof`);
    process.exit(1);
  }
  console.log(`${PROOF_FILE} is current.`);
} else {
  writeFileSync(path, text);
  console.log(`Wrote ${PROOF_FILE}.`);
}

if (argv.includes("--live")) {
  // Archival nodes: regular RPC nodes keep a transaction for only a few epochs (about 2–3 days).
  const RPCS = [
    "https://archival-rpc.testnet.fastnear.com",
    "https://archival-rpc.testnet.near.org",
  ];
  const txs = allTransactions(root).filter((t) => t.hash);
  let bad = 0;
  for (const t of txs) {
    let status: unknown = null;
    for (const url of RPCS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "proof",
            method: "tx",
            params: { tx_hash: t.hash, sender_account_id: t.sender, wait_until: "NONE" },
          }),
        });
        const body = (await res.json()) as { result?: { status?: unknown } };
        if (body.result?.status) {
          status = body.result.status;
          break;
        }
      } catch {}
    }
    const failed = status !== null && typeof status === "object" && "Failure" in (status as object);
    const ok = status !== null && failed === !t.ok;
    if (!ok) bad++;
    console.log(
      `${ok ? "OK  " : "BAD "} ${t.hash} ${status === null ? "not found" : failed ? "refused" : "success"} (recorded ${t.ok ? "success" : "refused"})`,
    );
  }
  console.log(`${txs.length - bad} of ${txs.length} transactions found on testnet as recorded.`);
  if (bad) process.exit(1);
}
