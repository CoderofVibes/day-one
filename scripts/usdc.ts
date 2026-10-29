// npm run usdc — PO-1047 settled in real Circle testnet USDC (DEMO_SCRIPT step 13). The same
// spend-policy wasm as the main deployment runs at spend-policy-usdc.acme-holdings.testnet with
// Circle's USDC as its token (CONTRACTS.md §2), so the escrow, limits and payout are shown to
// work with a native stablecoin, not only with our DTUSD.
//   npm run usdc                     replay data/usdc/ with no keys and check the transcript
//   npm run usdc -- --setup          create, deploy and configure the USDC deployment (keychain
//                                    + .near-credentials; idempotent), fund it with the order total
//   npm run usdc -- --live [--record]   run PO-1047 on testnet; --record rewrites data/usdc/
//   --json                           one JSON line after the readable text

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  Account,
  actions,
  baseEncode,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  nearToYocto,
  teraToGas,
} from "near-api-js";
import {
  orderTotal,
  po1047,
  runUsdcOrder,
  type UsdcOrderSpec,
} from "../agents/kevin/src/usdcOrder.ts";
import { ChainClient, type ChainTransport } from "../server/src/chain/client.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { RecordingTransport, ReplayTransport } from "../server/src/chain/replay.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { plantBStaff } from "../server/src/relayer/relayer.ts";
import { directorOf, kevinOf, PLANT_AGENTS } from "./lib/dayone-sandbox.ts";

const repo = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const ROOT = "acme-holdings.testnet";
const MAIN_POLICY = `spend-policy.${ROOT}`;
const RELAYER = "dayone-relayer.testnet";
const DOLLAR = 1_000_000n;
const FIXTURE = join(repo, "data", "usdc", "PO-1047-chain.json");
const TRANSCRIPT = join(repo, "data", "usdc", "transcript.txt");
const credentialsDir = join(repo, ".near-credentials", "testnet");
const spec = po1047(ROOT);

const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
});
const nearCli =
  process.env.NEAR_CLI ??
  (existsSync(join(homedir(), ".cargo", "bin", "near.exe"))
    ? join(homedir(), ".cargo", "bin", "near.exe")
    : "near");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

interface StoredKey {
  account_id: string;
  public_key: string;
  private_key: KeyPairString;
}

/** The stored key in `<account><suffix>.json`, or a new one written before any transaction. */
function keyFor(accountId: string, suffix = ""): StoredKey {
  const file = join(credentialsDir, `${accountId}${suffix}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as StoredKey;
  const pair = KeyPair.fromRandom("ed25519");
  const stored = {
    account_id: accountId,
    public_key: pair.getPublicKey().toString(),
    private_key: pair.toString(),
  };
  mkdirSync(credentialsDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return stored;
}

/**
 * Plant B's people sign for the USDC deployment with a second function-call key that reaches
 * only it (`<account>.usdc.fc.json`); everyone else (the relayer, Bayfront) with their own key.
 */
function usdcKeys(accountId: string): KeyPairString {
  for (const name of [`${accountId}.usdc.fc.json`, `${accountId}.json`]) {
    const file = join(credentialsDir, name);
    if (existsSync(file)) {
      return (JSON.parse(readFileSync(file, "utf8")) as StoredKey).private_key;
    }
  }
  throw new Error(`no key for ${accountId} in ${credentialsDir}`);
}

const view = <T>(contractId: string, method: string, a: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args: a }) as Promise<T>;

async function exists(accountId: string) {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch (error) {
    if (String(error).includes("does not exist")) return false;
    throw error;
  }
}

function cli(cliArgs: string[]) {
  execFileSync(nearCli, cliArgs, { stdio: ["ignore", "ignore", "pipe"] });
}

/** A call signed by Acme's root key in the OS keychain. */
function asAcme(contractId: string, method: string, a: object, deposit: string) {
  cli([
    "contract",
    "call-function",
    "as-transaction",
    contractId,
    method,
    "json-args",
    JSON.stringify(a),
    "prepaid-gas",
    "100.0 Tgas",
    "attached-deposit",
    deposit,
    "sign-as",
    ROOT,
    "network-config",
    "testnet",
    "sign-with-keychain",
    "send",
  ]);
  console.log(`called    ${contractId === spec.token ? "USDC" : contractId}.${method}`);
}

/** The code the main deployment runs, so the USDC deployment is byte for byte the same wasm. */
async function mainCode() {
  const res = await fetch(process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "usdc",
      method: "query",
      params: { request_type: "view_code", finality: "final", account_id: MAIN_POLICY },
    }),
  });
  const body = (await res.json()) as { result?: { code_base64: string; hash: string } };
  if (!body.result) fail(`Could not read ${MAIN_POLICY}'s code: ${JSON.stringify(body)}`);
  const code = Buffer.from(body.result.code_base64, "base64");
  if (baseEncode(createHash("sha256").update(code).digest()) !== body.result.hash) {
    fail(`${MAIN_POLICY}'s code does not match its hash.`);
  }
  return { code, hash: body.result.hash };
}

/** Adds the account's USDC-scoped function-call key unless it is already on chain. */
async function ensureUsdcKey(accountId: string, methods: string[], allowance: string) {
  const fc = keyFor(accountId, ".usdc.fc");
  const { keys } = await new Account(accountId, provider).getAccessKeyList();
  if (keys.some((k) => k.public_key === fc.public_key)) {
    console.log(`has key   ${accountId} → ${spec.policy}`);
    return;
  }
  // Staff accounts hold no NEAR (the relayer pays their calls); one add-key needs a little.
  const { balance } = await new Account(accountId, provider).getState();
  if (balance.available < nearToYocto(0.02)) {
    cli([
      "tokens",
      ROOT,
      "send-near",
      accountId,
      "0.05 NEAR",
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ]);
    console.log(`topped up ${accountId} with 0.05 NEAR`);
  }
  const self = new Account(accountId, provider, keyFor(accountId).private_key);
  await self.signAndSendTransaction({
    receiverId: accountId,
    actions: [
      actions.addFunctionCallAccessKey(
        KeyPair.fromString(fc.private_key).getPublicKey(),
        spec.policy,
        methods,
        nearToYocto(allowance),
      ),
    ],
  });
  console.log(`added key ${accountId} → ${spec.policy} (${methods.join(", ")})`);
}

async function setup() {
  const policy = spec.policy;
  const key = keyFor(policy);
  if (await exists(policy)) {
    console.log(`exists    ${policy}`);
  } else {
    // About 415 KB of code; storage costs 1 NEAR per 100 KB (CONTRACTS.md §8).
    cli([
      "account",
      "create-account",
      "fund-myself",
      policy,
      "5 NEAR",
      "use-manually-provided-public-key",
      key.public_key,
      "sign-as",
      ROOT,
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ]);
    console.log(`created   ${policy} (5 NEAR)`);
  }

  const { code, hash } = await mainCode();
  const state = await provider.viewAccount({ accountId: policy });
  if (state.code_hash === hash) {
    console.log(`unchanged ${policy} (${hash}, the code ${MAIN_POLICY} runs)`);
  } else {
    const first = state.code_hash === "11111111111111111111111111111111";
    await new Account(policy, provider, key.private_key).signAndSendTransaction({
      receiverId: policy,
      actions: [
        actions.deployContract(code),
        ...(first
          ? [
              actions.functionCall(
                "new",
                { owner: ROOT, treasury: ROOT, token: spec.token },
                teraToGas("30"),
                0n,
              ),
            ]
          : []),
      ],
    });
    console.log(
      `deployed  ${policy} (${code.length} bytes, ${hash})${first ? ", initialized" : ""}`,
    );
  }

  const bounds = await view<{ min: string }>(spec.token, "storage_balance_bounds");
  const deposit = `${Number(BigInt(bounds.min) / 10n ** 18n) / 1_000_000} NEAR`;
  for (const holder of [policy, spec.supplier]) {
    if ((await view(spec.token, "storage_balance_of", { account_id: holder })) === null) {
      asAcme(spec.token, "storage_deposit", { account_id: holder }, deposit);
    }
  }

  // Plant B's slice of CONTRACTS.md §8: its roles, Kevin's policy, the lab-chemical cap and
  // Bayfront's credential. Each call only when the chain differs.
  const oneYocto = "1 yoctoNEAR";
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const plant = `plant-b.${ROOT}`;
  const roles = { receiver: spec.receiving, qc: spec.qc };
  if (!same(await view(policy, "get_roles", { plant }), roles)) {
    asAcme(policy, "set_roles", { plant, ...roles }, oneYocto);
  }
  const b = PLANT_AGENTS.find((p) => p.code === "b");
  if (!b) fail("Plant B has no agent in PLANT_AGENTS");
  const agentPolicy = {
    name: b.name,
    plant,
    per_po_limit: (BigInt(b.perPoUsd) * DOLLAR).toString(),
    monthly_limit: (BigInt(b.monthlyUsd) * DOLLAR).toString(),
    categories: b.categories,
    approver: directorOf("b", ROOT),
  };
  const kevin = kevinOf("b", ROOT);
  if (
    !same(await view(policy, "get_agent_policy", { agent: kevin }), {
      ...agentPolicy,
      active: true,
    })
  ) {
    asAcme(policy, "set_agent_policy", { agent: kevin, ...agentPolicy }, oneYocto);
  }
  const labCap = (2_000n * DOLLAR).toString();
  if ((await view(policy, "get_category_cap", { category: spec.category })) !== labCap) {
    asAcme(policy, "set_category_cap", { category: spec.category, monthly_cap: labCap }, oneYocto);
  }
  if ((await view(policy, "get_supplier", { supplier: spec.supplier })) !== "Qualified") {
    asAcme(
      policy,
      "issue_credential",
      {
        supplier: spec.supplier,
        status: "Qualified",
        categories: [spec.category],
        expires_at: (BigInt(Date.UTC(2027, 9, 31)) * 1_000_000n).toString(),
      },
      oneYocto,
    );
  }

  await ensureUsdcKey(spec.kevin, ["submit_po"], "0.25");
  await ensureUsdcKey(spec.receiving, ["confirm_receipt"], "0.05");
  await ensureUsdcKey(spec.qc, ["qc_release", "qc_reject"], "0.05");

  // Fund exactly the order: real testnet USDC comes 20 at a time from Circle's faucet.
  const total = orderTotal(spec);
  const budget = await view<{ budget: string; escrowed: string }>(policy, "get_budget");
  const placed = (await view(policy, "get_po", { po_id: spec.poId })) !== null;
  if (BigInt(budget.budget) < total && !placed) {
    const have = BigInt(await view<string>(spec.token, "ft_balance_of", { account_id: ROOT }));
    const need = total - BigInt(budget.budget);
    if (have < need) fail(`${ROOT} holds ${have} USDC units; the budget needs ${need} more.`);
    asAcme(
      spec.token,
      "ft_transfer_call",
      { receiver_id: policy, amount: need.toString(), msg: "" },
      oneYocto,
    );
  }
  const after = await view<{ budget: string; escrowed: string }>(policy, "get_budget");
  const balance = await view<string>(spec.token, "ft_balance_of", { account_id: policy });
  console.log(
    `budget ${Number(after.budget) / 1e6} USDC, escrowed ${Number(after.escrowed) / 1e6}, ` +
      `contract balance ${Number(balance) / 1e6} USDC`,
  );
  if (BigInt(balance) !== BigInt(after.budget) + BigInt(after.escrowed)) {
    fail("token balance does not equal budget + escrowed");
  }
}

async function run(transport: ChainTransport, s: UsdcOrderSpec) {
  const chain = new ChainClient(openLedger(":memory:"), transport, () => new Date().toISOString());
  return runUsdcOrder(chain, s);
}

if (args.includes("--setup")) {
  await setup();
} else if (args.includes("--live")) {
  if (!existsSync(join(credentialsDir, `${RELAYER}.json`))) {
    fail(`The relayer's server key is missing (.near-credentials/testnet/${RELAYER}.json).`);
  }
  if ((await view(spec.policy, "get_po", { po_id: spec.poId })) !== null) {
    fail(`${spec.poId} is already on ${spec.policy}; it can be placed once per contract.`);
  }
  const live = new LiveTransport("testnet", usdcKeys, undefined, {
    relayerId: RELAYER,
    policyContract: spec.policy,
    staffMethods: plantBStaff(ROOT),
  });
  const recording = new RecordingTransport(live);
  const result = await run(recording, spec);
  const transcript = [result.staffLine, ...result.chainLines].join("\n");
  console.log(transcript);
  if (args.includes("--record")) {
    if (result.ok) {
      recording.save(FIXTURE);
      writeFileSync(TRANSCRIPT, `${transcript}\n`);
      console.log(`Wrote ${FIXTURE} and ${TRANSCRIPT}`);
    } else {
      console.log("Not saved: the order did not settle.");
    }
  }
  if (json) console.log(JSON.stringify({ mode: "live", ...result }));
  process.exitCode = result.ok ? 0 : 1;
} else {
  const replay = ReplayTransport.fromFile(FIXTURE);
  const result = await run(replay, spec);
  replay.assertDone();
  const transcript = [result.staffLine, ...result.chainLines].join("\n");
  console.log(transcript);
  const matches = readFileSync(TRANSCRIPT, "utf8").trimEnd() === transcript;
  console.log(
    matches
      ? "Transcript matches data/usdc/transcript.txt."
      : "Transcript DIFFERS from data/usdc/transcript.txt.",
  );
  if (json) console.log(JSON.stringify({ mode: "replay", matches, ...result }));
  process.exitCode = result.ok && matches ? 0 : 1;
}
