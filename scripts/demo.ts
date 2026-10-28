// npm run demo — the whole purchasing loop (DEMO_SCRIPT §2), replayed from a recorded testnet
// run: no keys, no network. The transcript must equal data/replay/transcript.txt.
//   npm run demo:live               run it live on testnet and NEAR AI Cloud (needs .env keys,
//                                   the relayer's server key and unused PO ids)
//   npm run demo:live -- --record   the same, and rewrite the fixtures, the transcript and
//                                   data/batch-records/BR-B-1045.json for npm run verify
//   --json                          print one JSON line after the readable text
//
// The packing slip is read from its ground-truth file; reading the slip photo with the vision
// route is not built yet.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEMO_CLOCK, type DemoSalts, runDemo } from "../agents/kevin/src/demo.ts";
import type { PackingSlip } from "../agents/kevin/src/receiving.ts";
import { acceptAndShip } from "../agents/suppliers/src/shipping.ts";
import { ChainClient, explorerUrl } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { RecordingTransport, ReplayTransport } from "../server/src/chain/replay.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { approvals, chainTx } from "../server/src/ledger/schema.ts";
import { createLlm, RecordingLlm, ReplayLlm } from "../server/src/llm/client.ts";
import { plantBStaff } from "../server/src/relayer/relayer.ts";
import { seedLedger } from "../server/src/seed/index.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const live = args.includes("--live");
const record = args.includes("--record");
const json = args.includes("--json");

const at = (p: string) => join(root, p);
const FIX = {
  chain: at("data/replay/demo-chain.json"),
  llm: at("data/replay/demo-llm.json"),
  salts: at("data/replay/demo-salts.json"),
  transcript: at("data/replay/transcript.txt"),
  proof: at("data/batch-records/BR-B-1045.json"),
};
const ACCOUNTS = JSON.parse(readFileSync(at("config/testnet-accounts.json"), "utf8")) as {
  network: string;
  root: string;
  spendPolicy: string;
};
const KEVIN = `kevin.plant-b.${ACCOUNTS.root}`;
const RELAYER = "dayone-relayer.testnet";
const DEMO_POS = ["PO-1041", "PO-1042"];

if (record && !live) fail("--record needs a live run: npm run demo:live -- --record");
if (!live) {
  const missing = [FIX.chain, FIX.llm, FIX.salts, FIX.transcript].filter((f) => !existsSync(f));
  if (missing.length) {
    fail(
      "No recorded run yet. Record one with npm run demo:live -- --record " +
        `(missing ${missing.map((f) => f.slice(root.length + 1)).join(", ")}).`,
    );
  }
}

const db = openLedger();
seedLedger(db);
let clock: string = DEMO_CLOCK.start;

let transport: LiveTransport | RecordingTransport | ReplayTransport;
let llm: ReturnType<typeof createLlm>;
let salts: DemoSalts;
if (live) {
  if (existsSync(at(".env"))) process.loadEnvFile(at(".env"));
  if (!existsSync(at(`.near-credentials/testnet/${RELAYER}.json`))) {
    fail(
      `The relayer's server key is missing (.near-credentials/testnet/${RELAYER}.json). ` +
        "Tony runs npm run setup:testnet once in his session (PLAN human task 12, OPEN_QUESTIONS #31).",
    );
  }
  const liveChain = new LiveTransport(ACCOUNTS.network, undefined, undefined, {
    relayerId: RELAYER,
    policyContract: ACCOUNTS.spendPolicy,
    staffMethods: plantBStaff(ACCOUNTS.root),
  });
  // A PO id can be submitted once per contract; a second run needs fresh state.
  for (const po of DEMO_POS) {
    const existing = await liveChain.view({
      contractId: ACCOUNTS.spendPolicy,
      method: "get_po",
      args: { po_id: po },
    });
    if (existing) fail(`${po} is already on chain; the demo needs a contract without it.`);
  }
  transport = record ? new RecordingTransport(liveChain) : liveChain;
  const routed = createLlm(FIX.llm, {
    ...process.env,
    DAYONE_MODE: "live",
    LLM_RECORD_FIXTURES: "false",
  });
  llm = record ? new RecordingLlm(routed) : routed;
  const salt = () => randomBytes(16).toString("hex");
  salts = { po1041: salt(), po1042: salt(), batch: salt(), receipt: salt() };
} else {
  transport = ReplayTransport.fromFile(FIX.chain);
  llm = ReplayLlm.fromFile(FIX.llm);
  salts = JSON.parse(readFileSync(FIX.salts, "utf8")) as DemoSalts;
}

const chain = new ChainClient(db, transport, () => clock);
const image = readFileSync(at("data/batch-records/BR-B-1045.jpg"));
const slipFile = "data/packing-slips/NG-PS-60417.jpg";
const truth = JSON.parse(readFileSync(at("data/packing-slips/NG-PS-60417.truth.json"), "utf8")) as {
  slipNo: string;
  poNo: string;
  shipFrom: string[];
  description: string;
  shipped: string;
  backOrdered: string;
  supplierLot: string;
};
const kg = (text: string) => Math.round((Number.parseFloat(text.replace(/,/g, "")) || 0) * 1e6);
const slip: PackingSlip = {
  slipNo: truth.slipNo,
  poNo: truth.poNo,
  vendorName: truth.shipFrom[0] ?? "",
  lines: [
    {
      description: truth.description,
      shippedBase: kg(truth.shipped),
      backorderedBase: kg(truth.backOrdered),
      supplierLot: truth.supplierLot,
    },
  ],
  file: slipFile,
  sha256: sha256(readFileSync(at(slipFile))),
};

const run = await runDemo({
  db,
  chain,
  llm,
  setClock: (iso) => {
    clock = iso;
  },
  kevin: KEVIN,
  policyContract: ACCOUNTS.spendPolicy,
  relayer: RELAYER,
  tokenSymbol: "DTUSD",
  batchRecord: {
    file: "data/batch-records/BR-B-1045.jpg",
    sha256: sha256(image),
    image: { mediaType: "image/jpeg", base64: image.toString("base64") },
  },
  batchRecordCount: readdirSync(at("data/batch-records")).filter((f) => f.endsWith(".jpg")).length,
  slip,
  invoiceText: (
    JSON.parse(readFileSync(at("data/attacks/invoices.json"), "utf8")) as {
      invoices: { genuine: string };
    }
  ).invoices.genuine,
  ship: (shipment) => acceptAndShip(chain, shipment, { policyContract: ACCOUNTS.spendPolicy }),
  salts,
});

const lines: string[] = [];
for (const step of run.steps) {
  for (const text of step.staff) lines.push(text);
  for (const text of step.chain) lines.push(`  ${text}`);
}
const txs = db
  .select()
  .from(chainTx)
  .all()
  .filter((r) => r.txHash)
  .map((r) => `  ${r.method} ${explorerUrl(r.network, r.txHash)}`);
const transcript = `${[...lines, "", "Explorer links:", ...txs].join("\n")}\n`;

console.log(`Day One demo (${live ? "live on testnet" : "replay of a recorded testnet run"})\n`);
process.stdout.write(transcript);

let matches = true;
if (record && run.ok && transport instanceof RecordingTransport && llm instanceof RecordingLlm) {
  transport.save(FIX.chain);
  llm.save(FIX.llm);
  writeFileSync(FIX.salts, `${JSON.stringify(salts, null, 2)}\n`);
  writeFileSync(FIX.transcript, transcript);
  mkdirSync(at("data/batch-records"), { recursive: true });
  writeFileSync(FIX.proof, `${JSON.stringify(run.batchProof, null, 2)}\n`);
  console.log(`\nRecorded the run to data/replay/ and ${FIX.proof.slice(root.length + 1)}.`);
} else if (transport instanceof ReplayTransport) {
  transport.assertDone();
  matches = transcript === readFileSync(FIX.transcript, "utf8");
  console.log(
    matches
      ? "\nTranscript matches data/replay/transcript.txt."
      : "\nTranscript DIFFERS from data/replay/transcript.txt: the demo changed since the recording.",
  );
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

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
