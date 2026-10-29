// npm run sealed — a sealed-bid quote round (CONTRACTS.md §10), replayed from data/sealed/: no
// keys, no network. Staff lines first (dollars, names, times), then behind the curtain
// (fingerprints, block times, transactions). The transcript must equal data/sealed/transcript.txt.
//   --live [--record]              run it on testnet (keys in .near-credentials; RFQ-2611-02 must
//                                  have no round on the contract yet) and wait out a real
//                                  three-minute deadline; --record rewrites data/sealed/
//   --record-sandbox <host.json>   run it on a local sandbox node and rewrite data/sealed/
//                                  (start the node with the contract's host_for_recording test)
//   --json                         print one JSON line after the readable text

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openSealedEnv, saveSealedRecording, sealedFiles } from "../agents/kevin/src/sealedEnv.ts";
import { runSealedRound, SEALED_RFQ, sealedAttacks } from "../agents/kevin/src/sealedRound.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { ReplayTransport, readFixture } from "../server/src/chain/replay.ts";
import { checkSealedRound } from "../server/src/sealed.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const live = args.includes("--live");
const record = live && args.includes("--record");
const hostAt = args.indexOf("--record-sandbox");
const hostFile = hostAt >= 0 ? args[hostAt + 1] : undefined;
if ((hostAt >= 0 && !hostFile) || (live && hostFile)) {
  console.error("usage: npm run sealed -- [--live [--record] | --record-sandbox <host.json>]");
  process.exit(2);
}
const files = sealedFiles(root);

if (live) {
  const accounts = JSON.parse(readFileSync(resolve(root, "config/testnet-accounts.json"), "utf8"));
  const existing = await new LiveTransport("testnet").view({
    contractId: accounts.spendPolicy,
    method: "get_sealed_round",
    args: { round_id: SEALED_RFQ },
  });
  if (existing) {
    console.error(
      `${SEALED_RFQ} already has a round on ${accounts.spendPolicy}; a round id is used once.`,
    );
    process.exit(1);
  }
}
const env = openSealedEnv({ root, hostFile, live });
const mode = live
  ? "live on testnet"
  : hostFile
    ? "live on a local sandbox node"
    : `replay of a recorded ${readFixture(files.chain).network} run`;
const run = await runSealedRound(env.deps);
const check = checkSealedRound(run.round);
const attacks = sealedAttacks(run);

const transcript = [
  ...run.staff,
  "",
  "Behind the curtain:",
  ...run.curtain.map((l) => `  ${l}`),
  "",
  `Round check: ${check.result}${check.problems.length ? ` (${check.problems.join("; ")})` : ""}`,
  ...attacks.map((a) => `Attack "${a.attack}": ${a.held ? "refused" : "NOT REFUSED"}`),
  "",
].join("\n");

console.log(`Sealed quote round (${mode})\n`);
process.stdout.write(transcript);

let matches = true;
if (hostFile || record) {
  saveSealedRecording(root, env, transcript, run.proof);
  console.log(`\nRecorded the round to data/sealed/.`);
} else if (env.transport instanceof ReplayTransport) {
  env.transport.assertDone();
  matches = transcript === readFileSync(files.transcript, "utf8");
  const proofMatches =
    JSON.stringify(run.proof, null, 2) === readFileSync(files.proof, "utf8").trimEnd();
  matches &&= proofMatches;
  console.log(
    matches
      ? "\nTranscript matches data/sealed/transcript.txt."
      : "\nTranscript or proof DIFFERS from data/sealed/: the round changed since the recording.",
  );
}

const ok = check.result === "VALID" && attacks.every((a) => a.held) && matches;
if (json) {
  console.log(
    JSON.stringify({
      mode: live ? "live" : hostFile ? "sandbox" : "replay",
      ok,
      round: run.round.round_id,
      check,
      attacks,
      staff: run.staff,
      proof: files.proof.slice(root.length + 1).replaceAll("\\", "/"),
    }),
  );
}
process.exitCode = ok ? 0 : 1;
