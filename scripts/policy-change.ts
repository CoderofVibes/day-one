// npm run policy -- "<request>" — HQ changes Kevin's limits in plain words. Kevin reads the
// policy the contract holds now (view calls, no keys) and drafts the one owner call that makes the
// change; nothing is sent unless the owner adds --yes.
//
//   (no flag)   print Kevin's reading, the changes and the call; sends nothing
//   --yes       sign the call as Acme (the contract owner) with the key in the OS keychain,
//               like deploy-testnet, then read the policy back
//   --json      print one JSON line at the end
//
// Kevin's own key cannot sign this: the contract takes `set_agent_policy`, `pause_agent` and
// `resume_agent` from its owner only.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { draftPolicyChange } from "../agents/kevin/src/policyChange.ts";
import { LiveTransport } from "../server/src/chain/live.ts";
import { formatPolicy, type PolicyView, readPolicy } from "../server/src/chain/policy.ts";
import { STAFF } from "../server/src/seed/reference.ts";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const json = args.includes("--json");
const request = args.filter((a) => !a.startsWith("--")).join(" ");
if (!request) {
  console.error(
    'Usage: npm run policy -- "raise Kevin\'s per-PO limit to $3,000" [--yes] [--json]',
  );
  process.exit(2);
}

const accounts = JSON.parse(
  readFileSync(fileURLToPath(new URL("../config/testnet-accounts.json", import.meta.url)), "utf8"),
) as { network: string; root: string; spendPolicy: string };
const ROOT = accounts.root;
const kevin = `kevin.plant-b.${ROOT}`;
const chain = new LiveTransport(accounts.network, () => {
  throw new Error("policy signs only through the owner's keychain");
});
const view = (method: string, viewArgs: Record<string, unknown> = {}) =>
  chain.view({ contractId: accounts.spendPolicy, method, args: viewArgs });
const nearCli =
  process.env.NEAR_CLI ??
  (existsSync(join(homedir(), ".cargo", "bin", "near.exe"))
    ? join(homedir(), ".cargo", "bin", "near.exe")
    : "near");

const read = () =>
  readPolicy(view, {
    contract: accounts.spendPolicy,
    network: accounts.network,
    agent: kevin,
    plant: `plant-b.${ROOT}`,
    categories: ["raw_material", "packaging", "lab_chemical"],
    suppliers: [],
  });

/** Signs `method` as Acme with the keychain key; returns the transaction id near-cli reports. */
function asOwner(method: string, callArgs: object): string | null {
  const run = spawnSync(
    nearCli,
    [
      "contract",
      "call-function",
      "as-transaction",
      accounts.spendPolicy,
      method,
      "json-args",
      JSON.stringify(callArgs),
      "prepaid-gas",
      "30.0 Tgas",
      "attached-deposit",
      "1 yoctoNEAR",
      "sign-as",
      ROOT,
      "network-config",
      accounts.network,
      "sign-with-keychain",
      "send",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // near-cli reports progress and the transaction id on stderr.
  const out = `${run.stdout}\n${run.stderr}`;
  if (run.status !== 0) throw new Error(`near-cli failed:\n${out}`);
  return /Transaction ID:\s*([1-9A-HJ-NP-Za-km-z]{43,44})/.exec(out)?.[1] ?? null;
}

const before = await read();
if (!before.agent) throw new Error(`${accounts.spendPolicy} holds no policy for ${kevin}`);
const approver = STAFF.find((s) => "account" in s && s.account === before.agent?.approver);
const draft = draftPolicyChange(request, before.agent, approver?.name);

const lines = [`Kevin: ${draft.sentence}`];
for (const c of draft.changes) lines.push(`  ${c.field}: ${c.from} -> ${c.to}`);
if (draft.call) {
  lines.push(
    `  owner call: ${draft.call.method} on ${accounts.spendPolicy}, signed by ${ROOT}`,
    `  ${JSON.stringify(draft.call.args)}`,
  );
}

let tx: string | null = null;
let after: PolicyView | null = null;
if (draft.call && yes) {
  tx = asOwner(draft.call.method, draft.call.args);
  after = await read();
  lines.push(
    `Signed by ${ROOT}${tx ? `: https://testnet.nearblocks.io/txns/${tx}` : ""}.`,
    ...formatPolicy(after).slice(0, 2),
  );
} else if (draft.call) {
  lines.push("Nothing sent. The owner adds --yes to sign it.");
}
console.log(lines.join("\n"));
if (json) {
  console.log(
    JSON.stringify({
      ...draft,
      contract: accounts.spendPolicy,
      signedBy: tx || after ? ROOT : null,
      tx,
      before: before.agent,
      after: after?.agent ?? null,
    }),
  );
}
if (!draft.understood) process.exitCode = 1;
