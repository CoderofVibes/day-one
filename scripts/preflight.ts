// npm run preflight — before a live run (npm run demo:live, npm run api:live), checks what the
// run will need and says in plain words what to fix: the NEAR AI Cloud key, the testnet RPC,
// every signer's key on this computer and on testnet, the NEAR that pays gas, the demo's PO
// ids, the plant budget, Kevin's policy and the contract's verdict on each supplier. Reads only:
// no key signs anything. The signers, methods, PO ids and amounts come from the recorded run
// (data/replay/demo-chain.json), so the check follows the run.
//   --offline   no network: only the files on this computer
//   --json      one JSON line after the readable text
// Exit 1 when something blocks a live run.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import { DEMO_POS, RELAYER } from "../api/src/env.ts";
import { resilientProvider, rpcUrls } from "../server/src/chain/rpc.ts";
import { assess, type Facts, formatFindings, type Signer } from "./lib/preflight.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const json = args.includes("--json");
const envFile = join(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const accounts = JSON.parse(readFileSync(join(root, "config/testnet-accounts.json"), "utf8")) as {
  network: string;
  root: string;
  spendPolicy: string;
};
const credentials = join(root, ".near-credentials", accounts.network);

interface Call {
  type: string;
  request: {
    method: string;
    signerId: string;
    viaRelayer?: boolean;
    args: Record<string, unknown>;
  };
}
const fixture = JSON.parse(readFileSync(join(root, "data/replay/demo-chain.json"), "utf8")) as {
  entries: Call[];
};
const calls = fixture.entries.filter((e) => e.type === "call").map((e) => e.request);
const bySigner = new Map<string, Signer>();
for (const c of calls) {
  const s = bySigner.get(c.signerId) ?? { account: c.signerId, methods: [], relayed: false };
  if (!s.methods.includes(c.method)) s.methods.push(c.method);
  s.relayed ||= Boolean(c.viaRelayer);
  bySigner.set(c.signerId, s);
}
const signers = [...bySigner.values()];
const orders = new Map<string, { supplier: string; amount: bigint }>();
for (const c of calls.filter((c) => c.method === "submit_po")) {
  orders.set(String(c.args.po_id), {
    supplier: String(c.args.supplier),
    amount: BigInt(String(c.args.amount)),
  });
}
const kevin = `kevin.plant-b.${accounts.root}`;

/** The key file the live transport would use (server/src/chain/live.ts credentialsKeys). */
function keyFile(account: string) {
  for (const name of [`${account}.fc.json`, `${account}.json`]) {
    if (existsSync(join(credentials, name))) return name;
  }
  return null;
}

const facts: Facts = {
  network: accounts.network,
  contract: accounts.spendPolicy,
  relayer: RELAYER,
  envFile: existsSync(envFile),
  nearAiKey: Boolean(process.env.NEARAI_API_KEY),
  nearAi: null,
  rpc: [],
  signers,
  keys: {},
  balances: {},
  pos: DEMO_POS.map((po) => ({ po, onChain: null })),
  budget: null,
  kevin: { account: kevin, active: null, present: true },
  suppliers: [...new Set([...orders.values()].map((o) => o.supplier))].map((account) => ({
    account,
    standing: null,
    mayBePaid: null,
  })),
};
for (const account of [...signers.map((s) => s.account), RELAYER]) {
  facts.keys[account] = { file: keyFile(account), onChain: "unread" };
}

const timed = <T>(work: Promise<T>, ms: number) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`no answer in ${ms / 1000} s`)), ms),
    ),
  ]);
const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

if (!offline) {
  // NEAR AI Cloud: the attestation report is free and needs the key, so it proves both.
  if (facts.nearAiKey) {
    const base = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
    const model = (process.env.LLM_ROUTE_VISION ?? "nearai:z-ai/glm-5.3-flash").replace(
      /^nearai:/,
      "",
    );
    const query = new URLSearchParams({
      model,
      nonce: randomBytes(32).toString("hex"),
      signing_algo: "ecdsa",
    });
    try {
      const res = await timed(
        fetch(`${base}/attestation/report?${query}`, {
          headers: {
            authorization: `Bearer ${process.env.NEARAI_API_KEY}`,
            accept: "application/json",
          },
        }),
        20_000,
      );
      facts.nearAi = res.ok
        ? { ok: true, detail: `answered for ${model} (key accepted)` }
        : { ok: false, detail: `answered ${res.status} for ${model}` };
    } catch (e) {
      facts.nearAi = { ok: false, detail: `did not answer: ${why(e)}` };
    }
  }

  for (const url of rpcUrls(accounts.network, undefined)) {
    const started = Date.now();
    try {
      await timed(
        new JsonRpcProvider({ url }, { retries: 1, wait: 200, backoff: 1 }).viewNodeStatus(),
        8_000,
      );
      facts.rpc.push({ url, ok: true, ms: Date.now() - started });
    } catch (e) {
      facts.rpc.push({ url, ok: false, error: why(e) });
    }
  }

  if (facts.rpc.some((r) => r.ok)) {
    const rpc = resilientProvider(rpcUrls(accounts.network, undefined));
    const view = (method: string, a: Record<string, unknown> = {}) =>
      rpc.callFunction({ contractId: accounts.spendPolicy, method, args: a });

    for (const [account, key] of Object.entries(facts.keys)) {
      if (!key.file) continue;
      try {
        const secret = (
          JSON.parse(readFileSync(join(credentials, key.file), "utf8")) as {
            private_key: KeyPairString;
          }
        ).private_key;
        const publicKey = KeyPair.fromString(secret).getPublicKey().toString();
        const access = await rpc.viewAccessKey({ accountId: account, publicKey });
        const p = access.permission;
        key.onChain =
          p === "FullAccess" || !p.FunctionCall.method_names.length
            ? "full"
            : p.FunctionCall.method_names;
      } catch (e) {
        key.onChain = /does not exist|not found|AccessKeyDoesNotExist|UNKNOWN_ACCESS_KEY/i.test(
          why(e),
        )
          ? null
          : "unread";
      }
    }
    for (const account of [RELAYER, ...signers.filter((s) => !s.relayed).map((s) => s.account)]) {
      try {
        const { amount } = await rpc.viewAccount({ accountId: account });
        facts.balances[account] = Number(BigInt(amount) / 10n ** 20n) / 10_000;
      } catch {
        facts.balances[account] = null;
      }
    }
    for (const p of facts.pos) p.onChain = (await view("get_po", { po_id: p.po })) != null;
    const budget = (await view("get_budget")) as { budget: string };
    facts.budget = {
      budget: BigInt(budget.budget),
      needed: [...orders.values()].reduce((sum, o) => sum + o.amount, 0n),
    };
    const policy = (await view("get_agent_policy", { agent: kevin })) as { active: boolean } | null;
    facts.kevin = { account: kevin, present: Boolean(policy), active: policy?.active ?? null };
    for (const s of facts.suppliers) {
      const standing = (await view("get_supplier_standing", { supplier: s.account })) as {
        standing: string;
        may_be_paid: boolean;
      };
      s.standing = standing.standing;
      s.mayBePaid = standing.may_be_paid;
    }
  }
}

const findings = assess(facts);
console.log(
  `Preflight for a live run on ${accounts.network} (${accounts.spendPolicy})${offline ? ", offline" : ""}\n`,
);
process.stdout.write(formatFindings(findings));
const ready = !findings.some((f) => f.level === "block");
if (json) console.log(JSON.stringify({ ready, findings }));
process.exitCode = ready ? 0 : 1;
