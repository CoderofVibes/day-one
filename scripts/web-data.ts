// npm run web:data — writes web/src/data/demo-run.json, the recorded demo run the web UI
// steps through: the staff lines of each step (from npm run demo, replayed with no keys) and,
// for the behind-the-curtain view, each transaction with its signer, who paid for it, its
// refusal message and its events (from data/replay/demo-chain.json); and the text Linda's phone
// receives and her reply.
//   --check   exit 1 if the committed file differs from a fresh export

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readAttestationFixture, recordedReceipts } from "../server/src/attestation/fixture.ts";
import { verifyAttestation } from "../server/src/attestation/verify.ts";

const root = resolve(import.meta.dirname, "..");
const OUT = join(root, "web/src/data/demo-run.json");
const RELAYER = "dayone-relayer.testnet";
const TX = /\(tx ([1-9A-HJ-NP-Za-km-z]{43,44})\)/;

interface DemoJson {
  ok: boolean;
  steps: { step: number; title: string; staff: string[]; chain: string[] }[];
  summary: { transactions: number; refusedByDesign: number; refusedOther: number; failed: number };
  transactions: { method: string; signer: string; status: string; tx: string; url: string }[];
  approvals: { request: string; response: string | null }[];
}
interface ChainEntry {
  type: string;
  request: { method: string; signerId: string; receiverId: string; viaRelayer: boolean };
  outcome: {
    status: string;
    errorMessage: string | null;
    txHash: string;
    events: { event: string }[];
  };
}

const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/demo.ts", "--json"], {
  cwd: root,
  encoding: "utf8",
});
const last = run.stdout.trim().split("\n").at(-1) ?? "";
if (run.status !== 0 || !last.startsWith("{")) {
  console.error(run.stdout, run.stderr);
  console.error("npm run demo did not finish; the web data was not written.");
  process.exit(1);
}
const demo = JSON.parse(last) as DemoJson;
const fixture = JSON.parse(readFileSync(join(root, "data/replay/demo-chain.json"), "utf8")) as {
  network: string;
  recordedAt: string;
  entries: ChainEntry[];
};
const calls = new Map(
  fixture.entries.filter((e) => e.type === "call").map((e) => [e.outcome.txHash, e]),
);

// The enclave and signature checks that need no network, over the demo's own model answers;
// the Intel and NVIDIA verdicts are the ones npm run attest recorded (dated in their detail).
const attestationFixture = readAttestationFixture(root);
const attestation = attestationFixture
  ? await verifyAttestation(
      attestationFixture,
      recordedReceipts(root, ["data/replay/demo-llm.json"]),
    )
  : null;

const data = {
  network: fixture.network,
  recordedAt: fixture.recordedAt,
  summary: demo.summary,
  approvals: demo.approvals,
  attestation,
  steps: demo.steps.map((s) => ({
    step: s.step,
    title: s.title,
    staff: s.staff,
    chain: s.chain.map((line) => ({ line, tx: TX.exec(line)?.[1] ?? null })),
  })),
  transactions: demo.transactions.map((t) => {
    const call = calls.get(t.tx);
    if (!call) throw new Error(`tx ${t.tx} is not in data/replay/demo-chain.json`);
    return {
      tx: t.tx,
      url: t.url,
      method: t.method,
      contract: call.request.receiverId,
      signer: t.signer,
      paidBy: call.request.viaRelayer ? RELAYER : t.signer,
      status: t.status,
      error: call.outcome.errorMessage,
      events: call.outcome.events.map((e) => e.event),
    };
  }),
};
const text = `${JSON.stringify(data, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = readFileSync(OUT, "utf8");
  if (committed !== text) {
    console.error("web/src/data/demo-run.json is out of date: run npm run web:data.");
    process.exit(1);
  }
  console.log("web/src/data/demo-run.json matches the recorded run.");
} else {
  writeFileSync(OUT, text);
  console.log(
    `Wrote web/src/data/demo-run.json: ${data.steps.length} steps, ${data.transactions.length} transactions, ` +
      (attestation
        ? `${attestation.answers.length} attested answers (${attestation.ok ? "verified" : "UNVERIFIED"}).`
        : "no attestation (npm run attest records one)."),
  );
}
