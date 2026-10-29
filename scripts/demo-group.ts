// npm run demo:group — group purchasing across Acme's plants (docs/GROUP_BUY.md), replayed
// from a recorded run: no keys, no network. The transcript must equal
// data/replay/group-transcript.txt.
//   npm run demo:group -- --sandbox            run it on a local NEAR sandbox in WSL
//                                              (scripts/lib/sandbox.ts; needs one `cargo test`
//                                              in contracts/ first)
//   npm run demo:group -- --sandbox --record   the same, and rewrite the fixtures and transcript
//   npm run demo:group -- --live [--record]    testnet, once spend-policy is redeployed with the
//                                              pool methods and Plants A and C have their agents
//                                              and directors (GROUP_BUY.md §5); needs the keys
//   --json      print one JSON line after the readable text
//   --web       write web/src/data/group-buy.json for the three-plant view
//   --accept    replay only: rewrite the transcript when the words changed but no chain call did

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  formatGroupTranscript,
  GROUP_CLOCK,
  GROUP_PO,
  type GroupDeps,
  type GroupSalts,
  runGroupDemo,
  seedGroupBuy,
} from "../agents/kevin/src/groupBuy.ts";
import { demoBus } from "../agents/suppliers/src/bus.ts";
import { acceptAndShip } from "../agents/suppliers/src/shipping.ts";
import { ChainClient, explorerUrl } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { RecordingTransport, ReplayTransport } from "../server/src/chain/replay.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { approvals, chainTx } from "../server/src/ledger/schema.ts";
import { seedLedger } from "../server/src/seed/index.ts";
import { SUPPLIERS } from "../server/src/seed/quotes.ts";
import { allPlantsStaff, kevinOf, RELAYER, startDayOneSandbox } from "./lib/dayone-sandbox.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const sandbox = args.includes("--sandbox");
const live = args.includes("--live");
const record = args.includes("--record");
const json = args.includes("--json");
const web = args.includes("--web");
const accept = args.includes("--accept") && !live && !sandbox;
const FIX = {
  chain: join(root, "data/replay/group-chain.json"),
  salts: join(root, "data/replay/group-salts.json"),
  transcript: join(root, "data/replay/group-transcript.txt"),
  web: join(root, "web/src/data/group-buy.json"),
};
const log = (line: string) => {
  if (!json) console.error(`[sandbox] ${line}`);
};

if (record && !live && !sandbox) fail("--record needs --sandbox or --live.");
if (live && sandbox) fail("pick --sandbox or --live, not both.");

const db = openLedger();
seedLedger(db);
let clock: string = GROUP_CLOCK.start;

let transport: LiveTransport | RecordingTransport | ReplayTransport;
let accounts: { network: string; root: string; spendPolicy: string };
let salts: GroupSalts;
let stop = () => {};
const freshSalts = (): GroupSalts => ({
  po: randomBytes(16).toString("hex"),
  quotes: Object.fromEntries(SUPPLIERS.map((s) => [s.account, randomBytes(16).toString("hex")])),
});

if (sandbox) {
  const started = await startDayOneSandbox({ log });
  stop = started.stop;
  accounts = started.accounts;
  transport = record ? new RecordingTransport(started.transport) : started.transport;
  salts = freshSalts();
} else if (live) {
  accounts = JSON.parse(readFileSync(join(root, "config/testnet-accounts.json"), "utf8"));
  if (!existsSync(join(root, `.near-credentials/testnet/${RELAYER}.json`))) {
    fail(`The relayer's server key is missing (.near-credentials/testnet/${RELAYER}.json).`);
  }
  const liveChain = new LiveTransport(accounts.network, undefined, undefined, {
    relayerId: RELAYER,
    policyContract: accounts.spendPolicy,
    staffMethods: allPlantsStaff(accounts.root),
  });
  const existing = await liveChain.view({
    contractId: accounts.spendPolicy,
    method: "get_po",
    args: { po_id: GROUP_PO },
  });
  if (existing)
    fail(`${GROUP_PO} is already on chain; the group demo needs a contract without it.`);
  transport = record ? new RecordingTransport(liveChain) : liveChain;
  salts = freshSalts();
} else {
  const missing = [FIX.chain, FIX.salts, FIX.transcript].filter((f) => !existsSync(f));
  if (missing.length) {
    fail(
      "No recorded group buy yet. Record one with npm run demo:group -- --sandbox --record " +
        `(missing ${missing.map((f) => f.slice(root.length + 1)).join(", ")}).`,
    );
  }
  const replay = ReplayTransport.fromFile(FIX.chain);
  transport = replay;
  const testnet = JSON.parse(readFileSync(join(root, "config/testnet-accounts.json"), "utf8")) as {
    root: string;
    spendPolicy: string;
  };
  accounts = { network: replay.network, root: testnet.root, spendPolicy: testnet.spendPolicy };
  salts = JSON.parse(readFileSync(FIX.salts, "utf8")) as GroupSalts;
}

seedGroupBuy(db, accounts.root);
const chain = new ChainClient(db, transport, () => clock);
const bus = demoBus(chain, {
  policyContract: accounts.spendPolicy,
  salt: (account) => {
    const salt = salts.quotes[account];
    if (!salt) throw new Error(`no quote salt for ${account}`);
    return salt;
  },
});
const deps: GroupDeps = {
  db,
  chain,
  setClock: (iso) => {
    clock = iso;
  },
  policyContract: accounts.spendPolicy,
  relayer: RELAYER,
  tokenSymbol: "DTUSD",
  agents: {
    A: kevinOf("a", accounts.root),
    B: kevinOf("b", accounts.root),
    C: kevinOf("c", accounts.root),
  },
  hub: "B",
  quotes: (rfq) => bus.requestQuotes(rfq),
  ship: (shipment) => acceptAndShip(chain, shipment, { policyContract: accounts.spendPolicy }),
  salts,
};

let matches = true;
try {
  const result = await runGroupDemo(deps);
  const transcript = formatGroupTranscript(db, result.steps, transport.network);
  const where = sandbox
    ? "live on a local sandbox"
    : live
      ? "live on testnet"
      : `replay of a recorded ${transport.network} run`;
  console.log(`Day One group purchasing (${where})\n`);
  process.stdout.write(transcript);

  if (record && result.ok && transport instanceof RecordingTransport) {
    transport.save(FIX.chain);
    writeFileSync(FIX.salts, `${JSON.stringify(salts, null, 2)}\n`);
    writeFileSync(FIX.transcript, transcript);
    let proofs = 0;
    // Quote proofs verify against a public network only; a sandbox is gone when the run ends.
    if (transport.network === "testnet") {
      mkdirSync(join(root, "data/quotes"), { recursive: true });
      for (const proof of result.quoteProofs) {
        const file = join(root, "data/quotes", `${proof.ref_id.replace("/", ".")}.json`);
        writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`);
        proofs += 1;
      }
    }
    console.log(
      `\nRecorded the run to data/replay/group-*.json and group-transcript.txt` +
        (proofs ? ` and ${proofs} quote proofs in data/quotes/.` : "."),
    );
  } else if (transport instanceof ReplayTransport) {
    transport.assertDone();
    matches = transcript === readFileSync(FIX.transcript, "utf8");
    if (!matches && accept && result.ok) {
      writeFileSync(FIX.transcript, transcript);
      matches = true;
      console.log("\nRewrote data/replay/group-transcript.txt from this replay (--accept).");
    } else {
      console.log(
        matches
          ? "\nTranscript matches data/replay/group-transcript.txt."
          : "\nTranscript DIFFERS from data/replay/group-transcript.txt: the group buy changed since the recording.",
      );
    }
  }

  const TX = /\(tx ([1-9A-HJ-NP-Za-km-z]{43,44})\)/;
  const network = transport.network;
  const link = (tx: string | null) => (network === "sandbox" ? null : explorerUrl(network, tx));
  const transactions = db
    .select()
    .from(chainTx)
    .all()
    .map((r) => ({
      method: r.method,
      contract: r.receiverId,
      signer: r.signerId,
      paidBy: r.viaRelayer ? RELAYER : r.signerId,
      status: r.status,
      error: r.errorMessage,
      tx: r.txHash,
      url: link(r.txHash),
      events: (JSON.parse(r.eventsJson ?? "[]") as { event: string }[]).map((e) => e.event),
    }));
  const requests = db
    .select({ request: approvals.requestText, response: approvals.responseText })
    .from(approvals)
    .all();
  if (web && result.ok && (record || transport instanceof ReplayTransport)) {
    const data = {
      network,
      recordedAt: transport instanceof ReplayTransport ? readRecordedAt(FIX.chain) : clock,
      pool: result.pool,
      po: result.po,
      spent: result.spent,
      summary: result.summary,
      approvals: requests,
      steps: result.steps.map((s) => ({
        step: s.step,
        title: s.title,
        staff: s.staff,
        chain: s.chain.map((line) => ({ line, tx: TX.exec(line)?.[1] ?? null })),
      })),
      transactions,
    };
    writeFileSync(FIX.web, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Wrote ${FIX.web.slice(root.length + 1)}.`);
  }
  if (json) {
    console.log(
      JSON.stringify({
        mode: sandbox ? "sandbox" : live ? "live" : "replay",
        network,
        ok: result.ok && matches,
        pool: result.pool,
        po: result.po,
        spent: result.spent,
        steps: result.steps,
        summary: result.summary,
        transactions,
        approvals: requests,
      }),
    );
  }
  process.exitCode = result.ok && matches ? 0 : 1;
} finally {
  stop();
}

function readRecordedAt(file: string) {
  return (JSON.parse(readFileSync(file, "utf8")) as { recordedAt: string }).recordedAt;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
