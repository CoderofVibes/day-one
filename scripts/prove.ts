// npm run prove -- [--json] [--quick] [--offline | --contract]: one command for a reviewer. Runs the keyless
// checks behind Day One's claims (scripts/lib/prove.ts) in this checkout and prints a scorecard:
// the result line first, then one PASS or FAIL row per claim with its evidence and command, as
// Markdown, or one JSON line with --json (`npm run --silent prove -- --json` for a parser). --quick skips lint, typecheck and the test suite (the slowest claim); --contract
// adds the contract's Rust tests (WSL on Windows). Needs no keys, no .env and no network except
// what the README's replay commands already read; signs nothing and writes nothing tracked.
// A claim whose step could not reach testnet is UNVERIFIED, not FAIL. Exit code = claims not
// proved (failed or unverified), so nothing unproved passes silently.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, tail, tamperRecord } from "./lib/clean-clone.ts";
import {
  CLAIMS,
  type Claim,
  type ClaimResult,
  type ClaimStatus,
  contractClaim,
  failureCause,
  markdown,
  STATUS_LABEL,
  scope,
  tally,
} from "./lib/prove.ts";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const quick = argv.includes("--quick");
const offline = argv.includes("--offline");
const withContract = argv.includes("--contract");
if (offline && withContract) {
  console.error(
    "--offline and --contract must run separately. Rust tests may download dependencies.",
  );
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), "dayone-prove-"));
const progress = (line: string) => {
  if (!json) process.stderr.write(`${line}\n`);
};

function sh(command: string) {
  const r = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function prove(claim: Claim): ClaimResult {
  const t0 = Date.now();
  const commands: string[] = [];
  let reason: string | undefined;
  let status: ClaimStatus = "pass";
  for (const step of claim.steps) {
    let command = step.command;
    if (step.name === "tamper") {
      // One more gram on the record the previous step verified: must be MISMATCH, exit 1.
      const tampered = tamperRecord(
        readFileSync(join(root, "data/batch-records/BR-B-1045.json"), "utf8"),
      );
      if (tampered === null) {
        reason = "tamper: no actual_mg in data/batch-records/BR-B-1045.json";
        status = "fail";
        break;
      }
      const file = join(scratch, "BR-B-1045.tampered.json");
      writeFileSync(file, tampered);
      command = command.replace("<tampered copy>", () => `"${file}"`);
    }
    commands.push(step.command);
    const outcome = sh(command);
    const why = judge(step, outcome);
    if (why) {
      const cause = offline ? null : failureCause(outcome.output);
      reason = `${step.name}: ${why}${cause ? ` (${cause})` : ""}`;
      status = cause ? "unverified" : "fail";
      progress(tail(outcome.output, 12));
      break;
    }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  progress(`${STATUS_LABEL[status]} ${claim.id} (${seconds} s)${reason ? `: ${reason}` : ""}`);
  return {
    id: claim.id,
    claim: claim.claim,
    evidence: claim.evidence,
    status,
    ok: status === "pass",
    seconds,
    commands,
    ...(reason ? { reason } : {}),
  };
}

const claims = CLAIMS.filter((c) => !(quick && c.id === "code")).map((claim) =>
  offline && claim.offline ? { id: claim.id, ...claim.offline } : claim,
);
if (withContract) claims.push(contractClaim(root));
const skipped: string[] = [];
if (quick) skipped.push("lint, typecheck and tests (--quick); `npm run check` runs them.");
if (offline)
  skipped.push("live testnet comparisons for the batch record, lot passport and sealed round.");
if (!withContract)
  skipped.push("the contract's Rust tests; `npm run prove -- --contract` or CI runs them.");

const commit = sh("git rev-parse --short HEAD").output.trim() || "unknown";
progress(scope(claims.length, quick, offline));
const results = claims.map(prove);
rmSync(scratch, { recursive: true, force: true });

const { proved, failed, unverified } = tally(results);
if (json) {
  console.log(
    JSON.stringify({
      commit,
      node: process.version,
      platform: process.platform,
      offline,
      claims: results,
      proved,
      failed,
      unverified,
      skipped,
    }),
  );
} else {
  console.log(markdown(results, { commit, skipped, offline }));
}
process.exit(Math.min(failed + unverified, 255));
