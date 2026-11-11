// What must be true of the static folder before it goes on a public host (docs/HOSTING.md):
// it replays the recorded run and nothing else. No key, token or .env value in any file, no
// page marked as served by the API (that would make the page call /api), and the page itself.

/** Private-key and token shapes that must never appear in a published file. */
export const SECRET_SHAPES: [string, RegExp][] = [
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

/** One KEY=value line of a .env file. */
export interface EnvEntry {
  key: string;
  value: string;
}

/**
 * Problems with a static build, in plain words; empty when it may be published. `secrets` are
 * the .env entries that must not leak (see `envSecrets`), checked verbatim; a problem names the
 * key, never the value. A bare string is a value with no key.
 */
export function hostProblems(files: HostFile[], secrets: (string | EnvEntry)[] = []): string[] {
  const problems: string[] = [];
  const index = files.find((f) => f.path === "index.html");
  if (!index) problems.push("index.html is missing: run npm run web:build.");
  else if (index.text.includes('name="day-one-api"')) {
    problems.push("index.html carries the API's marker; build it with npm run web:build instead.");
  }
  const values = secrets
    .map((s) => (typeof s === "string" ? { key: "", value: s } : s))
    .filter((s) => s.value.length >= 12);
  for (const file of files) {
    for (const [what, shape] of SECRET_SHAPES) {
      if (shape.test(file.text)) problems.push(`${file.path} contains ${what}.`);
    }
    for (const { key, value } of values) {
      if (!file.text.includes(value)) continue;
      problems.push(
        key
          ? `${file.path} contains the value of ${key} from .env.`
          : `${file.path} contains a value from .env.`,
      );
    }
  }
  return problems;
}

/** The KEY=value lines of a .env file's text, quotes removed, empty values left out. */
export function envEntries(text: string): EnvEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ key: m[1], value: m[2].trim().replace(/^(["'])(.*)\1$/, "$2") }))
    .filter((e) => e.value !== "");
}

/** Keys whose name says the value is a credential, whatever .env.example carries. */
const SECRET_KEY = /KEY|SECRET|TOKEN|PASSWORD|PRIVATE/i;

/**
 * The .env entries that must not appear in a published file: every value under a key that
 * names a key, secret or token, and every other value that .env.example does not carry. The
 * example file is committed, so a value it holds (an account id, an RPC URL, a model id) is
 * public already; the replay's own pages name the contract and the explorer.
 */
export function envSecrets(envText: string, exampleText = ""): EnvEntry[] {
  const published = new Set(envEntries(exampleText).map((e) => e.value));
  return envEntries(envText).filter((e) => SECRET_KEY.test(e.key) || !published.has(e.value));
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

/**
 * The same headers for Vercel (Tony, Nov 11: Vercel hosts both projects), as the vercel.json a
 * static deployment of web/dist reads. No rewrites: every page is ?page= on index.html, so a
 * path that is not a file is a real 404.
 */
export const VERCEL_JSON = `${JSON.stringify(
  {
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/assets/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      { source: "/", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ],
  },
  null,
  2,
)}\n`;
