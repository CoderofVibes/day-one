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
  /** A narrower claim backed by local evidence when the chain is not queried. */
  offline?: Omit<Claim, "id" | "offline">;
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
    offline: {
      claim:
        "The batch record matches the anchor in the purchasing replay, and changing it breaks the match.",
      evidence:
        "Recomputes BR-B-1045's fingerprint and compares it with the recorded anchor event. The one-gram edit returns MISMATCH.",
      steps: ["verify", "tamper"].map((name) => {
        const step = cleanCloneStep(name);
        return { ...step, command: `${step.command} --offline` };
      }),
    },
  },
  {
    id: "attacks",
    claim:
      "Twenty-one recorded attack scenarios are stopped by Kevin, the mock ERP or the contract, including a short delivery settling at a reduced amount.",
    evidence:
      "Each case checks its recorded transaction or model answer and the expected hold, refusal or reduced settlement (data/attacks/, data/sealed/, data/replay/review-llm.json).",
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
    claim: "Kevin answers six recorded questions from the plant's records and cites them.",
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
      "The seeded lot book matches its recorded daily Merkle roots, and PO-1042's lot passport verifies against the roots read from testnet.",
    evidence:
      "The lot book (data/lots/lot-book.json) is checked against the genealogy, then PO-1042's lot is proved record by record against the roots the contract holds on testnet.",
    steps: [cleanCloneStep("lots"), cleanCloneStep("verify-lot")],
    offline: {
      claim:
        "The seeded lot book matches its recorded daily roots, and each path in PO-1042's lot passport leads to its recorded root.",
      evidence: "Checks the genealogy and the passport's local Merkle paths.",
      steps: [
        cleanCloneStep("lots"),
        {
          ...cleanCloneStep("verify-lot"),
          command: "npm run verify:lot -- ASC-261116-01 --offline",
          expect: "3 of 3 records lead to their day's root.",
        },
      ],
    },
  },
  {
    id: "erp",
    claim:
      "Seven reconciliation checks agree across Day One's ledger, the mock ERP and recorded contract views.",
    evidence: "Seven reconciliation checks against the recorded contract views.",
    steps: [cleanCloneStep("erp-reconcile")],
  },
  {
    id: "group",
    claim:
      "Two plants pool PO-G-2001; each plant's director approves that plant's share, and Lakeview, with no need, stays out.",
    evidence: "Replays the recorded testnet group purchase (PO-G-2001).",
    steps: [cleanCloneStep("demo-group")],
  },
  {
    id: "sealed",
    claim:
      "Suppliers commit a quote's fingerprint before the deadline and reveal after it; the contract refuses an early award, a reveal that does not match its commitment and a late quote.",
    evidence: "Replays the recorded commit-and-reveal round and checks it from its file (VALID).",
    steps: [cleanCloneStep("sealed"), cleanCloneStep("verify-round")],
    offline: {
      claim:
        "The recorded sealed round has valid commitments and reveals, and the replay reproduces three recorded refusals.",
      evidence:
        "Checks the round locally and compares the replay with the committed proof and transcript.",
      steps: [cleanCloneStep("sealed")],
    },
  },
  {
    id: "usdc",
    claim:
      "A separate deployment of the first contract version settles PO-1047 in Circle testnet USDC.",
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
    claim: "The web replay export matches the committed recordings and seed data.",
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

/**
 * pass: every step printed what it must. fail: a step disagreed with the evidence. unverified: a
 * step could not reach testnet, so the on-chain comparison never ran; that is not evidence against
 * the claim, and it is not a pass either.
 */
export type ClaimStatus = "pass" | "fail" | "unverified";

export interface ClaimResult {
  id: string;
  claim: string;
  evidence: string;
  status: ClaimStatus;
  /** True only for a pass. */
  ok: boolean;
  seconds: number;
  commands: string[];
  /** Set when a step did not pass: which one and why. */
  reason?: string;
}

/** The word a reviewer sees for each status. */
export const STATUS_LABEL: Record<ClaimStatus, string> = {
  pass: "PASS",
  fail: "FAIL",
  unverified: "UNVERIFIED",
};

/**
 * Why a failed step failed, when its output says more than an exit code: an unreachable testnet
 * RPC is named as such, and the claim is UNVERIFIED rather than FAIL, so a reviewer in a sandbox
 * without network can tell that the local replay passed and only the chain comparison did not run.
 */
export function failureCause(output: string): string | null {
  if (
    /testnet RPC unreachable|fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|network request failed|socket hang up/i.test(
      output,
    )
  )
    return "testnet RPC unavailable; the on-chain comparison was not completed";
  return null;
}

/** What the run is about to check, before it starts: the count and mode, derived. */
export function scope(count: number, quick: boolean, offline = false): string {
  const source = offline ? "local evidence only" : "the recordings and read-only testnet queries";
  return `Checking ${count} claims from ${source}. No keys required.${quick ? " Quick mode skips lint, typecheck and tests." : ""}`;
}

/** The counts behind the result line and the JSON. */
export function tally(results: ClaimResult[]) {
  const count = (s: ClaimStatus) => results.filter((r) => r.status === s).length;
  return { proved: count("pass"), failed: count("fail"), unverified: count("unverified") };
}

/**
 * The scorecard as Markdown: the result first, then failures, unverified claims and skips, then
 * one row per claim.
 */
export function markdown(
  results: ClaimResult[],
  meta: { commit: string; skipped: string[]; offline?: boolean },
) {
  const { proved, unverified } = tally(results);
  const lines = [
    `# Day One proof scorecard (commit ${meta.commit})`,
    "",
    `**${proved} of ${results.length} ${meta.offline ? "local checks passed" : "claims proved"}.**`,
    ...(unverified
      ? [
          `${unverified} could not be checked because testnet was unreachable. That is not a failure of the claim; run again with internet.`,
        ]
      : []),
    ...results
      .filter((r) => r.status !== "pass")
      .map((r) => `- ${STATUS_LABEL[r.status]} ${r.id}: ${r.reason ?? "failed"}`),
    ...meta.skipped.map((s) => `- Skipped: ${s}`),
    "",
    "| | Claim | Evidence | Command |",
    "|---|---|---|---|",
    ...results.map((r) => {
      const note = r.reason
        ? ` **${r.status === "unverified" ? "Not checked" : "Failed"}:** ${r.reason}`
        : "";
      return `| ${STATUS_LABEL[r.status]} | ${r.claim} | ${r.evidence}${note} | ${r.commands.map((c) => `\`${c}\``).join("<br>")} |`;
    }),
  ];
  return lines.join("\n");
}
