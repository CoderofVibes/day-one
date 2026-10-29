// npm run docs:check [--json]: every tracked markdown file against the repo. A relative link
// must reach a file, a backtick path into the repo must exist (or be output git ignores), and
// an `npm run <name>` must be a script some package.json defines. Dated records keep their old
// paths (scripts/lib/docs-check.ts). No keys, no network. Exit 1 when anything is stale.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DocFile, docProblems, formatProblem } from "./lib/docs-check.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = process.argv.includes("--json");

function git(...args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
}

const tracked = git("ls-files").stdout.split("\n").filter(Boolean);
const files: DocFile[] = tracked
  .filter((p) => p.endsWith(".md"))
  .map((p) => ({ path: p, text: readFileSync(join(root, p), "utf8") }));

const scripts = new Set<string>();
for (const p of tracked.filter((f) => f === "package.json" || f.endsWith("/package.json"))) {
  if (p.includes("node_modules/")) continue;
  const pkg = JSON.parse(readFileSync(join(root, p), "utf8")) as {
    scripts?: Record<string, string>;
  };
  for (const name of Object.keys(pkg.scripts ?? {})) scripts.add(name);
}

const ignoredCache = new Map<string, boolean>();
const problems = docProblems(files, {
  exists: (p) => existsSync(join(root, p)),
  ignored: (p) => {
    let v = ignoredCache.get(p);
    if (v === undefined) {
      v = git("check-ignore", "-q", "--", p).status === 0;
      ignoredCache.set(p, v);
    }
    return v;
  },
  topLevel: new Set(tracked.map((p) => p.split("/")[0])),
  scripts,
});

if (json) {
  console.log(JSON.stringify({ files: files.length, problems }));
} else {
  for (const p of problems) console.log(formatProblem(p));
  console.log(
    `${files.length} markdown files, ${problems.length} stale ${problems.length === 1 ? "reference" : "references"}.`,
  );
}
process.exit(problems.length === 0 ? 0 : 1);
