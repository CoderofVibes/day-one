// npm run verify -- <record.json> [--json]: recomputes a record's fingerprint and compares it
// with the anchor stored on testnet. Needs no keys and no .env: one public view call.
//
// A record file holds { kind, ref_id, salt, record } and, once anchored, anchored_tx.
// Exit code 0 on MATCH, 1 otherwise.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { explorerUrl } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { fingerprint, verifyAnchor } from "../server/src/records/anchors.ts";

interface RecordFile {
  kind: string;
  ref_id: string;
  salt: string;
  record: unknown;
  anchored_tx?: string;
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run verify -- <record.json> [--json]");
  process.exit(2);
}

const accounts = JSON.parse(
  readFileSync(fileURLToPath(new URL("../config/testnet-accounts.json", import.meta.url)), "utf8"),
) as { network: string; spendPolicy: string };
const data = JSON.parse(readFileSync(file, "utf8")) as RecordFile;
const chain = new LiveTransport(accounts.network, () => {
  throw new Error("verify signs nothing");
});
const v = await verifyAnchor(
  (view) => chain.view(view),
  accounts.spendPolicy,
  data.ref_id,
  fingerprint(data.record, data.salt),
);
const link = explorerUrl(accounts.network, data.anchored_tx ?? null);

console.log(`${v.result}  ${v.refId}`);
console.log(`  computed  ${v.computed}`);
console.log(`  on chain  ${v.onChain?.hash ?? "(none)"}${v.onChain ? ` by ${v.onChain.by}` : ""}`);
if (link) console.log(`  anchored  ${link}`);
if (json) {
  console.log(
    JSON.stringify({
      result: v.result,
      ref_id: v.refId,
      computed: v.computed,
      on_chain: v.onChain?.hash ?? null,
      anchored_by: v.onChain?.by ?? null,
      contract: accounts.spendPolicy,
      network: accounts.network,
      explorer_url: link,
    }),
  );
}
process.exit(v.result === "MATCH" ? 0 : 1);
