// npm run erp:reconcile — do the three sets of books agree? Day One's lot ledger, the
// acquirer's ERP (rebuilt through the connector, then the replayed demo run) and the
// spend-policy contract on testnet. Every record is matched by its ID: PO number, lot code,
// transaction hash. MATCH or MISMATCH per check, with the numbers; exit 1 on any mismatch.
// Replays the recorded contract views by default: no keys, no network.
//   --live    read the contract now (view calls only; still no keys)
//   --record  --live, and rewrite data/replay/reconcile-chain.json
//   --json    print one JSON line after the readable text

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LiveTransport } from "../server/src/chain/live.ts";
import { type Fixture, RecordingTransport, ReplayTransport } from "../server/src/chain/replay.ts";
import { reconcile } from "../server/src/erp-connector/reconcile.ts";
import { replayDemoWithErp } from "./lib/erp-demo-run.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const record = args.includes("--record");
const live = record || args.includes("--live");
const json = args.includes("--json");
const FIXTURE = join(root, "data/replay/reconcile-chain.json");

const { dayOne, erpDb, connector, accounts } = await replayDemoWithErp(root, ":memory:");

let transport: RecordingTransport | ReplayTransport;
let source: string;
if (live) {
  transport = new RecordingTransport(
    new LiveTransport(accounts.network, () => {
      throw new Error("reconcile signs nothing");
    }),
  );
  source = `read from ${accounts.network} just now`;
} else {
  transport = ReplayTransport.fromFile(FIXTURE);
  const recordedAt = (JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture).recordedAt;
  source = `replay of views recorded ${recordedAt.slice(0, 10)}`;
}

const result = await reconcile({
  dayOne,
  erpDb,
  erp: connector,
  view: (method, args = {}) => transport.view({ contractId: accounts.spendPolicy, method, args }),
});
if (record && transport instanceof RecordingTransport) transport.save(FIXTURE);

console.log(
  `Reconciliation: Day One's ledger, Acme's ERP (${connector.system}) and ${accounts.spendPolicy} (${source})\n`,
);
for (const check of result.checks) {
  const [first, ...rest] = check.lines;
  console.log(`${check.ok ? "MATCH    " : "MISMATCH "} ${check.name}: ${first ?? ""}`);
  for (const line of rest) console.log(`          ${line}`);
}
const matched = result.checks.filter((c) => c.ok).length;
console.log(`\n${matched} of ${result.checks.length} checks match.`);
if (record) console.log(`Views saved to ${FIXTURE.slice(root.length + 1)}.`);
if (json) {
  console.log(
    JSON.stringify({
      ok: result.ok,
      mode: live ? "live" : "replay",
      contract: accounts.spendPolicy,
      checks: result.checks,
    }),
  );
}
process.exitCode = result.ok ? 0 : 1;
