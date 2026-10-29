// npm run record:credentials — attacks 8–11 of `npm run test:attacks` live on testnet. Sets the
// scene the sandbox test sets (contracts/spend-policy/tests/credentials_sandbox.rs), then sends
// exactly the calls the suite replays and writes data/attacks/credentials-testnet.json, which
// `npm run test:attacks` replays from then on:
//   HQ (Acme's keychain key) issues Fennimore a credential and revokes it, issues Sierra one
//   that runs out a minute later, and issues Pacific Excipient one; Kevin buys from Pacific
//   twice ($150 each), Pacific accepts and ships from its own account, Tommy's receipt and
//   Priya's QC reject are relayed, and the second reject suspends Pacific. Both rejects refund
//   the escrow. Bayfront keeps the lab-chemical credential deploy:testnet gave it.
// Then the four POs of data/attacks/credential-attacks.json go out under Kevin's key and are
// refused; Linda's relayed approval of the last one does not change the answer.
//
// Runs once per contract: the PO ids are single-use and the three suppliers must hold no
// credential yet. A re-record needs fresh ids in the spec or `npm run reset:testnet`.
//   --json   print one JSON line after the readable text

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { JsonRpcProvider } from "near-api-js";
import type { AttackResult } from "../agents/kevin/src/attacks.ts";
import {
  type CredentialAttackFile,
  runCredentialAttacks,
  type SetupStep,
} from "../agents/kevin/src/credential-attacks.ts";
import { type ChainCall, ChainClient, explorerUrl } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { parseOutcome, type RawOutcome } from "../server/src/chain/outcome.ts";
import { RecordingTransport } from "../server/src/chain/replay.ts";
import type { ContractStanding } from "../server/src/erp-connector/credentials.ts";
import { rebuildErp } from "../server/src/erp-connector/rebuild.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { plantBStaff } from "../server/src/relayer/relayer.ts";

const root = resolve(import.meta.dirname, "..");
const json = process.argv.includes("--json");
const at = (p: string) => join(root, p);
const SPEC_FILE = at("data/attacks/credential-attacks.json");
const FIXTURE = at("data/attacks/credentials-testnet.json");
const spec = JSON.parse(readFileSync(SPEC_FILE, "utf8")) as CredentialAttackFile & {
  accounts: { owner: string; receiving: string; qc: string };
};
const { owner, policy, kevin } = spec.accounts;
const RELAYER = "dayone-relayer.testnet";
const PACIFIC = "pacific-excipient.testnet";
const FENNIMORE = "fennimore-polyols.testnet";
const SIERRA = "sierra-mineral.testnet";
const REJECTED = spec.attacks.find((a) => a.id === "suspended")?.rejectedPos ?? [];
const DOLLAR = 1_000_000n;
const nowNs = () => BigInt(Date.now()) * 1_000_000n;
const YEAR = (nowNs() + 365n * 86_400n * 1_000_000_000n).toString();

const rpc = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
});
const nearCli =
  process.env.NEAR_CLI ??
  (existsSync(join(homedir(), ".cargo", "bin", "near.exe"))
    ? join(homedir(), ".cargo", "bin", "near.exe")
    : "near");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

for (const account of [RELAYER, PACIFIC]) {
  if (!existsSync(at(`.near-credentials/testnet/${account}.json`))) {
    fail(`No key for ${account} in .near-credentials/testnet/; run npm run setup:testnet first.`);
  }
}

const live = new LiveTransport("testnet", undefined, undefined, {
  relayerId: RELAYER,
  policyContract: policy,
  staffMethods: plantBStaff(owner),
});
const view = <T>(method: string, args: Record<string, unknown> = {}) =>
  live.view({ contractId: policy, method, args }) as Promise<T>;

// Fresh contract state only: unused PO ids and suppliers HQ has never credentialed.
for (const po of [...spec.attacks.map((a) => a.poId), ...REJECTED]) {
  if ((await view("get_po", { po_id: po })) !== null) {
    fail(`${po} is already on ${policy}; give the spec fresh ids or reset the contract.`);
  }
}
for (const supplier of [FENNIMORE, SIERRA, PACIFIC]) {
  const s = await view<ContractStanding>("get_supplier_standing", { supplier });
  if (s.credential) fail(`${supplier} already holds credential #${s.credential.token}.`);
}

const setup: SetupStep[] = [];
const step = (signerId: string, method: string, args: Record<string, unknown>, o: Outcome) => {
  setup.push({
    signerId,
    method,
    args,
    status: o.status,
    txHash: o.txHash ?? "",
    events: o.events.map((e) => e.event),
  });
  const link = o.txHash ? ` ${explorerUrl("testnet", o.txHash)}` : "";
  console.log(`  ${signerId.split(".")[0]} ${method}: ${o.status}${link}`);
  if (o.status !== "success") fail(`Scene step ${method} ${o.status}: ${o.errorMessage}`);
};
type Outcome = Awaited<ReturnType<LiveTransport["send"]>>;

/** An owner call signed with Acme's key in the OS keychain, read back by its transaction id. */
async function asOwner(method: string, args: Record<string, unknown>) {
  const run = spawnSync(
    nearCli,
    [
      "contract",
      "call-function",
      "as-transaction",
      policy,
      method,
      "json-args",
      JSON.stringify(args),
      "prepaid-gas",
      "100.0 Tgas",
      "attached-deposit",
      "1 yoctoNEAR",
      "sign-as",
      owner,
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // near-cli reports progress and the transaction id on stderr.
  const out = `${run.stdout}\n${run.stderr}`;
  const txHash = /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})/.exec(out)?.[1];
  if (!txHash) fail(`near-cli sent no ${method}:\n${out}`);
  const raw = (await rpc.viewTransactionStatus({
    txHash,
    accountId: owner,
    waitUntil: "FINAL",
  })) as unknown as RawOutcome;
  step(owner, method, args, parseOutcome(raw));
}

async function call(signerId: string, kind: ChainCall["kind"], args: Record<string, unknown>) {
  const viaRelayer = signerId === spec.accounts.receiving || signerId === spec.accounts.qc;
  const o = await live.send({ kind, signerId, receiverId: policy, method: kind, args, viaRelayer });
  step(signerId, kind, args, o);
}

console.log(`Setting the scene on ${policy}`);
const issue = (supplier: string, expires: string) =>
  asOwner("issue_credential", {
    supplier,
    status: "Qualified",
    categories: ["raw_material"],
    expires_at: expires,
  });
await issue(FENNIMORE, YEAR);
await asOwner("revoke_credential", {
  supplier: FENNIMORE,
  reason: "Acme quality withdrew approval after a supplier review",
});
// Long enough for the rest of the scene to run before it lapses.
const sierraExpiry = nowNs() + 60n * 1_000_000_000n;
await issue(SIERRA, sierraExpiry.toString());
await issue(PACIFIC, YEAR);
for (const po of REJECTED) {
  await call(kevin, "submit_po", {
    po_id: po,
    supplier: PACIFIC,
    amount: (150n * DOLLAR).toString(),
    category: "raw_material",
    po_hash: "c5".repeat(32),
  });
  await call(PACIFIC, "accept_po", { po_id: po });
  await call(PACIFIC, "mark_shipped", { po_id: po, supplier_lot: "PEC-CCS-2610" });
  await call(spec.accounts.receiving, "confirm_receipt", { po_id: po });
  await call(spec.accounts.qc, "qc_reject", {
    po_id: po,
    reason: "Croscarmellose failed the identity test",
  });
}
if (!setup.at(-1)?.events.includes("supplier_suspended")) {
  fail(`${PACIFIC} was not suspended by the second reject.`);
}
// Wait for Sierra's credential to lapse on the chain's clock.
for (let i = 0; ; i += 1) {
  const s = await view<ContractStanding>("get_supplier_standing", { supplier: SIERRA });
  if (s.standing === "Expired") break;
  if (i > 90) fail(`${SIERRA} is still ${s.standing} two minutes after its expiry.`);
  await new Promise((r) => setTimeout(r, 2_000));
}

// The attacks, recorded exactly as `npm run test:attacks` replays them.
const recording = new RecordingTransport(live);
const db = openLedger(":memory:");
const { connector: erp } = await rebuildErp(":memory:");
const results: AttackResult[] = await runCredentialAttacks({
  chain: new ChainClient(db, recording, () => new Date().toISOString()),
  erp,
  spec,
  setup,
  relayStaff: true,
});
const held = results.filter((r) => r.held).length;
console.log("");
for (const r of results) {
  console.log(`${r.held ? "PASS" : "FAIL"}  ${r.attack}`);
  for (const line of r.evidence) console.log(`      ${line}`);
  for (const tx of r.txHashes) console.log(`      tx ${explorerUrl("testnet", tx)}`);
}
console.log(`\n${held} of ${results.length} credential attacks failed against Kevin.`);

if (held === results.length) {
  const fixture = {
    ...recording.fixture(),
    note: "Recorded on testnet by npm run record:credentials (scripts/record-credential-attacks.ts); replayed by npm run test:attacks.",
    setup,
  };
  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`Wrote ${FIXTURE}`);
} else {
  console.log("Not saved: an attack got through.");
}
if (json) {
  console.log(
    JSON.stringify({
      passed: held === results.length,
      setup: setup.map((s) => ({ ...s, txUrl: explorerUrl("testnet", s.txHash) })),
      attacks: results,
    }),
  );
}
process.exitCode = held === results.length ? 0 : 1;
