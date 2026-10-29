// npm run reset:testnet — empties the spend-policy contract and deletes its account, so that
// `npm run setup:testnet` and `npm run deploy:testnet` start it fresh (LESSONS, Oct 28). PO ids
// are single-use per contract and a state-layout change makes old state unreadable, so a
// re-record of the demo starts here.
//
// It deletes the recorded anchors with the account: `npm run verify` on the committed records
// gives NOT_ANCHORED until the demo is re-recorded. Run it only right before
// `npm run demo:live -- --record`.
//
//   (no flag)          show what would happen; sends nothing
//   --yes              do it: HQ cancels every PO not yet received (escrow back to the budget),
//                      withdraws the budget to the treasury, then the contract account deploys an
//                      empty wasm and deletes itself in one transaction (beneficiary: Acme)
//   --contract <id>    another spend-policy account under Acme (a throwaway one, for testing)
//   --json             print one JSON line at the end
//
// Stops before deleting anything if a PO is received but not yet decided by QC (only QC can
// close it) or if the contract still holds tokens after the withdrawal.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, actions, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { formatUsd } from "../server/src/money.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(readFileSync(join(repo, "config", "testnet-accounts.json"), "utf8")) as {
  network: string;
  root: string;
  spendPolicy: string;
};
const ROOT = config.root;

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const json = args.includes("--json");
const contractArg = args.indexOf("--contract");
const POLICY = contractArg >= 0 ? args[contractArg + 1] : config.spendPolicy;
if (!POLICY?.endsWith(`.${ROOT}`)) {
  throw new Error(`--contract must be an account under ${ROOT}`);
}

/** The smallest valid wasm module: magic number and version. */
const EMPTY_WASM = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const OPEN = new Set(["Funded", "Accepted", "Shipped"]);
const WITH_QC = new Set(["Received", "Paying"]);

const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
});
const nearCli =
  process.env.NEAR_CLI ??
  (existsSync(join(homedir(), ".cargo", "bin", "near.exe"))
    ? join(homedir(), ".cargo", "bin", "near.exe")
    : "near");

interface Po {
  po_id: string;
  amount: string;
  status: string;
}

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

/** A call signed by Acme's root key in the OS keychain, like deploy-testnet. */
function asAcme(method: string, callArgs: object) {
  execFileSync(
    nearCli,
    [
      "contract",
      "call-function",
      "as-transaction",
      POLICY,
      method,
      "json-args",
      JSON.stringify(callArgs),
      "prepaid-gas",
      "100.0 Tgas",
      "attached-deposit",
      "1 yoctoNEAR",
      "sign-as",
      ROOT,
      "network-config",
      config.network,
      "sign-with-keychain",
      "send",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

async function listPos() {
  const pos: Po[] = [];
  for (let from = 0; ; from += 100) {
    const page = await view<Po[]>(POLICY, "list_pos", { from, limit: 100 });
    pos.push(...page);
    if (page.length < 100) return pos;
  }
}

async function main() {
  const state = await provider.viewAccount({ accountId: POLICY }).catch((error) => {
    if (String(error).includes("does not exist")) return null;
    throw error;
  });
  if (!state) {
    console.log(`${POLICY} does not exist. Next: npm run setup:testnet, npm run deploy:testnet.`);
    if (json) console.log(JSON.stringify({ contract: POLICY, deleted: false, existed: false }));
    return;
  }

  const { owner, token } = await view<{ owner: string; token: string }>(POLICY, "get_config");
  if (owner !== ROOT) throw new Error(`${POLICY} is owned by ${owner}, not ${ROOT}`);

  const pos = await listPos();
  const open = pos.filter((p) => OPEN.has(p.status));
  const withQc = pos.filter((p) => WITH_QC.has(p.status));
  const before = await view<{ budget: string; escrowed: string }>(POLICY, "get_budget");
  const usd = (units: string | bigint) => formatUsd(BigInt(units));

  console.log(`${POLICY} on ${config.network}`);
  console.log(
    `Budget ${usd(before.budget)}, in escrow ${usd(before.escrowed)}, ${pos.length} POs, ` +
      `${open.length} to cancel.`,
  );
  if (withQc.length > 0) {
    const ids = withQc.map((p) => p.po_id).join(", ");
    throw new Error(`${ids} received and waiting on QC; release or reject first. Nothing sent.`);
  }
  if (!yes) {
    for (const p of open) console.log(`  would cancel ${p.po_id} (${usd(p.amount)})`);
    console.log(
      "  would withdraw the budget to the treasury, then delete the account " +
        `(NEAR to ${ROOT}). Its anchors go with it. Run with --yes to do it.`,
    );
    if (json) console.log(JSON.stringify({ contract: POLICY, deleted: false, dryRun: true }));
    return;
  }

  for (const p of open) {
    asAcme("cancel", { po_id: p.po_id });
    console.log(`cancelled ${p.po_id} (${usd(p.amount)} back to the budget)`);
  }
  const mid = await view<{ budget: string; escrowed: string }>(POLICY, "get_budget");
  if (BigInt(mid.escrowed) !== 0n) {
    throw new Error(`${usd(mid.escrowed)} still in escrow after cancelling. Nothing deleted.`);
  }
  if (BigInt(mid.budget) > 0n) {
    asAcme("withdraw_budget", { amount: mid.budget });
    console.log(`withdrew  ${usd(mid.budget)} to the treasury`);
  }
  const left = await view<string>(token, "ft_balance_of", { account_id: POLICY });
  if (BigInt(left) !== 0n) {
    throw new Error(`the contract still holds ${usd(left)} in ${token}. Nothing deleted.`);
  }

  const key = JSON.parse(
    readFileSync(join(repo, ".near-credentials", "testnet", `${POLICY}.json`), "utf8"),
  ) as { private_key: KeyPairString };
  const result = await new Account(POLICY, provider, key.private_key).signAndSendTransaction({
    receiverId: POLICY,
    actions: [actions.deployContract(EMPTY_WASM), actions.deleteAccount(ROOT)],
  });
  const tx = result.transaction_outcome.id;
  console.log(`deleted   ${POLICY} (tx ${tx}); its NEAR went to ${ROOT}`);
  console.log(
    "Next: npm run setup:testnet, npm run deploy:testnet, npm run demo:live -- --record.",
  );
  if (json) {
    console.log(
      JSON.stringify({
        contract: POLICY,
        deleted: true,
        cancelled: open.map((p) => p.po_id),
        withdrawn: mid.budget,
        tx,
      }),
    );
  }
}

await main();
