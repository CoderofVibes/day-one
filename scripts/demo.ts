// npm run demo — the whole purchasing loop (DEMO_SCRIPT §2), replayed from a recorded testnet
// run: no keys, no network. The transcript must equal data/replay/transcript.txt.
//   npm run demo:live               run it live on testnet and NEAR AI Cloud (needs .env keys,
//                                   the relayer's server key and unused PO ids)
//   npm run demo:live -- --record   the same, and rewrite the fixtures, the transcript and
//                                   data/batch-records/BR-B-1045.json for npm run verify
//   --json                          print one JSON line after the readable text
//   --accept                        replay only: rewrite transcript.txt when the words changed
//                                   but no chain call or model answer did (the replay still
//                                   consumes every recorded call)
//
// The run itself (the phases, the clients, the records) is shared with the HTTP API: api/src/env.ts.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatTranscript, runDemo } from "../agents/kevin/src/demo.ts";
import { DemoEnvError, fixtureFiles, openDemoEnv } from "../api/src/env.ts";
import { explorerUrl } from "../server/src/chain/client.ts";
import { explainFailure } from "../server/src/chain/explain.ts";
import { RecordingTransport, ReplayTransport } from "../server/src/chain/replay.ts";
import { approvals, chainTx } from "../server/src/ledger/schema.ts";
import { RecordingLlm } from "../server/src/llm/client.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const record = args.includes("--record");
const json = args.includes("--json");
const accept = args.includes("--accept") && !live;
const FIX = fixtureFiles(root);

const env = await openDemoEnv({ root, live, record }).catch((error: unknown) => {
  if (error instanceof DemoEnvError) fail(error.message);
  throw error;
});
const { db, transport, llm, salts } = env;

const run = await runDemo(env.deps);
const transcript = formatTranscript(db, run.steps);

console.log(`Day One demo (${live ? "live on testnet" : "replay of a recorded testnet run"})\n`);
process.stdout.write(transcript);

let matches = true;
if (record && run.ok && transport instanceof RecordingTransport && llm instanceof RecordingLlm) {
  transport.save(FIX.chain);
  llm.save(FIX.llm);
  writeFileSync(FIX.salts, `${JSON.stringify(salts, null, 2)}\n`);
  writeFileSync(FIX.transcript, transcript);
  mkdirSync(resolve(root, "data/batch-records"), { recursive: true });
  writeFileSync(FIX.proof, `${JSON.stringify(run.batchProof, null, 2)}\n`);
  // One verifiable file per anchored quote: data/quotes/RFQ-2611-01.northgate-ingredients.testnet.json
  mkdirSync(resolve(root, "data/quotes"), { recursive: true });
  for (const proof of run.quoteProofs) {
    const file = resolve(root, "data/quotes", `${proof.ref_id.replace("/", ".")}.json`);
    writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`);
  }
  console.log(
    `\nRecorded the run to data/replay/, ${FIX.proof.slice(root.length + 1)} and ` +
      `${run.quoteProofs.length} quote proofs in data/quotes/.`,
  );
} else if (transport instanceof ReplayTransport) {
  transport.assertDone();
  matches = transcript === readFileSync(FIX.transcript, "utf8");
  if (!matches && accept && run.ok) {
    writeFileSync(FIX.transcript, transcript);
    matches = true;
    console.log("\nRewrote data/replay/transcript.txt from this replay (--accept).");
  } else {
    console.log(
      matches
        ? "\nTranscript matches data/replay/transcript.txt."
        : "\nTranscript DIFFERS from data/replay/transcript.txt: the demo changed since the recording.",
    );
  }
}

if (json) {
  console.log(
    JSON.stringify({
      mode: live ? "live" : "replay",
      ok: run.ok && matches,
      steps: run.steps,
      summary: run.summary,
      transactions: db
        .select()
        .from(chainTx)
        .all()
        .map((r) => ({
          method: r.method,
          signer: r.signerId,
          status: r.status,
          tx: r.txHash,
          url: explorerUrl(r.network, r.txHash),
        })),
      approvals: db
        .select({ request: approvals.requestText, response: approvals.responseText })
        .from(approvals)
        .all(),
    }),
  );
}
process.exitCode = run.ok && matches ? 0 : 1;

function fail(message: string): never {
  console.error(message);
  const help = explainFailure(message);
  if (help) console.error(`${help.what} ${help.fix}`);
  if (live) console.error("npm run preflight checks everything a live run needs.");
  process.exit(1);
}
