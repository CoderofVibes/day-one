// PROOF.md, built from the testnet recordings: every recorded contract call, grouped by the
// flow it belongs to, with who signed it, who paid its gas, what the contract answered, the
// events it emitted and its explorer link; each flow names the code that enforces it, the
// keyless command that replays it and what it does not prove. scripts/proof-log.ts writes the
// file; proofLog.test.ts rebuilds it and fails when the committed copy is stale, so a re-record
// or a contract edit cannot leave PROOF.md behind.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { LOT_BOOK_FILE, type LotBook } from "../../server/src/lots/lotBook.ts";

export const PROOF_FILE = "PROOF.md";
export const EXPLORER = "https://testnet.nearblocks.io/txns/";
const RELAYER = "dayone-relayer.testnet";
const CONTRACT_SRC = "contracts/spend-policy/src";

/** One recorded call as PROOF.md lists it. */
export interface ProofCall {
  method: string;
  ref: string;
  signer: string;
  paidBy: string;
  receiver: string;
  ok: boolean;
  /** The contract's refusal, when it refused. */
  message: string | null;
  events: string[];
  txHash: string;
}

export interface Flow {
  title: string;
  claim: string;
  replay: string[];
  notProved: string;
  source: string[];
  calls: ProofCall[];
}

interface RawEntry {
  type: string;
  request?: {
    signerId: string;
    receiverId: string;
    method: string;
    args: Record<string, unknown>;
    viaRelayer?: boolean;
  };
  outcome?: {
    status: string;
    errorMessage: string | null;
    txHash?: string | null;
    events?: { event?: string }[];
  };
}

interface RawSetup {
  signerId: string;
  method: string;
  args: Record<string, unknown>;
  status: string;
  txHash: string;
  events?: string[];
}

const readJson = <T>(root: string, path: string): T =>
  JSON.parse(readFileSync(join(root, path), "utf8")) as T;

/** The record a call is about: its PO, pool, round, credential or anchored record. */
function refOf(method: string, args: Record<string, unknown>): string {
  for (const k of ["po_id", "pool_id", "round_id", "supplier"]) {
    if (typeof args[k] === "string") return args[k] as string;
  }
  if (Array.isArray(args.items)) {
    const refs = (args.items as { ref_id?: string }[]).map((i) => i.ref_id).filter(Boolean);
    return refs.join(", ");
  }
  if (typeof args.ref_id === "string") return args.ref_id;
  if (method === "set_agent_policy" && typeof args.agent === "string") return args.agent;
  return "";
}

function callsFrom(entries: RawEntry[]): ProofCall[] {
  return entries.flatMap((e) => {
    if (e.type !== "call" || !e.request || !e.outcome) return [];
    const { request: r, outcome: o } = e;
    return [
      {
        method: r.method,
        ref: refOf(r.method, r.args),
        signer: r.signerId,
        paidBy: r.viaRelayer ? RELAYER : r.signerId,
        receiver: r.receiverId,
        ok: o.status === "success",
        message: o.status === "success" ? null : (o.errorMessage ?? o.status),
        events: (o.events ?? []).map((ev) => ev.event ?? "").filter(Boolean),
        txHash: o.txHash ?? "",
      },
    ];
  });
}

function setupCalls(setup: RawSetup[], receiver: string): ProofCall[] {
  return setup.map((s) => ({
    method: s.method,
    ref: refOf(s.method, s.args),
    signer: s.signerId,
    paidBy: s.signerId,
    receiver,
    ok: s.status === "success",
    message: s.status === "success" ? null : s.status,
    events: s.events ?? [],
    txHash: s.txHash,
  }));
}

/** Where each public contract method is defined: method → "path:line". */
export function methodIndex(root: string): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (dir: string) => {
    for (const d of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${d.name}`;
      if (d.isDirectory()) {
        if (d.name !== "tests") walk(path);
      } else if (d.name.endsWith(".rs")) {
        readFileSync(join(root, path), "utf8")
          .split(/\r?\n/)
          .forEach((line, i) => {
            const m = /^\s*pub fn (\w+)/.exec(line);
            if (m && !index.has(m[1])) index.set(m[1], `${path}:${i + 1}`);
          });
      }
    }
  };
  walk(CONTRACT_SRC);
  return index;
}

/** The anchored record files a reviewer can check with `npm run verify -- <file>`. */
function anchoredRecords(root: string): { file: string; ref: string; kind: string; tx: string }[] {
  const files = [
    "data/batch-records/BR-B-1045.json",
    ...readdirSync(join(root, "data/quotes"))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => `data/quotes/${f}`),
  ];
  return files.map((file) => {
    const r = readJson<{ kind: string; ref_id: string; anchored_tx: string }>(root, file);
    return { file, ref: r.ref_id, kind: r.kind, tx: r.anchored_tx };
  });
}

export function flows(root: string): Flow[] {
  const credentials = readJson<{ entries: RawEntry[]; setup: RawSetup[] }>(
    root,
    "data/attacks/credentials-testnet.json",
  );
  const contractOf = (entries: RawEntry[]) =>
    entries.find((e) => e.type === "call")?.request?.receiverId ?? "";
  return [
    {
      title: "The purchasing loop: PO-1041 and PO-1042",
      claim:
        "Kevin anchors the batch record, places PO-1041 inside his limits, is refused on PO-1042 over his $2,500 per-PO limit, and the order goes ahead only after the director approves it; escrow is funded, the supplier ships, the receiving lead confirms, QC releases the lot and the contract pays the supplier in that call.",
      replay: ["npm run demo"],
      notProved:
        "The director's text reply is simulated and her key is held by the server; the run settles in DTUSD, a labeled test token.",
      source: [],
      calls: callsFrom(
        readJson<{ entries: RawEntry[] }>(root, "data/replay/demo-chain.json").entries,
      ),
    },
    {
      title: "Attacks on Kevin and the ERP path",
      claim:
        "A look-alike supplier, a re-sent PO, a split purchase and a ghost vendor reach the contract and are refused there.",
      replay: ["npm run test:attacks"],
      notProved:
        "The suite's other attacks (inflated, hidden-text and duplicate invoices, the payment-failed and bank-details messages) are stopped by Kevin or the ERP before any transaction; `npm run test:attacks` replays them from their recorded answers.",
      source: [],
      calls: callsFrom(
        readJson<{ entries: RawEntry[] }>(root, "data/replay/attacks-chain.json").entries,
      ),
    },
    {
      title: "Supplier credentials",
      claim:
        "HQ issues, revokes and lets lapse supplier credentials; POs to a revoked, expired, out-of-category or suspended supplier are refused, and two relayed QC rejects suspend a supplier.",
      replay: ["npm run test:attacks"],
      notProved:
        "The credentials are issued by the acquirer's own account; there is no outside supplier-verification service behind them.",
      source: [],
      calls: [
        ...setupCalls(credentials.setup, contractOf(credentials.entries)),
        ...callsFrom(credentials.entries),
      ],
    },
    {
      title: "Group purchase: PO-G-2001",
      claim:
        "Three plants pool their ascorbic acid demand into one pooled PO; each plant's share is checked against its own limits and approved by its own director, and the supplier is paid once.",
      replay: ["npm run demo:group"],
      notProved: "Plants A and C are seeded plants with the same fictional data as Plant B.",
      source: [],
      calls: callsFrom(
        readJson<{ entries: RawEntry[] }>(root, "data/replay/group-chain.json").entries,
      ),
    },
    {
      title: "Sealed quote round: RFQ-2611-02",
      claim:
        "Suppliers commit hashed quotes before a deadline and reveal them after it. The contract refuses a quote from an unapproved supplier, a reveal or an award before the deadline, a reveal that does not match its commitment and a quote after the deadline; the award goes to a revealed quote.",
      replay: ["npm run sealed", "npm run verify:round -- data/sealed/RFQ-2611-02.round.json"],
      notProved:
        "Commit-and-reveal hides quote contents until the reveal, not the fact that a supplier quoted.",
      source: [],
      calls: callsFrom(
        readJson<{ entries: RawEntry[] }>(root, "data/sealed/RFQ-2611-02.chain.json").entries,
      ),
    },
    {
      title: "PO-1047 in Circle testnet USDC",
      claim:
        "The same contract code, deployed with Circle's testnet USDC as its token, takes PO-1047 from submission to payment.",
      replay: ["npm run usdc"],
      notProved: "A $19.00 order on testnet; the main run uses DTUSD.",
      source: [],
      calls: callsFrom(
        readJson<{ entries: RawEntry[] }>(root, "data/usdc/PO-1047-chain.json").entries,
      ),
    },
    lotBookFlow(root),
  ].map((f) => ({ ...f, source: sourceFor(root, f.calls) }));
}

/** The lot book's anchoring transactions: one row per anchor_batch call, the days it sealed. */
function lotBookFlow(root: string): Flow {
  const book = readJson<LotBook>(root, LOT_BOOK_FILE);
  const byTx = new Map<string, { plant: string; refs: string[] }>();
  for (const d of book.days) {
    const tx = book.anchors[d.refId];
    if (!tx) continue;
    const g = byTx.get(tx) ?? { plant: d.plant, refs: [] };
    g.refs.push(d.refId);
    byTx.set(tx, g);
  }
  const rootAccount = book.contract?.split(".").slice(1).join(".") ?? "";
  return {
    title: "Lot book: one anchored root per plant per day",
    claim:
      "Each plant's agent anchors the Merkle root of every day's lot records (receipts, QC decisions, batches, shipments and the payments the contract made), each root naming the day before. A lot passport proves one lot's records against these roots and discloses nothing else.",
    replay: ["npm run lots", "npm run verify:lot -- ASC-261116-01"],
    notProved:
      "The twelve months of history are seeded, and their roots were anchored together on Nov 3, 2026, not night by night as the days passed; the roots prove the records have not changed since they were anchored.",
    source: [],
    calls: [...byTx.entries()].map(([txHash, g]) => {
      const agent = `kevin.plant-${g.plant.toLowerCase()}.${rootAccount}`;
      const first = (g.refs[0] ?? "").replace(/^LOTBOOK-/, "");
      const last = (g.refs.at(-1) ?? "").replace(/^LOTBOOK-\w-/, "");
      return {
        method: "anchor_batch",
        ref: `LOTBOOK-${first} to ${last} (${g.refs.length} days)`,
        signer: agent,
        paidBy: agent,
        receiver: book.contract ?? "",
        ok: true,
        message: null,
        events: [],
        txHash,
      };
    }),
  };
}

function sourceFor(root: string, calls: ProofCall[]): string[] {
  const index = methodIndex(root);
  return [...new Set(calls.map((c) => c.method))].flatMap((m) => {
    const at = index.get(m);
    return at ? [`${m} ${at}`] : [];
  });
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function sourceLink(entry: string): string {
  const [method, at] = entry.split(" ");
  const [path, line] = at.split(":");
  return `[\`${method}\`](${path}#L${line}) (${relative(CONTRACT_SRC, path)}:${line})`;
}

/** PROOF.md's text. */
export function buildProofLog(root: string): string {
  const fl = flows(root);
  const total = fl.reduce((n, f) => n + f.calls.length, 0);
  const refused = fl.reduce((n, f) => n + f.calls.filter((c) => !c.ok).length, 0);
  const records = anchoredRecords(root);
  const att = readJson<{ fetchedAt: string; model: string; signatures: Record<string, unknown> }>(
    root,
    "data/replay/attestation.json",
  );
  const signed = Object.keys(att.signatures).length;
  const out: string[] = [
    "# Proof log",
    "",
    "Every contract call Day One recorded on NEAR testnet, grouped by flow, with the code that enforces it and the keyless command that replays it. Generated by `npm run proof` from the recordings in `data/`; a test fails when this file is stale. Run `npm run proof -- --live` to ask testnet RPC for every transaction again.",
    "",
    `**${total} recorded transactions**, ${refused} of them refused by the contract on purpose (that refusal is the proof), across ${fl.length} flows; ${records.length} anchored records any reviewer can verify; ${signed} model answers signed in a TEE enclave. All data is fictional. For a PASS/FAIL scorecard of every claim, run \`npm run prove\`.`,
    "",
    "## Contents",
    "",
    ...fl.map(
      (f, i) => `${i + 1}. [${f.title}](#${anchorOf(f.title)}) (${f.calls.length} transactions)`,
    ),
    `${fl.length + 1}. [Anchored records](#anchored-records) (${records.length})`,
    `${fl.length + 2}. [Signed model answers](#signed-model-answers) (${signed})`,
    "",
  ];
  for (const f of fl) {
    out.push(
      `## ${f.title}`,
      "",
      f.claim,
      "",
      `- **Replay (no keys):** ${f.replay.map((c) => `\`${c}\``).join(", then ")}`,
      `- **Contract:** \`${f.calls[0]?.receiver ?? ""}\``,
      `- **Enforced in:** ${f.source.map(sourceLink).join(", ")}`,
      `- **Does not prove:** ${f.notProved}`,
      "",
      "| # | Call | Record | Signed by | Gas paid by | Contract's answer | Events | Transaction |",
      "|---|---|---|---|---|---|---|---|",
      ...f.calls.map(
        (c, i) =>
          `| ${i + 1} | \`${c.method}\` | ${cell(c.ref)} | ${c.signer} | ${c.paidBy} | ${c.ok ? "ok" : `**refused:** ${cell(short(c.message ?? ""))}`} | ${c.events.join(", ")} | [${c.txHash.slice(0, 8)}…](${EXPLORER}${c.txHash}) |`,
      ),
      "",
    );
  }
  out.push(
    "## Anchored records",
    "",
    "Each file holds a record, its salt and the transaction that anchored its hash. `npm run verify -- <file>` hashes the record again and compares it with the anchor on chain: MATCH, or MISMATCH when one character changed.",
    "",
    "| Record | Kind | File | Anchored in |",
    "|---|---|---|---|",
    ...records.map(
      (r) =>
        `| ${r.ref} | ${r.kind} | [${r.file}](${r.file}) | [${r.tx.slice(0, 8)}…](${EXPLORER}${r.tx}) |`,
    ),
    "",
    "## Signed model answers",
    "",
    `Kevin's model (\`${att.model}\`) runs on NEAR AI Cloud inside a TEE. [data/replay/attestation.json](data/replay/attestation.json) holds the enclave's attestation report, fetched ${att.fetchedAt.slice(0, 10)} with a fresh nonce, and ${signed} recorded answers, each signed by the attested key. \`npm run verify:attestation\` checks the report with Intel and NVIDIA and every signature; \`-- --offline\` re-checks the recorded verdicts without them.`,
    "",
  );
  return out.join("\n");
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function anchorOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Every recorded transaction with the account that sent it, for --live. */
export function allTransactions(root: string): { hash: string; sender: string; ok: boolean }[] {
  return flows(root).flatMap((f) =>
    f.calls.map((c) => ({ hash: c.txHash, sender: c.paidBy, ok: c.ok })),
  );
}
