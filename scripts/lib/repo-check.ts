// What must be true of the tracked repo before the Nov 13 freeze (PLAN.md Nov 12–13, AGENTS.md
// hard rule 3 and "No stubs for unbuilt features"): no private key, token or .env secret in any
// tracked file, no file whose name says it is a key, no stub marker in code, every npm script
// pointing at a file that exists, and no folder on disk with nothing tracked in it. The docs check
// (docs-check.ts) runs beside it from the same command. The regexes below spell the markers with
// a character class so this file does not report itself.

import { type EnvEntry, SECRET_SHAPES } from "./host-check.ts";

export interface RepoFile {
  /** Tracked path with forward slashes. */
  path: string;
  /** The file's text, or null when it is binary (images, wasm, workbooks). */
  text: string | null;
}

/** One `npm run <name>` entry of a package.json. */
export interface PackageScript {
  /** The package.json's path from the repo root (`package.json`, `server/package.json`). */
  file: string;
  name: string;
  command: string;
}

export interface RepoProblem {
  kind: "key-file" | "secret" | "stub" | "script" | "folder";
  file: string;
  line?: number;
  detail: string;
}

/** Extensions whose files are never read as text. */
export const BINARY_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "wasm",
  "xlsx",
  "woff",
  "woff2",
  "ttf",
  "pdf",
  "mp4",
  "mov",
  "db",
]);

/** Code and configuration: the files a stub marker is a problem in (docs tell their own story). */
const CODE_EXT = new Set([
  "ts",
  "tsx",
  "mts",
  "js",
  "mjs",
  "cjs",
  "rs",
  "css",
  "html",
  "sh",
  "toml",
  "yml",
  "yaml",
]);

/** Names git must never hold: a key or credential file, whatever is inside it. */
const KEY_FILE_NAMES: [string, RegExp][] = [
  ["a .env file", /(^|\/)\.env(\.[^/]+)?$/],
  ["a private key file", /\.(pem|key)$/i],
  ["a near-cli credentials folder", /(^|\/)\.?near-credentials\//],
  ["a function-call key file", /\.fc\.json$/],
  ["a key file", /(^|\/)[^/]*(private|secret)[^/]*\.json$/i],
];

/** Markers that a piece of code was left for later. Spelled with [x] so this file passes. */
const STUB_MARKERS: [string, RegExp][] = [
  ["a TO" + "DO marker", /\bTO[D]O\b/],
  ["a FIX" + "ME marker", /\bFIX[M]E\b/],
  ["an XX" + "X marker", /\bX[X]X\b/],
  ["a HA" + "CK marker", /\bH[A]CK\b/],
  ["a Rust to" + "do!/unimplemented! macro", /\b(to[d]o|unimpl[e]mented)!\s*\(/],
  ["'not impl" + "emented'", /\bnot impl[e]mented\b/i],
  ["'coming s" + "oon'", /\bcoming s[o]on\b/i],
  ["placeholder text", /\blorem ip[s]um\b/i],
];

/** A token of an npm script command that names a file in the repo. */
const SCRIPT_FILE = /^[\w@.-][\w@./-]*\.(ts|mts|js|mjs|cjs|sh)$/;

function ext(path: string): string {
  const i = path.lastIndexOf(".");
  return i < 0 ? "" : path.slice(i + 1).toLowerCase();
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Whether a path is read as text: not a binary extension (the caller also checks for NUL bytes). */
export function isTextPath(path: string): boolean {
  return !BINARY_EXT.has(ext(path));
}

/** Whether a stub marker counts in this file. */
export function isCodePath(path: string): boolean {
  return CODE_EXT.has(ext(path));
}

/** The repo paths an npm script command runs, relative to the repo root. */
export function scriptFiles(script: PackageScript): string[] {
  const dir = script.file.includes("/")
    ? `${script.file.slice(0, script.file.lastIndexOf("/"))}/`
    : "";
  return script.command
    .split(/\s+|&&|\|\||;|\|/)
    .filter((t) => SCRIPT_FILE.test(t) && t.includes("/"))
    .map((t) => `${dir}${t.replace(/^\.\//, "")}`);
}

/**
 * Everything wrong with the tracked repo, in plain words. `secrets` are the .env entries that
 * must not appear anywhere (host-check's `envSecrets`); a problem names the key, never the value.
 * `emptyFolders` are folders on disk with nothing tracked and not ignored (the caller walks the
 * disk). Each file reports a given shape once.
 */
export function repoProblems(
  files: RepoFile[],
  options: {
    scripts?: PackageScript[];
    secrets?: EnvEntry[];
    emptyFolders?: string[];
    exists?: (path: string) => boolean;
  } = {},
): RepoProblem[] {
  const problems: RepoProblem[] = [];
  const secrets = (options.secrets ?? []).filter((s) => s.value.length >= 12);

  for (const file of files) {
    for (const [what, shape] of KEY_FILE_NAMES) {
      if (file.path === ".env.example" || !shape.test(file.path)) continue;
      problems.push({ kind: "key-file", file: file.path, detail: `${what} is tracked` });
      break;
    }
    if (file.text === null) continue;
    for (const [what, shape] of SECRET_SHAPES) {
      const m = shape.exec(file.text);
      if (!m) continue;
      problems.push({
        kind: "secret",
        file: file.path,
        line: lineOf(file.text, m.index),
        detail: `contains ${what}`,
      });
    }
    for (const { key, value } of secrets) {
      const i = file.text.indexOf(value);
      if (i < 0) continue;
      problems.push({
        kind: "secret",
        file: file.path,
        line: lineOf(file.text, i),
        detail: `contains the value of ${key} from .env`,
      });
    }
    if (!isCodePath(file.path)) continue;
    for (const [what, shape] of STUB_MARKERS) {
      const m = shape.exec(file.text);
      if (!m) continue;
      problems.push({
        kind: "stub",
        file: file.path,
        line: lineOf(file.text, m.index),
        detail: `has ${what}`,
      });
    }
  }

  const exists = options.exists ?? (() => true);
  for (const script of options.scripts ?? []) {
    for (const path of scriptFiles(script)) {
      if (exists(path)) continue;
      problems.push({
        kind: "script",
        file: script.file,
        detail: `npm run ${script.name} runs ${path}, which does not exist`,
      });
    }
  }

  for (const folder of options.emptyFolders ?? []) {
    problems.push({ kind: "folder", file: folder, detail: "folder with nothing tracked in it" });
  }

  return problems;
}

export function formatProblem(p: RepoProblem): string {
  return p.line === undefined ? `${p.file}: ${p.detail}` : `${p.file}:${p.line}: ${p.detail}`;
}
