// npm run test:attacks — ten attacks on Kevin, each shown failing: seven from
// agents/kevin/src/attacks.ts and the three sealed-bid attacks of agents/kevin/src/sealedRound.ts.
// Replays the recorded testnet calls and model answers by default: no keys, no network. The
// sealed-bid attacks replay a local sandbox run (data/sealed/) until spend-policy is redeployed
// to testnet with sealed rounds; --record leaves that recording alone (npm run sealed records it).
//   --record  run live on testnet and NEAR AI Cloud and rewrite the fixtures (needs .env keys)
//   --json    print one JSON line after the readable text

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JsonRpcProvider } from "near-api-js";
import {
  type AttackResult,
  runAttackSuite,
  type SigningKeyView,
} from "../agents/kevin/src/attacks.ts";
import { forecastMaterial } from "../agents/kevin/src/forecast.ts";
import { openSealedEnv } from "../agents/kevin/src/sealedEnv.ts";
import { runSealedRound, sealedAttacks } from "../agents/kevin/src/sealedRound.ts";
import { confirmBr1045 } from "../agents/kevin/src/test/br-b-1045.ts";
import { ChainClient, explorerUrl } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { type Fixture, RecordingTransport, ReplayTransport } from "../server/src/chain/replay.ts";
import { rebuildErp } from "../server/src/erp-connector/rebuild.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { createLlm, RecordingLlm, ReplayLlm } from "../server/src/llm/client.ts";
import { seedLedger } from "../server/src/seed/index.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const record = args.includes("--record");
const json = args.includes("--json");

const CHAIN_FIXTURE = join(root, "data/replay/attacks-chain.json");
const LLM_FIXTURE = join(root, "data/replay/attacks-llm.json");
const KEY_FIXTURE = join(root, "data/attacks/kevin-signing-key.json");
const ACCOUNTS = JSON.parse(readFileSync(join(root, "config/testnet-accounts.json"), "utf8")) as {
  root: string;
  spendPolicy: string;
};
const KEVIN = `kevin.plant-b.${ACCOUNTS.root}`;
const TOKEN = `dtusd.${ACCOUNTS.root}`;
const NOW = "2026-11-09T13:00:00.000Z";

const db = openLedger();
seedLedger(db);
confirmBr1045(db);
const forecast = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
const invoices = JSON.parse(readFileSync(join(root, "data/attacks/invoices.json"), "utf8"))
  .invoices as { genuine: string; inflated: string; hidden: string };

let transport: RecordingTransport | ReplayTransport;
let llm: RecordingLlm | ReplayLlm;
let signingKey: SigningKeyView;
if (record) {
  if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
  transport = new RecordingTransport(new LiveTransport("testnet"));
  llm = new RecordingLlm(
    createLlm(LLM_FIXTURE, { ...process.env, DAYONE_MODE: "live", LLM_RECORD_FIXTURES: "false" }),
  );
  const fc = JSON.parse(
    readFileSync(join(root, ".near-credentials/testnet", `${KEVIN}.fc.json`), "utf8"),
  ) as { public_key: string };
  const provider = new JsonRpcProvider({
    url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
  });
  const key = await provider.viewAccessKey({ accountId: KEVIN, publicKey: fc.public_key });
  signingKey = {
    account: KEVIN,
    publicKey: fc.public_key,
    permission: key.permission as SigningKeyView["permission"],
  };
} else {
  transport = ReplayTransport.fromFile(CHAIN_FIXTURE);
  llm = ReplayLlm.fromFile(LLM_FIXTURE);
  signingKey = JSON.parse(readFileSync(KEY_FIXTURE, "utf8")) as SigningKeyView;
}

// The acquirer's ERP, rebuilt in memory with the cutover history (attacks 5–7), and PO-1042's
// transactions from the recorded demo run, so the ERP's copy of it is the paid one.
const { connector: erp } = await rebuildErp(":memory:");
const demoChain = JSON.parse(
  readFileSync(join(root, "data/replay/demo-chain.json"), "utf8"),
) as Fixture;
const demoTx = (method: string, poId: string, status: string) =>
  demoChain.entries.find(
    (e) =>
      e.type === "call" &&
      e.request.method === method &&
      e.request.args.po_id === poId &&
      e.outcome.status === status,
  );
const funding = demoTx("submit_po", "PO-1042", "success");
const approval = demoTx("approve_po", "PO-1042", "success");
const release = demoTx("qc_release", "PO-1042", "success");
if (funding?.type !== "call" || approval?.type !== "call" || release?.type !== "call") {
  console.error("data/replay/demo-chain.json has no recorded PO-1042 run; record the demo first.");
  process.exit(1);
}
const releaseHash = release.outcome.txHash ?? "";
const results: AttackResult[] = await runAttackSuite({
  db,
  chain: new ChainClient(db, transport, () => NOW),
  llm,
  kevin: KEVIN,
  policyContract: ACCOUNTS.spendPolicy,
  token: TOKEN,
  forecast,
  invoices,
  signingKey,
  now: NOW,
  erp,
  po1042: {
    fundingTx: funding.outcome.txHash ?? "",
    approvalTx: approval.outcome.txHash ?? "",
    approvedBy: approval.request.signerId,
    releaseTx: releaseHash,
    explorerUrl: explorerUrl("testnet", releaseHash) ?? "",
  },
});

if (record && transport instanceof RecordingTransport && llm instanceof RecordingLlm) {
  transport.save(CHAIN_FIXTURE);
  llm.save(LLM_FIXTURE);
  mkdirSync(join(root, "data/attacks"), { recursive: true });
  writeFileSync(KEY_FIXTURE, `${JSON.stringify(signingKey, null, 2)}\n`);
} else if (transport instanceof ReplayTransport) {
  transport.assertDone();
}

// 8–10. The sealed-bid attacks, from the recorded sealed round.
const sealed = openSealedEnv({ root });
results.push(...sealedAttacks(await runSealedRound(sealed.deps)));
if (sealed.transport instanceof ReplayTransport) sealed.transport.assertDone();

const held = results.filter((r) => r.held).length;
console.log(`Attack suite (${record ? "live on testnet" : "replay of recorded testnet run"})\n`);
for (const r of results) {
  console.log(`${r.held ? "PASS" : "FAIL"}  ${r.attack}`);
  for (const line of r.evidence) console.log(`      ${line}`);
  for (const tx of r.txHashes) {
    const network = r.network ?? "testnet";
    console.log(
      `      tx ${explorerUrl(network, tx) ?? `${tx} (recorded on a local ${network} node)`}`,
    );
  }
  console.log("");
}
console.log(`${held} of ${results.length} attacks failed against Kevin.`);
if (json) {
  console.log(
    JSON.stringify({
      mode: record ? "live" : "replay",
      passed: held === results.length,
      attacks: results.map((r) => ({
        ...r,
        txUrls: r.txHashes.map((t) => explorerUrl(r.network ?? "testnet", t)),
      })),
    }),
  );
}
process.exitCode = held === results.length ? 0 : 1;
