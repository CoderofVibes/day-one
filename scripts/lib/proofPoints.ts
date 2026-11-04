// The six proof points (docs/UPGRADE_BRIEF.md §0.1), rebuilt from the recorded files they come
// from: the attack suite, PO-1042, the group purchase PO-G-2001, the seven reconciliation checks,
// PO-1047 in Circle testnet USDC and the model attestation. data/proof-points.json is the frozen
// copy; proofPoints.test.ts rebuilds it and fails on any difference, so a later change to a
// recording or to the code that replays it cannot move a proof point unnoticed.
//
// Rewrite the snapshot (only after a deliberate re-record): tsx scripts/lib/proofPoints.ts --write

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AttackResult } from "../../agents/kevin/src/attacks.ts";
import { readAttestationFixture, recordedReceipts } from "../../server/src/attestation/fixture.ts";
import { verifyAttestation } from "../../server/src/attestation/verify.ts";
import { canonicalJson } from "../../server/src/canonical.ts";
import { type Fixture, ReplayTransport } from "../../server/src/chain/replay.ts";
import { groupRunsFromFixture, reconcile } from "../../server/src/erp-connector/reconcile.ts";
import { STAFF } from "../../server/src/seed/reference.ts";
import { replayDemoWithErp } from "./erp-demo-run.ts";

export const PROOF_POINTS_FILE = "data/proof-points.json";

/** The suite's size when the upgrade began (brief §0.1). Frozen, not counted: tests are added. */
const TESTS_AT_UPGRADE_START = 577;

const RELAYER = "dayone-relayer.testnet";

interface RecordedTx {
  hash: string;
  method: string;
  signer: string;
  paidBy: string;
  status: string;
  poId: string | null;
  error: string | null;
}

/** Every call in a chain recording, in order, as the explorer would list it. */
function transactions(fixture: Fixture): RecordedTx[] {
  return fixture.entries.flatMap((e) =>
    e.type === "call"
      ? [
          {
            hash: e.outcome.txHash ?? "",
            method: e.request.method,
            signer: e.request.signerId,
            paidBy: e.request.viaRelayer ? RELAYER : e.request.signerId,
            status: e.outcome.status,
            poId: typeof e.request.args.po_id === "string" ? e.request.args.po_id : null,
            error: e.outcome.errorMessage ?? null,
          },
        ]
      : [],
  );
}

/** "5150000000" (6 decimals) → "5150.00". */
const usd = (units: string | number) => (Number(BigInt(units) / 10_000n) / 100).toFixed(2);

function readJson<T>(root: string, path: string): T {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as T;
}

/** The contract's own words when it refused an attack, else the last line of the evidence. */
function refusalOf(r: AttackResult): string {
  for (const line of r.evidence) {
    const quoted = /^Contract[^"]*"(.+)"/.exec(line);
    if (quoted) return quoted[1] ?? line;
  }
  return r.evidence.at(-1) ?? "";
}

/** The twenty attacks, replayed by `npm run test:attacks` from their recordings. */
function attacks(root: string) {
  const out = execFileSync(
    process.execPath,
    [join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/attacks.ts", "--json"],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const last = out.trim().split("\n").at(-1) ?? "{}";
  const run = JSON.parse(last) as { passed: boolean; attacks: AttackResult[] };
  return {
    passed: run.passed,
    refused: run.attacks.filter((a) => a.held).length,
    total: run.attacks.length,
    cases: run.attacks.map((a) => ({
      name: a.attack,
      held: a.held,
      refusal: refusalOf(a),
      network: a.network ?? "testnet",
      txHashes: a.txHashes,
    })),
  };
}

function po1042(root: string) {
  const chain = readJson<Fixture>(root, "data/replay/demo-chain.json");
  const txs = transactions(chain);
  const policy = chain.entries.find(
    (e) => e.type === "view" && e.request.method === "get_agent_policy",
  );
  const limit =
    policy?.type === "view" ? (policy.result as { per_po_limit: string }).per_po_limit : "0";
  const submit = chain.entries.find(
    (e) =>
      e.type === "call" && e.request.method === "submit_po" && e.request.args.po_id === "PO-1042",
  );
  const amount = submit?.type === "call" ? String(submit.request.args.amount) : "0";
  const approval = txs.find((t) => t.method === "approve_po" && t.poId === "PO-1042");
  const run = readJson<{
    recordedAt: string;
    approvals: { request: string; response: string }[];
    steps: { title: string; staff: string[] }[];
  }>(root, "web/src/data/demo-run.json");
  const qc = run.steps.find((s) => s.title === "QC release");
  const lot = /lot (\S+)\./.exec(qc?.staff.join(" ") ?? "")?.[1] ?? "";
  return {
    network: chain.network,
    recordedAt: chain.recordedAt,
    amountUsd: usd(amount),
    perPoLimitUsd: usd(limit),
    approver: {
      account: approval?.signer ?? "",
      name: STAFF.find((p) => "account" in p && p.account === approval?.signer)?.name ?? "",
      text: run.approvals[0] ?? null,
    },
    releasedLot: lot,
    transactions: txs,
  };
}

function groupBuy(root: string) {
  const chain = readJson<Fixture>(root, "data/replay/group-chain.json");
  const web = readJson<{
    po: { poNo: string; totalUsdc: number; status: string };
    pool: { poolId: string; shares: { plantName: string; amount: number; approvedBy: string }[] };
  }>(root, "web/src/data/group-buy.json");
  return {
    network: chain.network,
    recordedAt: chain.recordedAt,
    poId: web.po.poNo,
    poolId: web.pool.poolId,
    status: web.po.status,
    totalUsd: usd(web.po.totalUsdc),
    shares: web.pool.shares.map((s) => ({
      plant: s.plantName,
      amountUsd: usd(s.amount),
      approvedBy: s.approvedBy,
    })),
    transactions: transactions(chain),
  };
}

/** `npm run erp:reconcile`, in process, from the recorded views. */
async function reconciliation(root: string) {
  const { dayOne, erpDb, connector, accounts } = await replayDemoWithErp(root, ":memory:");
  const transport = ReplayTransport.fromFile(join(root, "data/replay/reconcile-chain.json"));
  const result = await reconcile({
    dayOne,
    erpDb,
    erp: connector,
    view: (method, args = {}) => transport.view({ contractId: accounts.spendPolicy, method, args }),
    groupRuns: groupRunsFromFixture(
      readJson<Fixture>(root, "data/replay/group-chain.json"),
      accounts.network,
    ),
  });
  return {
    ok: result.ok,
    checks: result.checks.map((c) => ({
      name: c.name,
      verdict: c.skipped ? "SKIPPED" : c.ok ? "MATCH" : "MISMATCH",
      lines: c.lines,
    })),
  };
}

function usdc(root: string) {
  const chain = readJson<Fixture>(root, "data/usdc/PO-1047-chain.json");
  const submit = chain.entries.find((e) => e.type === "call" && e.request.method === "submit_po");
  return {
    network: chain.network,
    recordedAt: chain.recordedAt,
    contract: submit?.type === "call" ? submit.request.receiverId : "",
    amountUsd: submit?.type === "call" ? usd(String(submit.request.args.amount)) : "0.00",
    supplier: submit?.type === "call" ? String(submit.request.args.supplier) : "",
    transactions: transactions(chain),
  };
}

/** `npm run verify:attestation -- --offline`: the recorded Intel and NVIDIA verdicts. */
async function attestation(root: string) {
  const fixture = readAttestationFixture(root);
  if (!fixture) throw new Error("data/replay/attestation.json is missing");
  const result = await verifyAttestation(fixture, recordedReceipts(root), { online: false });
  return {
    model: fixture.model,
    fetchedAt: fixture.fetchedAt,
    ok: result.ok,
    enclaveChecks: result.enclave.length,
    signedAnswers: result.answers.length,
  };
}

/** The snapshot, keys sorted at every level (canonical.ts). */
export async function buildProofPoints(root = resolve(import.meta.dirname, "../..")) {
  const snapshot = {
    attacks: attacks(root),
    po1042: po1042(root),
    groupBuy: groupBuy(root),
    reconciliation: await reconciliation(root),
    usdcPo1047: usdc(root),
    attestation: await attestation(root),
    testsAtUpgradeStart: TESTS_AT_UPGRADE_START,
  };
  return JSON.parse(canonicalJson(snapshot)) as typeof snapshot;
}

export const formatProofPoints = (snapshot: unknown) => `${JSON.stringify(snapshot, null, 2)}\n`;

if (process.argv.includes("--write") && process.argv[1]?.endsWith("proofPoints.ts")) {
  const root = resolve(import.meta.dirname, "../..");
  writeFileSync(join(root, PROOF_POINTS_FILE), formatProofPoints(await buildProofPoints(root)));
  console.log(`wrote ${PROOF_POINTS_FILE}`);
}
