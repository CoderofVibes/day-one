// What must be true of the static folder before it goes on a public host (docs/HOSTING.md):
// it replays the recorded run and nothing else. No key, token or .env value in any file, no
// page marked as served by the API (that would make the page call /api), and the page itself.

/** Private-key and token shapes that must never appear in a published file. */
const SECRET_SHAPES: [string, RegExp][] = [
  ["a NEAR private key", /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/],
  ["a secp256k1 private key", /secp256k1:[1-9A-HJ-NP-Za-km-z]{60,}/],
  ["an Anthropic API key", /sk-ant-[\w-]{20,}/],
  ["an API key", /\bsk-[A-Za-z0-9]{32,}/],
  ["a private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];

export interface HostFile {
  path: string;
  text: string;
}

/**
 * Problems with a static build, in plain words; empty when it may be published. `secrets` are
 * the values from .env (and any other value that must not leak), checked verbatim.
 */
export function hostProblems(files: HostFile[], secrets: string[] = []): string[] {
  const problems: string[] = [];
  const index = files.find((f) => f.path === "index.html");
  if (!index) problems.push("index.html is missing: run npm run web:build.");
  else if (index.text.includes('name="day-one-api"')) {
    problems.push("index.html carries the API's marker; build it with npm run web:build instead.");
  }
  const values = secrets.filter((s) => s.length >= 12);
  for (const file of files) {
    for (const [what, shape] of SECRET_SHAPES) {
      if (shape.test(file.text)) problems.push(`${file.path} contains ${what}.`);
    }
    if (values.some((v) => file.text.includes(v))) {
      problems.push(`${file.path} contains a value from .env.`);
    }
  }
  return problems;
}

/** The values in a .env file's text (KEY=value lines), quotes removed. */
export function envValues(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^\s*[A-Za-z_][\w]*\s*=\s*(.*)$/.exec(line)?.[1]?.trim() ?? "")
    .map((v) => v.replace(/^(["'])(.*)\1$/, "$2"))
    .filter(Boolean);
}

/**
 * Cloudflare Pages' _headers file: keep the demo out of search results until the repo is
 * public, cache the hashed assets for good and the page itself never.
 */
export const HEADERS = `/*
  X-Robots-Tag: noindex
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/index.html
  Cache-Control: no-cache
`;
