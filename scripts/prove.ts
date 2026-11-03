// npm run prove [--json] [--quick] [--contract]: one command for a reviewer. Runs every keyless
// check behind Day One's claims (scripts/lib/prove.ts) in this checkout and prints a scorecard:
// one PASS or FAIL row per claim with its evidence and command, as Markdown, or one JSON line
// with --json. --quick skips lint, typecheck and the test suite (the slowest claim); --contract
// adds the contract's Rust tests (WSL on Windows). Needs no keys, no .env and no network except
// what the README's replay commands already read; signs nothing and writes nothing tracked.
// Exit code = failed claims.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { judge, tail, tamperRecord } from "./lib/clean-clone.ts";
import { CLAIMS, type Claim, type ClaimResult, contractClaim, markdown } from "./lib/prove.ts";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const quick = argv.includes("--quick");
const withContract = argv.includes("--contract");

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
  for (const step of claim.steps) {
    let command = step.command;
    if (step.name === "tamper") {
      // One more gram on the record the previous step verified: must be MISMATCH, exit 1.
      const tampered = tamperRecord(
        readFileSync(join(root, "data/batch-records/BR-B-1045.json"), "utf8"),
      );
      if (tampered === null) {
        reason = "tamper: no actual_mg in data/batch-records/BR-B-1045.json";
        break;
      }
      const file = join(scratch, "BR-B-1045.tampered.json");
      writeFileSync(file, tampered);
      command = `npm run verify -- "${file}"`;
      commands.push("npm run verify -- <BR-B-1045 with one more gram>");
    } else {
      commands.push(command);
    }
    const outcome = sh(command);
    const why = judge(step, outcome);
    if (why) {
      reason = `${step.name}: ${why}`;
      progress(tail(outcome.output, 12));
      break;
    }
  }
  const seconds = Math.round((Date.now() - t0) / 1000);
  progress(`${reason ? "FAIL" : "PASS"} ${claim.id} (${seconds} s)${reason ? `: ${reason}` : ""}`);
  return {
    id: claim.id,
    claim: claim.claim,
    evidence: claim.evidence,
    ok: !reason,
    seconds,
    commands,
    ...(reason ? { reason } : {}),
  };
}

const claims = CLAIMS.filter((c) => !(quick && c.id === "code"));
if (withContract) claims.push(contractClaim(root));
const skipped: string[] = [];
if (quick) skipped.push("lint, typecheck and tests (--quick); `npm run check` runs them.");
if (!withContract)
  skipped.push("the contract's Rust tests; `npm run prove -- --contract` or CI runs them.");

const commit = sh("git rev-parse --short HEAD").output.trim() || "unknown";
const results = claims.map(prove);
rmSync(scratch, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok).length;
if (json) {
  console.log(
    JSON.stringify({
      commit,
      node: process.version,
      platform: process.platform,
      claims: results,
      proved: results.length - failed,
      failed,
      skipped,
    }),
  );
} else {
  console.log(markdown(results, { commit, skipped }));
}
process.exit(Math.min(failed, 255));
