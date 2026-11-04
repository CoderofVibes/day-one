// What `npm run prove` claims and which keyless command backs each claim. A reviewer (a judge or
// a judge's coding agent) runs one command in a fresh clone and gets one PASS or FAIL line per
// claim, as Markdown or as JSON. The commands and the text each must print come from the
// clean-clone table (scripts/lib/clean-clone.ts) wherever that table has them, so the README,
// the clean-clone test and this scorecard cannot drift apart; a test checks that every command
// here names an npm script package.json defines.

import { STEPS, type Step } from "./clean-clone.ts";

export interface Claim {
  /** Short id for the JSON and the PASS/FAIL line. */
  id: string;
  /** What Day One claims, in one plain sentence. */
  claim: string;
  /** What a PASS shows, and where the evidence lives. */
  evidence: string;
  /** The commands that must all pass. */
  steps: Step[];
}

/** A step from the clean-clone table, by name. */
export function cleanCloneStep(name: string): Step {
  const s = STEPS.find((x) => x.name === name);
  if (!s) throw new Error(`no clean-clone step named ${name}`);
  return s;
}

/** The attestation check without Intel's and NVIDIA's servers: the recorded verdicts, re-checked. */
const ATTESTATION_OFFLINE: Step = {
  name: "verify-attestation-offline",
  command: "npm run verify:attestation -- --offline",
  expect: "Every check verified.",
};

export const CLAIMS: Claim[] = [
  {
    id: "loop",
    claim:
      "Kevin runs a plant's purchasing loop on NEAR testnet: low stock, quotes, a PO refused over his limit, the director's approval, escrow, delivery, QC release, payment.",
    evidence:
      "Replays the recorded testnet run call by call (data/replay/) and compares every line with data/replay/transcript.txt.",
    steps: [cleanCloneStep("demo")],
  },
  {
    id: "anchors",
    claim: "Plant records are anchored on chain, so a changed record is caught.",
    evidence:
      "A batch record verifies against its on-chain anchor (MATCH); the same record with one more gram fails (MISMATCH, exit 1).",
    steps: [cleanCloneStep("verify"), cleanCloneStep("tamper")],
  },
  {
    id: "attacks",
    claim:
      "Twenty-one attacks on Kevin, the ERP path, supplier credentials, sealed bids and the plant itself (over-orders, recalled lots, a supplier settling its own order, a short delivery invoiced in full, price spikes, over-deliveries) all fail.",
    evidence:
      "Each attack replays its recorded testnet transaction or model answer and asserts the refusal (data/attacks/, data/sealed/, data/replay/review-llm.json).",
    steps: [cleanCloneStep("test-attacks")],
  },
  {
    id: "attestation",
    claim: "Every answer Kevin's model gave in the recordings was signed inside a TEE enclave.",
    evidence:
      "Re-checks data/replay/attestation.json: the enclave quotes bound to a nonce and each answer's signature recovering to the attested signer (online, `npm run verify:attestation` also asks Intel and NVIDIA).",
    steps: [ATTESTATION_OFFLINE],
  },
  {
    id: "ask",
    claim: "Kevin answers questions from the plant's records and cites them.",
    evidence: "Six recorded questions, each answer with the record ids it cites and its signature.",
    steps: [cleanCloneStep("ask")],
  },
  {
    id: "review",
    claim:
      "Kevin reads the weekend's mailbox, drafts what a person can sign and refuses a payment-redirect email.",
    evidence: "Ten invented messages checked against the seeded ledger: 3 to sign, 1 refused.",
    steps: [cleanCloneStep("review")],
  },
  {
    id: "lots",
    claim:
      "Every lot's story, from the supplier and the payment to each batch and customer shipment, is anchored on chain as one Merkle root per plant per day, and one lot's records can be proved without disclosing the rest.",
    evidence:
      "The lot book (data/lots/lot-book.json) is checked against the genealogy, then PO-1042's lot is proved record by record against the roots the contract holds on testnet.",
    steps: [
      {
        name: "lot-book",
        command: "npm run lots",
        expect: "every root matches its records and the genealogy.",
      },
      {
        name: "verify-lot",
        command: "npm run verify:lot -- ASC-261116-01",
        expect: "3 of 3 records proved against the roots anchored on chain.",
      },
    ],
  },
  {
    id: "erp",
    claim:
      "Day One, the acquirer's ERP and the contract agree on every PO, bill, payment and supplier.",
    evidence: "Seven reconciliation checks against the recorded contract views.",
    steps: [cleanCloneStep("erp-reconcile")],
  },
  {
    id: "group",
    claim: "Three plants pool one purchase, each approving and paying its own share.",
    evidence: "Replays the recorded testnet group purchase (PO-G-2001).",
    steps: [cleanCloneStep("demo-group")],
  },
  {
    id: "sealed",
    claim: "Suppliers quote in a sealed round nobody can read or change before the deadline.",
    evidence: "Replays the recorded commit-and-reveal round and checks it from its file (VALID).",
    steps: [cleanCloneStep("sealed"), cleanCloneStep("verify-round")],
  },
  {
    id: "usdc",
    claim: "The same contract code settles a PO in Circle's testnet USDC.",
    evidence: "Replays PO-1047 on spend-policy-usdc.acme-holdings.testnet.",
    steps: [cleanCloneStep("usdc")],
  },
  {
    id: "inventory",
    claim:
      "Kevin works from the plant's own records: an imported spreadsheet, scanned batch records and twelve months of history (all fictional).",
    evidence:
      "The import wizard reads the messy fixture workbook, the watched folder takes four scans, and the three plants' twelve-month worlds match their frozen anchors.",
    steps: [cleanCloneStep("import"), cleanCloneStep("inbox"), cleanCloneStep("world-check")],
  },
  {
    id: "ui-data",
    claim: "The web UI shows the recorded run, not invented numbers.",
    evidence: "The UI's data export is regenerated from the recordings and compared.",
    steps: [cleanCloneStep("web-data-check")],
  },
  {
    id: "code",
    claim: "The TypeScript passes lint, typecheck and its test suite.",
    evidence: "Biome, tsc -b and Vitest.",
    steps: [cleanCloneStep("check")],
  },
];

/** A Windows path as WSL sees it: C:\Dev\x → /mnt/c/Dev/x. */
export function wslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (!m) return winPath.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`.replace(/\/$/, "");
}

/**
 * The contract's tests (Rust), run with --contract; CI runs them on every push. On Windows Rust
 * lives in WSL (AGENTS.md), with the target dir outside /mnt/c so the build stays fast.
 */
export function contractClaim(root: string, platform = process.platform): Claim {
  const command =
    platform === "win32"
      ? `wsl -d Ubuntu -- bash -lc "source ~/.cargo/env; cd '${wslPath(root)}/contracts' && CARGO_TARGET_DIR=\\$HOME/dayone-target cargo test"`
      : "cd contracts && cargo test";
  return {
    id: "contract",
    claim:
      "The spend-policy contract enforces limits, approvals, escrow, credentials and sealed rounds.",
    evidence: "Unit tests and the sandbox tests on a local NEAR node (`cargo test` in contracts/).",
    steps: [{ name: "cargo-test", command, expect: "test result: ok" }],
  };
}

/** The `npm run <name>` scripts the claims use. */
export function scriptsUsed(claims: Claim[] = CLAIMS): Set<string> {
  const names = new Set<string>();
  for (const c of claims)
    for (const s of c.steps) {
      const m = /^npm run ([\w:-]+)/.exec(s.command);
      if (m) names.add(m[1]);
    }
  return names;
}

export interface ClaimResult {
  id: string;
  claim: string;
  evidence: string;
  ok: boolean;
  seconds: number;
  commands: string[];
  /** Set when a step failed: which one and why. */
  reason?: string;
}

/** The scorecard as Markdown: a heading, one table row per claim, the total. */
export function markdown(results: ClaimResult[], meta: { commit: string; skipped: string[] }) {
  const passed = results.filter((r) => r.ok).length;
  const lines = [
    `# Day One proof scorecard (commit ${meta.commit})`,
    "",
    "| | Claim | Evidence | Command |",
    "|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.ok ? "PASS" : "FAIL"} | ${r.claim} | ${r.evidence}${r.reason ? ` **Failed:** ${r.reason}` : ""} | ${r.commands.map((c) => `\`${c}\``).join("<br>")} |`,
    ),
    "",
    `${passed} of ${results.length} claims proved.`,
  ];
  for (const s of meta.skipped) lines.push(`Skipped: ${s}`);
  return lines.join("\n");
}
