// npm run clean-clone [--keep] [--clone <dir>] [--json]: the clean-clone test on Windows (or any
// OS with Node 24 and git). Clones HEAD into a fresh folder under the temp directory with no .env
// and no .near-credentials, strips every variable .env.example names from the environment, and
// runs the README path (scripts/lib/clean-clone.ts): steps 1–4, every keyless command in the
// README table, the web build, the data check, npm run repo:check and npm run check. One PASS or
// FAIL line per step with the last lines of a failure; exit code = failures. README step 5 (the
// contract tests) needs Rust, which lives in WSL here: scripts/clean-clone.sh runs it. The clone
// is deleted afterwards unless --keep (or KEEP=1). Signs nothing; reads testnet for escrow and
// Intel and NVIDIA for the attestation, as the README commands do.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_STEP,
  judge,
  STEPS,
  type Step,
  type StepResult,
  tail,
  tamperRecord,
  testsLine,
} from "./lib/clean-clone.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const keep = argv.includes("--keep") || process.env.KEEP === "1";
const cloneArg = argv[argv.indexOf("--clone") + 1];
const clone = resolve(
  argv.includes("--clone") && cloneArg ? cloneArg : join(tmpdir(), "dayone-clean-clone"),
);

// The clone sees no .env value: a judge's machine has none of them.
const env: NodeJS.ProcessEnv = { ...process.env };
for (const m of readFileSync(join(root, ".env.example"), "utf8").matchAll(
  /^([A-Z][A-Z0-9_]*)=/gm,
)) {
  delete env[m[1]];
}
if (keep) env.KEEP = "1";

const say = (line: string) => {
  if (!json) console.log(line);
};

/** Deletes a folder that may hold npm's workspace junctions (rmdir does not follow them). */
function removeTree(dir: string) {
  if (!existsSync(dir)) return;
  if (process.platform === "win32") {
    spawnSync("cmd", ["/c", "rmdir", "/s", "/q", dir], { stdio: "ignore" });
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function sh(command: string, cwd: string): { status: number | null; output: string } {
  const r = spawnSync(command, {
    cwd,
    env,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const results: StepResult[] = [];
function record(step: Step, outcome: { status: number | null; output: string }, seconds: number) {
  const reason = judge(step, outcome);
  const r: StepResult = { name: step.name, ok: reason === null, seconds };
  if (reason) r.reason = reason;
  results.push(r);
  if (r.ok) {
    say(`PASS ${step.name} (${seconds} s)`);
  } else {
    say(`FAIL ${step.name} (${seconds} s): ${reason}`);
    say(tail(outcome.output));
  }
  return outcome;
}

function runStep(step: Step, command = step.command) {
  const t0 = Date.now();
  const outcome = sh(command, clone);
  return record(step, outcome, Math.round((Date.now() - t0) / 1000));
}

// A fresh clone of HEAD: commit first, or the clone tests the previous commit.
removeTree(clone);
const logs = mkdtempSync(join(tmpdir(), "dayone-clone-logs-"));
const cloned = spawnSync("git", ["clone", "-q", root, clone], { encoding: "utf8" });
if (cloned.status !== 0) {
  console.error(cloned.stderr);
  process.exit(1);
}
const commit = sh("git rev-parse --short HEAD", clone).output.trim();
say(
  `commit ${commit}, node ${process.version}, ${process.platform} ${process.arch}, clone ${clone}`,
);

// No secret file came along.
const secretFiles = [".env", ".near-credentials", "near-credentials"].filter((f) =>
  existsSync(join(clone, f)),
);
results.push({ name: "no secrets in the clone", ok: secretFiles.length === 0, seconds: 0 });
say(
  secretFiles.length === 0
    ? "PASS no secrets in the clone"
    : `FAIL no secrets in the clone: ${secretFiles.join(", ")}`,
);

for (const step of STEPS) {
  if (step.name === "tamper") {
    // README step 4: one more gram on the record verified in step 3 must give MISMATCH, exit 1.
    const tampered = tamperRecord(
      readFileSync(join(clone, "data/batch-records/BR-B-1045.json"), "utf8"),
    );
    if (tampered === null) {
      record(
        step,
        { status: null, output: "no actual_mg in data/batch-records/BR-B-1045.json" },
        0,
      );
      continue;
    }
    const file = join(logs, "tampered.json");
    writeFileSync(file, tampered);
    runStep(step, `npm run verify -- "${file}"`);
    continue;
  }
  const outcome = runStep(step);
  if (step.name === "check") {
    const line = testsLine(outcome.output);
    if (line) say(`  ${line}`);
  }
}
say(`SKIP ${CONTRACT_STEP.name}: needs Rust; scripts/clean-clone.sh runs it in WSL`);

const dirty = sh("git status --porcelain", clone).output.trim();
results.push({ name: "clone stays clean", ok: dirty === "", seconds: 0 });
say(dirty === "" ? "PASS clone stays clean" : `FAIL clone stays clean\n${dirty}`);

const failures = results.filter((r) => !r.ok).length;
if (json) {
  console.log(
    JSON.stringify({
      commit,
      node: process.version,
      platform: process.platform,
      clone,
      keep,
      steps: results,
      failures,
    }),
  );
} else {
  console.log(`failures: ${failures}`);
  if (keep) console.log(`clone kept at ${clone}`);
}
if (!keep) {
  removeTree(clone);
  removeTree(logs);
}
process.exit(Math.min(failures, 255));
