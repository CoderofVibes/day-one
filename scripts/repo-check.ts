// npm run repo:check [--json]: the tracked repo against the freeze rules (PLAN.md Nov 12–13).
// No private key, token or .env secret in any tracked file; no key file tracked; no stub marker
// (TODO, FIXME, "not implemented", …) in code; every npm script runs a file that exists; no folder
// on disk with nothing tracked in it (an unbuilt feature's leftovers); and every markdown file
// passes npm run docs:check. No keys, no network. Exit 1 when anything is wrong.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type DocFile, docProblems, formatProblem as formatDocProblem } from "./lib/docs-check.ts";
import { envSecrets } from "./lib/host-check.ts";
import {
  formatProblem,
  isTextPath,
  type PackageScript,
  type RepoFile,
  repoProblems,
} from "./lib/repo-check.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = process.argv.includes("--json");

function git(...args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
}

const tracked = git("ls-files").stdout.split("\n").filter(Boolean);

// Tracked files, read as text unless the extension or a NUL byte says binary.
const files: RepoFile[] = tracked.map((path) => {
  if (!isTextPath(path)) return { path, text: null };
  const buf = readFileSync(join(root, path));
  return { path, text: buf.subarray(0, 8000).includes(0) ? null : buf.toString("utf8") };
});

// Every npm script of every workspace package.json.
const scripts: PackageScript[] = [];
for (const file of tracked.filter((f) => f === "package.json" || f.endsWith("/package.json"))) {
  if (file.includes("node_modules/")) continue;
  const pkg = JSON.parse(readFileSync(join(root, file), "utf8")) as {
    scripts?: Record<string, string>;
  };
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    scripts.push({ file, name, command });
  }
}

// Folders on disk (three levels deep) with nothing tracked under them that git does not ignore.
const trackedDirs = new Set<string>();
for (const path of tracked) {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) trackedDirs.add(parts.slice(0, i).join("/"));
}
const emptyFolders: string[] = [];
function walk(dir: string, depth: number) {
  for (const name of readdirSync(join(root, dir))) {
    if (name === ".git" || name === "node_modules") continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (!statSync(join(root, rel)).isDirectory()) continue;
    if (trackedDirs.has(rel)) {
      if (depth < 3) walk(rel, depth + 1);
      continue;
    }
    if (git("check-ignore", "-q", "--", rel).status !== 0) emptyFolders.push(rel);
  }
}
walk("", 1);

// The .env secrets, when a .env exists here (the example's values are public).
const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const secrets = existsSync(join(root, ".env"))
  ? envSecrets(read(join(root, ".env")), read(join(root, ".env.example")))
  : [];

const problems = repoProblems(files, {
  scripts,
  secrets,
  emptyFolders,
  exists: (p) => existsSync(join(root, p)),
});

// The docs check, from the same tracked list (scripts/docs-check.ts has the full description).
const docs: DocFile[] = files
  .filter((f): f is RepoFile & { text: string } => f.path.endsWith(".md") && f.text !== null)
  .map((f) => ({ path: f.path, text: f.text }));
const ignoredCache = new Map<string, boolean>();
const docProblemList = docProblems(docs, {
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
  scripts: new Set(scripts.map((s) => s.name)),
});

const count = (kind: string) => problems.filter((p) => p.kind === kind).length;
const total = problems.length + docProblemList.length;

if (json) {
  console.log(
    JSON.stringify({
      files: files.length,
      code: files.filter((f) => f.text !== null).length,
      scripts: scripts.length,
      problems,
      docs: docProblemList,
    }),
  );
} else {
  for (const p of problems) console.log(formatProblem(p));
  for (const p of docProblemList) console.log(formatDocProblem(p));
  console.log(
    `${files.length} tracked files, ${scripts.length} npm scripts: ` +
      `${count("key-file")} key files, ${count("secret")} secrets, ${count("stub")} stub markers, ` +
      `${count("script")} scripts pointing nowhere, ${count("folder")} folders with nothing tracked, ` +
      `${docProblemList.length} stale doc references.`,
  );
  console.log(total === 0 ? "The repo is ready to freeze." : `${total} to fix before the freeze.`);
}
process.exit(total === 0 ? 0 : 1);
