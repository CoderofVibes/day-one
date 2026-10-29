// npm run host:build — prepares web/dist for a public static host (docs/HOSTING.md): checks the
// recorded run's web data is current, builds the replay, adds the host's _headers file and
// refuses if any file holds a key, a token or a value from .env. It publishes nothing: going
// live is Tony's call (AGENTS.md hard rule 2); the one deploy command is printed at the end.
//   --json   one JSON line after the readable text

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { envValues, HEADERS, type HostFile, hostProblems } from "./lib/host-check.ts";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "web/dist");
const json = process.argv.includes("--json");
/** The Cloudflare Pages project the hosted demo would live in (docs/HOSTING.md). */
const PROJECT = "day-one-kevin";

/** Runs a Node script (no shell), as npm run web:data -- --check and npm run web:build do. */
function node(args: string[], cwd = root) {
  const run = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  return { ok: run.status === 0, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

const steps: { step: string; ok: boolean; detail: string }[] = [];
const fresh = node(["--import", "tsx", "scripts/web-data.ts", "--check"]);
steps.push({
  step: "recorded run exported",
  ok: fresh.ok,
  detail: fresh.ok ? "web data matches the recording" : "run npm run web:data, then commit",
});
const built = fresh.ok
  ? node([join(root, "node_modules/vite/bin/vite.js"), "build"], join(root, "web"))
  : { ok: false, out: "" };
steps.push({
  step: "replay built",
  ok: built.ok,
  detail: built.ok
    ? "web/dist"
    : fresh.ok
      ? built.out.trim().split("\n").slice(-3).join(" ")
      : "skipped",
});

let problems: string[] = [];
let files: HostFile[] = [];
if (built.ok) {
  writeFileSync(join(dist, "_headers"), HEADERS);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  files = walk(dist).map((path) => ({
    path: relative(dist, path).replace(/\\/g, "/"),
    text: readFileSync(path, "latin1"),
  }));
  const envFile = join(root, ".env");
  const secrets = existsSync(envFile) ? envValues(readFileSync(envFile, "utf8")) : [];
  problems = hostProblems(files, secrets);
  steps.push({
    step: "no keys or .env values in the folder",
    ok: problems.length === 0,
    detail: problems.length ? problems.join(" ") : `${files.length} files checked`,
  });
}

const ok = steps.every((s) => s.ok);
for (const s of steps) console.log(`${s.ok ? "PASS" : "FAIL"}  ${s.step}: ${s.detail}`);
const bytes = files.reduce((sum, f) => sum + f.text.length, 0);
if (ok) {
  console.log(
    `\nweb/dist is ready to publish (${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB). ` +
      "Nothing was published. To go live (Tony's call, docs/OPEN_QUESTIONS.md #38):\n" +
      `  npx --yes wrangler@4.152.0 pages deploy web/dist --project-name ${PROJECT} --branch main`,
  );
}
if (json) console.log(JSON.stringify({ ok, steps, files: files.length, bytes, project: PROJECT }));
process.exitCode = ok ? 0 : 1;
