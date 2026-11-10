// npm run verify -- <record.json> [--offline] [--json]: recomputes a record's fingerprint and
// compares it with the anchor stored on testnet, or with the purchasing replay's anchor event.
//
// A record file holds { kind, ref_id, salt, record } and, once anchored, anchored_tx.
// Exit code 0 on MATCH, 1 otherwise.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { explorerUrl } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { readFixture } from "../server/src/chain/replay.ts";
import { fingerprint, verifyAnchor } from "../server/src/records/anchors.ts";

interface RecordFile {
  kind: string;
  ref_id: string;
  salt: string;
  record: unknown;
  anchored_tx?: string;
}

interface RecordedAnchor {
  ref_id?: string;
  kind?: string;
  hash?: string;
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const offline = args.includes("--offline");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run verify -- <record.json> [--offline] [--json]");
  process.exit(2);
}

const accounts = JSON.parse(
  readFileSync(fileURLToPath(new URL("../config/testnet-accounts.json", import.meta.url)), "utf8"),
) as { network: string; spendPolicy: string };
const data = JSON.parse(readFileSync(file, "utf8")) as RecordFile;
const computed = fingerprint(data.record, data.salt);

if (offline) {
  const fixture = readFixture(
    fileURLToPath(new URL("../data/replay/demo-chain.json", import.meta.url)),
  );
  const anchor = fixture.entries
    .flatMap((entry) =>
      entry.type === "call" &&
      entry.request.receiverId === accounts.spendPolicy &&
      entry.outcome.status === "success"
        ? entry.outcome.events
            .filter(
              (event) =>
                event.standard === "dayone_spend_policy" && event.event === "record_anchored",
            )
            .map((event) => ({
              tx: entry.outcome.txHash,
              data: event.data as RecordedAnchor | undefined,
            }))
        : [],
    )
    .find(({ data: event }) => event?.ref_id === data.ref_id && event.kind === data.kind);
  const hash = anchor?.data?.hash ?? null;
  const result = hash === null ? "NOT_RECORDED" : hash === computed ? "MATCH" : "MISMATCH";
  console.log(`${result}  ${data.ref_id} (recorded anchor, no live chain check)`);
  if (json) {
    console.log(
      JSON.stringify({
        result,
        ref_id: data.ref_id,
        computed,
        recorded_anchor: hash,
        explorer_url: explorerUrl(fixture.network, anchor?.tx ?? null),
        offline: true,
      }),
    );
  }
  process.exit(result === "MATCH" ? 0 : 1);
}

const chain = new LiveTransport(accounts.network, () => {
  throw new Error("verify signs nothing");
});
const v = await verifyAnchor(
  (view) => chain.view(view),
  accounts.spendPolicy,
  data.ref_id,
  computed,
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
