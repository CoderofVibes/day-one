// npm run history:scan: every blob on every ref of git history, searched for secrets before the
// repo goes public (docs/SUBMISSION_CHECKLIST.md). Prints names, paths and counts, never a value.
// By default it searches by pattern (NEAR, PEM, GitHub, OpenAI/Anthropic, AWS and Slack keys,
// secret fields with a value), for credential-like paths ever committed, and for the personal
// strings in HISTORY_SCAN_PERSONAL (comma-separated, from the environment, never committed).
// EXACT=1 also reads .env and the .near-credentials key files and searches for each exact value,
// kept in memory only; values .env.example carries are public on purpose and skipped.
// Exit code: the number of kinds of hit.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const git = (args: string[], input?: string): Buffer =>
  spawnSync("git", args, {
    input: input === undefined ? undefined : Buffer.from(input, "utf8"),
    maxBuffer: 1 << 30,
  }).stdout;

// Every object reachable from every ref, with the first path it was seen at.
const paths = new Map<string, string>();
for (const line of git(["rev-list", "--all", "--objects"]).toString("utf8").trim().split("\n")) {
  const [sha, ...rest] = line.split(" ");
  if (sha && rest.length) paths.set(sha, rest.join(" "));
}
const blobs = git(["cat-file", "--batch-check"], [...paths.keys()].join("\n"))
  .toString("utf8")
  .trim()
  .split("\n")
  .map((l) => l.split(" "))
  .filter(([, type]) => type === "blob")
  .map(([sha, , size]) => ({
    sha: sha as string,
    size: Number(size),
    path: paths.get(sha as string) ?? "",
  }));

const exact: { name: string; value: string }[] = [];
if (process.env.EXACT === "1") {
  if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#\r\n]*)"?/.exec(line);
      const value = m?.[2]?.trim() ?? "";
      if (m && value.length >= 12) exact.push({ name: `.env ${m[1]}`, value });
    }
  }
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith(".json")) {
        try {
          const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
          for (const k of ["private_key", "secret_key", "seed_phrase"]) {
            const v = j[k];
            if (typeof v === "string" && v.length > 20)
              exact.push({ name: `key file ${f} (${k})`, value: v });
          }
        } catch {
          // Not a key file.
        }
      }
    }
  };
  walk(join(homedir(), ".near-credentials"));
  walk(".near-credentials");
}
const example = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
const values = exact.filter((e) => !example.includes(e.value));
const personal = (process.env.HISTORY_SCAN_PERSONAL ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length >= 4)
  .map((value, i) => ({ name: `personal string ${i + 1}`, value }));

const patterns: [string, RegExp][] = [
  ["NEAR private key", /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/],
  ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ["OpenAI/Anthropic key", /\bsk-(ant-)?[A-Za-z0-9_-]{24,}/],
  ["AWS key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  [
    "secret field with a value",
    /"(private_key|secret_key|seed_phrase|mnemonic)"\s*:\s*"[^"]{20,}"/,
  ],
];

const hits = new Map<string, Set<string>>();
const add = (label: string, path: string) => {
  if (!hits.has(label)) hits.set(label, new Set());
  hits.get(label)?.add(path);
};
const small = blobs.filter((b) => b.size < 5_000_000);
for (let i = 0; i < small.length; i += 400) {
  const batch = small.slice(i, i + 400);
  const out = git(["cat-file", "--batch"], batch.map((b) => b.sha).join("\n"));
  let at = 0;
  for (const b of batch) {
    const nl = out.indexOf(10, at);
    const body = out.subarray(nl + 1, nl + 1 + b.size).toString("latin1");
    at = nl + 1 + b.size + 1;
    for (const [label, re] of patterns) if (re.test(body)) add(label, b.path);
    for (const e of values) if (body.includes(e.value)) add(`exact value: ${e.name}`, b.path);
    for (const p of personal) if (body.includes(p.value)) add(p.name, b.path);
  }
}

const credentialPath =
  /(^|\/)(\.near-credentials\/|\.env($|\.(?!example))|[^/]*\.pem$|[^/]*\.key$)/;
const committed = [...new Set(blobs.map((b) => b.path))].filter((p) => credentialPath.test(p));

console.log(
  `Blobs scanned: ${small.length} of ${blobs.length} on every ref. Exact values: ${process.env.EXACT === "1" ? values.length : "not read (EXACT=1 reads them)"}. Personal strings: ${personal.length}.`,
);
console.log(
  `Credential-like paths ever committed: ${committed.length ? committed.join(", ") : "none"}.`,
);
if (committed.length) add("credential-like path", committed.join(", "));
for (const [label, set] of hits) {
  const list = [...set];
  console.log(
    `HIT ${label}: ${list.slice(0, 8).join(", ")}${list.length > 8 ? ` (+${list.length - 8})` : ""}`,
  );
}
console.log(hits.size ? `${hits.size} kinds of hit.` : "No hits.");
process.exitCode = hits.size;
