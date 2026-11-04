// What the clean-clone test runs and how it judges each step. A judge clones the repo with no
// .env and no .near-credentials and follows the README; this table is that README path (steps
// 1–4, every keyless command in the "Also without keys" table, the web build, the data check
// and the freeze check) as data, so scripts/clean-clone.ts (Windows) and scripts/clean-clone.sh
// (Linux) agree on what a clean clone must do, and a test checks the table against the README.

export interface Step {
  /** Short name in the PASS/FAIL line. */
  name: string;
  /** The command, as a judge would type it at the clone's root. */
  command: string;
  /** Text the output must contain (the README's "ends with" line) for a PASS. */
  expect?: string;
  /** Exit code the command must return; 0 unless stated. */
  exitCode?: number;
}

/** README steps 1–4 and every keyless command, in README order. */
export const STEPS: Step[] = [
  { name: "npm-ci", command: "npm ci" },
  {
    name: "demo",
    command: "npm run demo",
    expect: "Transcript matches data/replay/transcript.txt.",
  },
  {
    name: "verify",
    command: "npm run verify -- data/batch-records/BR-B-1045.json",
    expect: "MATCH  BR-B-1045",
  },
  // Step 4 runs on a tampered copy of that file; the runner fills the path in (tamperRecord).
  { name: "tamper", command: "npm run verify -- <tampered copy>", expect: "MISMATCH", exitCode: 1 },
  {
    name: "test-attacks",
    command: "npm run test:attacks",
    expect: "20 of 20 attacks failed against Kevin.",
  },
  { name: "ask", command: "npm run ask", expect: "6 of 6 questions answered." },
  { name: "escrow", command: "npm run escrow" },
  {
    name: "verify-attestation",
    command: "npm run verify:attestation",
    expect: "Every check verified.",
  },
  { name: "erp-reconcile", command: "npm run erp:reconcile", expect: "7 of 7 checks match." },
  { name: "demo-group", command: "npm run demo:group", expect: "Transcript matches" },
  { name: "usdc", command: "npm run usdc", expect: "Transcript matches data/usdc/transcript.txt." },
  {
    name: "sealed",
    command: "npm run sealed",
    expect: "Transcript matches data/sealed/transcript.txt.",
  },
  { name: "books", command: "npm run books" },
  { name: "brief", command: "npm run brief" },
  { name: "review", command: "npm run review", expect: "3 ready to sign" },
  {
    name: "import",
    command: 'npm run import -- "data/imports/INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx"',
  },
  { name: "inbox", command: "npm run inbox", expect: "4 of 4 scans landed" },
  {
    name: "world-check",
    command: "npm run world -- --check",
    expect: "Committed files are current.",
  },
  {
    name: "verify-round",
    command: "npm run verify:round -- data/sealed/RFQ-2611-02.round.json",
    expect: "VALID",
  },
  { name: "web-build", command: "npm run web:build" },
  { name: "web-data-check", command: "npm run web:data -- --check" },
  { name: "repo-check", command: "npm run repo:check", expect: "The repo is ready to freeze." },
  { name: "check", command: "npm run check" },
];

/** README step 5, which needs Rust: the Linux script runs it, the Windows runner says so. */
export const CONTRACT_STEP: Step = {
  name: "cargo-test",
  command: "cd contracts && cargo test",
  expect: "test result: ok",
};

/** The `npm run <name>` scripts the table covers. */
export function scriptsCovered(steps: Step[] = STEPS): Set<string> {
  const names = new Set<string>();
  for (const s of steps) {
    const m = /^npm run ([\w:-]+)/.exec(s.command);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * The `npm run <name>` commands a README section tells a judge to run: its numbered steps and
 * the rows of its command table (a command in prose, such as a screenshot's caption, is not one).
 */
export function readmeScripts(readme: string): string[] {
  const names: string[] = [];
  for (const m of readme.matchAll(/^(?:\d+\. |\| )`npm run ([\w:-]+)/gm)) names.push(m[1]);
  return [...new Set(names)];
}

/**
 * README step 4: one more gram (1000 mg) on the first `actual_mg` in a batch record, which
 * must turn MATCH into MISMATCH. Returns null when the text holds no such field.
 */
export function tamperRecord(text: string): string | null {
  const out = text.replace(
    /"actual_mg":\s*(\d+)/,
    (_m, n: string) => `"actual_mg": ${Number(n) + 1000}`,
  );
  return out === text ? null : out;
}

export interface Outcome {
  status: number | null;
  output: string;
}

/** Why a step failed, or null when it passed. */
export function judge(step: Step, outcome: Outcome): string | null {
  const want = step.exitCode ?? 0;
  if (outcome.status !== want) return `exit ${outcome.status ?? "signal"}, expected ${want}`;
  if (step.expect !== undefined && !outcome.output.includes(step.expect)) {
    return `output does not contain "${step.expect}"`;
  }
  return null;
}

export interface StepResult {
  name: string;
  ok: boolean;
  seconds: number;
  /** Set when the step failed. */
  reason?: string;
}

/** The last lines of a failed step's output, for the FAIL line. */
export function tail(output: string, lines = 20): string {
  return output.trimEnd().split(/\r?\n/).slice(-lines).join("\n");
}

/** The one line to keep from `npm run check`: Vitest's test count. */
export function testsLine(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .filter((l) => /^\s*Tests\s/.test(l))
    .at(-1)
    ?.trim();
}
