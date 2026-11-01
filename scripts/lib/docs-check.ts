// What a tracked markdown file may point at: a relative link to a file in the repo, a backtick
// path into the repo, and an `npm run <name>` that a package.json defines. A judge reads the
// docs without running them, so a path to a file that no longer exists, or a command that was
// renamed, is a defect. Dated records (Tony's brief, the plan, the lessons, the open questions,
// the research and the phase 0 package) describe the repo as it was on their day; only their
// links are checked.

import { dirname, normalize, posix } from "node:path";

export interface DocFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  text: string;
}

export interface DocsRepo {
  /** True when the path is a file or folder in the working tree. */
  exists(path: string): boolean;
  /** True when git ignores the path: output a command writes, never committed. */
  ignored(path: string): boolean;
  /** Top-level folders and files of the repo (`git ls-files` first segments). */
  topLevel: Set<string>;
  /** Every npm script name the root and workspace package.json files define. */
  scripts: Set<string>;
}

export interface DocProblem {
  file: string;
  line: number;
  kind: "link" | "path" | "script";
  target: string;
}

/** Files whose paths are history, not a description of the repo today. */
export const DATED_RECORDS: RegExp[] = [
  /^PROJECT_BRIEF\.md$/, // Tony's brief, version 2 of Oct 22
  /^docs\/PLAN\.md$/,
  /^docs\/LESSONS\.md$/,
  /^docs\/OPEN_QUESTIONS\.md$/,
  /^docs\/research\//,
  /^docs\/phase0\//,
  /^docs\/astra\/2/, // Astra's dated passes and briefs: they name files they propose
];

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BACKTICK_PATH = /`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.<>*{}-]+)+)\/?`/g;
const NPM_RUN = /`npm run (?:--silent )?([A-Za-z0-9:_<>-]+)/g; // a command is in backticks; prose is not

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function isDated(path: string): boolean {
  return DATED_RECORDS.some((re) => re.test(path));
}

/** The repo path a link or backtick path means, with `./` and `..` resolved, or null when it leaves the repo. */
function repoPath(from: string, target: string): string | null {
  const joined = posix.normalize(posix.join(dirname(from).replace(/\\/g, "/"), target));
  if (joined.startsWith("..")) return null;
  return joined === "." ? "" : joined;
}

function pathIsFine(path: string, repo: DocsRepo): boolean {
  if (repo.exists(path) || repo.ignored(path)) return true;
  // `scripts/verify` for scripts/verify.ts, `scripts/clean-clone` for the .sh
  return repo.exists(`${path}.ts`) || repo.exists(`${path}.sh`);
}

/** Every stale reference in the given files, in file order. Empty when the docs match the repo. */
export function docProblems(files: DocFile[], repo: DocsRepo): DocProblem[] {
  const problems: DocProblem[] = [];
  for (const file of files) {
    const { path, text } = file;
    const seen = new Set<string>();
    const report = (kind: DocProblem["kind"], index: number, target: string) => {
      const key = `${kind}:${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      problems.push({ file: path, line: lineOf(text, index), kind, target });
    };

    for (const m of text.matchAll(LINK)) {
      const raw = m[1];
      if (/^(https?:|mailto:|#)/.test(raw)) continue;
      const target = decodeURI(raw.split("#")[0].split("?")[0]);
      if (!target) continue;
      const resolved = repoPath(path, target);
      if (resolved === null || !repo.exists(resolved)) report("link", m.index ?? 0, raw);
    }

    if (isDated(path)) continue;

    for (const m of text.matchAll(BACKTICK_PATH)) {
      const target = m[1];
      if (/[*<>{}]/.test(target)) continue; // a glob or a placeholder
      if (!repo.topLevel.has(target.split("/")[0])) continue; // not a repo path (a URL host, a model id)
      const clean = normalize(target)
        .replace(/\\/g, "/")
        .replace(/[.,:]+$/, "");
      if (!pathIsFine(clean, repo)) report("path", m.index ?? 0, target);
    }

    for (const m of text.matchAll(NPM_RUN)) {
      const name = m[1];
      if (/[<>]/.test(name)) continue; // `npm run <command>`
      if (!repo.scripts.has(name)) report("script", m.index ?? 0, `npm run ${name}`);
    }
  }
  return problems;
}

export function formatProblem(p: DocProblem): string {
  const what =
    p.kind === "link" ? "broken link" : p.kind === "path" ? "missing path" : "no such script";
  return `${p.file}:${p.line}: ${what} ${p.target}`;
}
