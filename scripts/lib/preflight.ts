// What npm run preflight concludes from what it read (scripts/preflight.ts gathers the facts):
// one line per check, in plain words, with what to fix. It reads the contract's own answers
// (a PO id it has seen, its budget, its verdict on a supplier) and never re-applies a contract
// rule: the limits and approvals are still decided on chain when the run sends.

export type Level = "ok" | "warn" | "block";

export interface Finding {
  level: Level;
  check: string;
  detail: string;
  fix?: string;
}

/** One signer of the recorded run: what it calls and whether the relayer pays for it. */
export interface Signer {
  account: string;
  methods: string[];
  relayed: boolean;
}

export interface Facts {
  network: string;
  contract: string;
  relayer: string;
  envFile: boolean;
  nearAiKey: boolean;
  /** null when not tried (--offline). */
  nearAi: { ok: boolean; detail: string } | null;
  rpc: { url: string; ok: boolean; ms?: number; error?: string }[];
  signers: Signer[];
  /** Per account: the key file found on this computer, and what testnet says about that key. */
  keys: Record<
    string,
    {
      file: string | null;
      /** "full" or the methods a function-call key allows; null when testnet has no such key. */
      onChain: "full" | string[] | null | "unread";
    }
  >;
  /** NEAR in each account that pays gas (signers who are not relayed, and the relayer). */
  balances: Record<string, number | null>;
  /** Each demo PO id, and whether the contract already has it (null: not read). */
  pos: { po: string; onChain: boolean | null }[];
  /** Budget and what the run's POs fund, in base units (6 decimals); null when not read. */
  budget: { budget: bigint; needed: bigint } | null;
  kevin: { account: string; active: boolean | null; present: boolean };
  /** The contract's verdict on each supplier the run pays. */
  suppliers: { account: string; standing: string | null; mayBePaid: boolean | null }[];
}

const RELAYER_MIN = 0.2;
const RELAYER_LOW = 1;
const SIGNER_MIN = 0.05;
const SIGNER_LOW = 0.3;

const near = (n: number) => `${n.toFixed(2)} NEAR`;
const usd = (units: bigint) =>
  `$${(Number(units) / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export function assess(f: Facts): Finding[] {
  const out: Finding[] = [];
  const add = (level: Level, check: string, detail: string, fix?: string) =>
    out.push(fix ? { level, check, detail, fix } : { level, check, detail });

  // The model service.
  if (!f.envFile) {
    add("block", ".env", "no .env file", "Copy .env.example to .env and fill in NEARAI_API_KEY.");
  } else if (!f.nearAiKey) {
    add(
      "block",
      "NEAR AI Cloud key",
      "NEARAI_API_KEY is empty in .env",
      "Add the key from cloud.near.ai.",
    );
  } else if (f.nearAi && !f.nearAi.ok) {
    add(
      "block",
      "NEAR AI Cloud",
      f.nearAi.detail,
      "Check the key and its credit at cloud.near.ai; the run cannot read the batch record without it.",
    );
  } else {
    add("ok", "NEAR AI Cloud", f.nearAi ? f.nearAi.detail : "key present (not tried: --offline)");
  }

  // The network.
  const up = f.rpc.filter((r) => r.ok);
  for (const r of f.rpc) {
    add(
      r.ok ? "ok" : up.length ? "warn" : "block",
      `RPC ${r.url}`,
      r.ok ? `answered in ${r.ms ?? "?"} ms` : `no answer (${r.error ?? "unknown"})`,
      r.ok
        ? undefined
        : up.length
          ? "The run falls back to the endpoint that answers; nothing to do."
          : "Check the internet connection, or set NEAR_RPC_URL in .env to another testnet RPC.",
    );
  }
  const chainRead = up.length > 0;

  // Keys on this computer and on testnet.
  const noFile = [...f.signers.map((s) => s.account), f.relayer].filter((a) => !f.keys[a]?.file);
  if (noFile.length) {
    add(
      "block",
      "keys on this computer",
      `none in .near-credentials/${f.network}/ for ${noFile.join(", ")}`,
      noFile.length > f.signers.length / 2
        ? "Start the run from the folder that holds .near-credentials (the main checkout, not a git worktree), or run npm run setup:testnet there."
        : "Run npm run setup:testnet (it writes the server's keys; the relayer's needs Tony's keychain once, OPEN_QUESTIONS #31).",
    );
  }
  for (const s of f.signers) {
    const k = f.keys[s.account];
    if (!k?.file || k.onChain === "unread" || !chainRead) continue;
    if (k.onChain === null) {
      add(
        "block",
        `key for ${s.account}`,
        `${k.file} is not a key of that account on ${f.network}`,
        "Run npm run setup:testnet: it adds the key again.",
      );
    } else if (k.onChain !== "full") {
      const allowed = k.onChain;
      const missing = s.methods.filter((m) => !allowed.includes(m));
      if (missing.length) {
        add(
          "block",
          `key for ${s.account}`,
          `may not call ${missing.join(", ")}`,
          "Run npm run setup:testnet: it replaces a function-call key whose methods differ.",
        );
      } else add("ok", `key for ${s.account}`, `${k.file}, may call ${s.methods.join(", ")}`);
    } else add("ok", `key for ${s.account}`, `${k.file} (full access)`);
  }
  // Gas money.
  const payers = [f.relayer, ...f.signers.filter((s) => !s.relayed).map((s) => s.account)];
  for (const account of payers) {
    const balance = f.balances[account];
    if (balance === undefined || balance === null) continue;
    const isRelayer = account === f.relayer;
    const [min, low] = isRelayer ? [RELAYER_MIN, RELAYER_LOW] : [SIGNER_MIN, SIGNER_LOW];
    const who = isRelayer ? `${account} (pays the staff's gas)` : account;
    if (balance < min) {
      add(
        "block",
        `NEAR in ${who}`,
        near(balance),
        `Top it up from the testnet faucet (send at least ${near(low)}).`,
      );
    } else if (balance < low) {
      add(
        "warn",
        `NEAR in ${who}`,
        `${near(balance)}, low`,
        "Top it up from the testnet faucet before a long session.",
      );
    } else add("ok", `NEAR in ${who}`, near(balance));
  }

  // The contract's state.
  for (const p of f.pos) {
    if (p.onChain === null) continue;
    if (p.onChain) {
      add(
        "block",
        p.po,
        `already on ${f.contract}; a PO id is accepted once`,
        "Reset the contract before a live run: npm run reset:testnet (dry run), then -- --yes, setup:testnet and deploy:testnet (DEMO_SCRIPT §4). npm run demo replays the recorded run meanwhile.",
      );
    } else add("ok", p.po, "unused on the contract");
  }
  if (f.budget) {
    if (f.budget.budget < f.budget.needed) {
      add(
        "block",
        "plant budget",
        `${usd(f.budget.budget)} unallocated, the run funds ${usd(f.budget.needed)}`,
        "npm run deploy:testnet funds the budget when it is empty; otherwise HQ adds to it.",
      );
    } else {
      add(
        "ok",
        "plant budget",
        `${usd(f.budget.budget)} unallocated, the run funds ${usd(f.budget.needed)}`,
      );
    }
  }
  if (chainRead) {
    if (!f.kevin.present) {
      add(
        "block",
        "Kevin's policy",
        `no spend policy for ${f.kevin.account}`,
        "Run npm run deploy:testnet.",
      );
    } else if (f.kevin.active === false) {
      add(
        "block",
        "Kevin's policy",
        "Kevin is paused by HQ",
        'HQ resumes him: npm run policy -- "resume Kevin" --yes.',
      );
    } else if (f.kevin.active) add("ok", "Kevin's policy", "active");
  }
  for (const s of f.suppliers) {
    if (s.mayBePaid === null) continue;
    if (s.mayBePaid)
      add("ok", `supplier ${s.account}`, `${s.standing ?? "?"}: the contract may pay it`);
    else {
      add(
        "block",
        `supplier ${s.account}`,
        `${s.standing ?? "?"}: the contract will not pay it`,
        /suspend/i.test(s.standing ?? "")
          ? "Rehearsals reject a delivery each time; HQ reinstates the supplier (npm run rehearse prints the command)."
          : "HQ renews its credential with npm run deploy:testnet.",
      );
    }
  }
  return out;
}

/** The report as plain lines, blockers first in the summary. */
export function formatFindings(findings: Finding[]): string {
  const mark: Record<Level, string> = { ok: "✓", warn: "!", block: "✗" };
  const lines = findings.map(
    (f) => `${mark[f.level]} ${f.check}: ${f.detail}${f.fix ? `\n    → ${f.fix}` : ""}`,
  );
  const blocks = findings.filter((f) => f.level === "block").length;
  const warns = findings.filter((f) => f.level === "warn").length;
  lines.push(
    "",
    blocks
      ? `Not ready for a live run: ${blocks} thing${blocks === 1 ? "" : "s"} to fix first (✗ above).`
      : `Ready for a live run${warns ? ` (${warns} warning${warns === 1 ? "" : "s"})` : ""}.`,
  );
  return `${lines.join("\n")}\n`;
}
