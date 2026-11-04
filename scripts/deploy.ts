// npm run deploy:testnet: builds both contracts in WSL, deploys DTUSD and spend-policy to the
// accounts made by setup-testnet, applies the CONTRACTS.md §8 configuration and funds the
// plant budget. Safe to re-run: unchanged code is not redeployed, contracts are initialized
// once, configuration calls overwrite with the same values, and the budget is funded only
// when it is empty.
//
// Contract accounts sign with their own keys from .near-credentials/testnet/. Acme's calls
// (owner configuration, storage deposits, treasury funding) go through near-cli-rs with the
// OS keychain, like setup-testnet.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  actions,
  baseEncode,
  JsonRpcProvider,
  type KeyPairString,
  teraToGas,
} from "near-api-js";
import { directorOf, kevinOf, PLANT_AGENTS } from "./lib/dayone-sandbox.ts";

const repo = fileURLToPath(new URL("../", import.meta.url));
const ROOT = "acme-holdings.testnet";
const TOKEN = `dtusd.${ROOT}`;
const POLICY = `spend-policy.${ROOT}`;
const PLANT_B = `plant-b.${ROOT}`;
const DOLLAR = 1_000_000n;
/** DTUSD minted to the treasury at init, and the plant budget funded from it. */
const SUPPLY = 1_000_000n * DOLLAR;
const BUDGET = 25_000n * DOLLAR;
/** The supplier credentials HQ issues (CONTRACTS.md §8): the agents' §5 materials as categories. */
const SUPPLIER_CREDENTIALS = [
  { supplier: "northgate-ingredients.testnet", categories: ["raw_material"] },
  { supplier: "ridgeway-ascorbics.testnet", categories: ["raw_material"] },
  { supplier: "bayfront-labsupply.testnet", categories: ["lab_chemical"] },
] as const;
/** 2027-10-31T00:00:00Z in nanoseconds: one year of approval, renewed by re-running deploy. */
/** Plant B's POs above this many dollars carry Kevin's enclave-signed decision (§11 F). */
const SIGNED_ABOVE_USD = 2_500;

/** The enclave signing address the recorded attestation verified (every answer's signer). */
function enclaveSigner(): string {
  const att = JSON.parse(readFileSync(join(repo, "data/replay/attestation.json"), "utf8")) as {
    signatures: Record<string, { signing_address: string }>;
  };
  const signers = [
    ...new Set(Object.values(att.signatures).map((s) => s.signing_address.toLowerCase())),
  ];
  if (signers.length !== 1)
    throw new Error(`expected one enclave signer, found ${signers.join(", ")}`);
  return signers[0] as string;
}

const CREDENTIAL_EXPIRY = (BigInt(Date.UTC(2027, 9, 31)) * 1_000_000n).toString();
/** NEP-145 storage deposit per token holder (CONTRACTS.md §2). */
const STORAGE_DEPOSIT = "0.00125 NEAR";

const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
});
const nearCli =
  process.env.NEAR_CLI ??
  (existsSync(join(homedir(), ".cargo", "bin", "near.exe"))
    ? join(homedir(), ".cargo", "bin", "near.exe")
    : "near");

function signer(accountId: string) {
  const file = join(repo, ".near-credentials", "testnet", `${accountId}.json`);
  const { private_key } = JSON.parse(readFileSync(file, "utf8")) as { private_key: KeyPairString };
  return new Account(accountId, provider, private_key);
}

/** Builds a contract crate in WSL into contracts/target/near/ and returns the wasm bytes. */
function build(crate: "dtusd" | "spend-policy") {
  const wslRepo = "/mnt/c/Dev/NEAR Hackathon";
  execFileSync(
    "wsl",
    [
      "-d",
      "Ubuntu",
      "--",
      "bash",
      "-lc",
      `source ~/.cargo/env && cd "${wslRepo}/contracts/${crate}" && ` +
        `CARGO_TARGET_DIR=$HOME/dayone-target cargo near build non-reproducible-wasm --locked ` +
        `--out-dir "${wslRepo}/contracts/target/near/${crate}"`,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const name = crate.replace("-", "_");
  return readFileSync(join(repo, "contracts", "target", "near", crate, `${name}.wasm`));
}

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}) {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

/** Deploys `code` unless the account already runs it; initializes on the first deploy. */
async function deploy(accountId: string, code: Buffer, init: object) {
  const hash = baseEncode(createHash("sha256").update(code).digest());
  const state = await provider.viewAccount({ accountId });
  if (state.code_hash === hash) {
    console.log(`unchanged ${accountId} (${hash})`);
    return;
  }
  const firstDeploy = state.code_hash === "11111111111111111111111111111111";
  await signer(accountId).signAndSendTransaction({
    receiverId: accountId,
    actions: [
      actions.deployContract(code),
      ...(firstDeploy ? [actions.functionCall("new", init, teraToGas("30"), 0n)] : []),
    ],
  });
  console.log(
    `deployed  ${accountId} (${code.length} bytes, ${hash})${firstDeploy ? ", initialized" : ""}`,
  );
}

/** A call signed by Acme's root key in the OS keychain. */
function asAcme(contractId: string, method: string, args: object, deposit: string) {
  execFileSync(
    nearCli,
    [
      "contract",
      "call-function",
      "as-transaction",
      contractId,
      method,
      "json-args",
      JSON.stringify(args),
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
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  console.log(`called    ${contractId}.${method}`);
}

async function main() {
  await deploy(TOKEN, build("dtusd"), { owner_id: ROOT, total_supply: SUPPLY.toString() });
  await deploy(POLICY, build("spend-policy"), { owner: ROOT, treasury: ROOT, token: TOKEN });

  // Token storage for the contract and every supplier agent (Acme registered at init as the
  // owner). QuickChem is registered too, so a refusal to pay it comes from the policy, not
  // from missing storage.
  const holders = [
    POLICY,
    "northgate-ingredients.testnet",
    "ridgeway-ascorbics.testnet",
    "quickchem-direct.testnet",
    "bayfront-labsupply.testnet",
  ];
  for (const holder of holders) {
    if ((await view(TOKEN, "storage_balance_of", { account_id: holder })) === null) {
      asAcme(TOKEN, "storage_deposit", { account_id: holder }, STORAGE_DEPOSIT);
    }
  }

  // CONTRACTS.md §8 configuration. Each call is made only when the chain differs, so re-runs
  // add nothing to the policy history that HQ's view shows.
  const oneYocto = "1 yoctoNEAR";
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const roles = { receiver: `receiving.${PLANT_B}`, qc: `qc.${PLANT_B}` };
  if (!same(await view(POLICY, "get_roles", { plant: PLANT_B }), roles)) {
    asAcme(POLICY, "set_roles", { plant: PLANT_B, ...roles }, oneYocto);
  }
  // One Kevin per plant (GROUP_BUY.md §5); Plant B's is the main demo's policy. The table is
  // the one the local sandbox uses, so both networks hold the same limits.
  for (const p of PLANT_AGENTS) {
    const kevin = kevinOf(p.code, ROOT);
    const policy = {
      name: p.name,
      plant: `plant-${p.code}.${ROOT}`,
      per_po_limit: (BigInt(p.perPoUsd) * DOLLAR).toString(),
      monthly_limit: (BigInt(p.monthlyUsd) * DOLLAR).toString(),
      categories: p.categories,
      approver: directorOf(p.code, ROOT),
    };
    const current = await view<Record<string, unknown> | null>(POLICY, "get_agent_policy", {
      agent: kevin,
    });
    const { signed_above: _above, ...currentTerms } = current ?? {};
    if (!same(currentTerms, { ...policy, active: true })) {
      asAcme(POLICY, "set_agent_policy", { agent: kevin, ...policy }, oneYocto);
    }
    // CONTRACTS.md §11 F: Plant B's POs above the threshold need Kevin's enclave-signed decision.
    const above = p.code === "b" ? (BigInt(SIGNED_ABOVE_USD) * DOLLAR).toString() : null;
    const now = await view<{ signed_above: string | null } | null>(POLICY, "get_agent_policy", {
      agent: kevin,
    });
    if ((now?.signed_above ?? null) !== above) {
      asAcme(POLICY, "set_signed_decision_threshold", { agent: kevin, above }, oneYocto);
    }
  }
  // §11 F: the enclave key npm run attest verified (data/replay/attestation.json) signs decisions.
  const signer = enclaveSigner();
  const attested = await view<string[]>(POLICY, "get_attested_signers");
  if (!attested.includes(signer)) {
    asAcme(POLICY, "set_attested_signer", { address: signer, active: true }, oneYocto);
  }
  const labCap = (2_000n * DOLLAR).toString();
  if ((await view(POLICY, "get_category_cap", { category: "lab_chemical" })) !== labCap) {
    asAcme(POLICY, "set_category_cap", { category: "lab_chemical", monthly_cap: labCap }, oneYocto);
  }
  // Suppliers Kevin may pay (FICTIONAL_DATA §5), each with a supplier credential: the
  // categories it sells and an expiry (CONTRACTS.md §3.1). This is also the migration of the
  // approvals set before credentials existed: issuing lists the supplier as well. QuickChem
  // Direct is unqualified and gets none, so the contract refuses it with no approval path.
  for (const { supplier, categories } of SUPPLIER_CREDENTIALS) {
    const credential = await view<{
      categories: string[];
      expires_at: string;
      revoked: unknown;
    } | null>(POLICY, "get_credential", { supplier });
    const current =
      credential !== null &&
      credential.revoked === null &&
      credential.expires_at === CREDENTIAL_EXPIRY &&
      same(credential.categories, categories) &&
      (await view(POLICY, "get_supplier", { supplier })) === "Qualified";
    if (!current) {
      asAcme(
        POLICY,
        "issue_credential",
        { supplier, status: "Qualified", categories, expires_at: CREDENTIAL_EXPIRY },
        oneYocto,
      );
    }
  }
  if ((await view(POLICY, "get_credential", { supplier: "quickchem-direct.testnet" })) !== null) {
    throw new Error("quickchem-direct.testnet holds a supplier credential; HQ never issued one");
  }

  const { budget } = await view<{ budget: string }>(POLICY, "get_budget");
  if (BigInt(budget) === 0n) {
    asAcme(
      TOKEN,
      "ft_transfer_call",
      { receiver_id: POLICY, amount: BUDGET.toString(), msg: "" },
      oneYocto,
    );
  }

  const after = await view<{ budget: string; escrowed: string }>(POLICY, "get_budget");
  const balance = await view<string>(TOKEN, "ft_balance_of", { account_id: POLICY });
  console.log(
    `budget ${BigInt(after.budget) / DOLLAR} DTUSD, escrowed ${BigInt(after.escrowed) / DOLLAR}, ` +
      `contract balance ${BigInt(balance) / DOLLAR} DTUSD`,
  );
  if (BigInt(balance) !== BigInt(after.budget) + BigInt(after.escrowed)) {
    throw new Error("token balance does not equal budget + escrowed");
  }
  // Kevin, the API and the demo send the §11 arguments only once the contract has them.
  const configFile = join(repo, "config/testnet-accounts.json");
  const config = JSON.parse(readFileSync(configFile, "utf8")) as Record<string, unknown>;
  config.contractFeatures = {
    receiptSettlement: true,
    signedDecisions: true,
    signedAboveUsd: SIGNED_ABOVE_USD,
  };
  writeFileSync(
    configFile,
    `${JSON.stringify(config, null, 2)}
`,
  );
  console.log("contract features: receipt settlement, signed decisions above $" + SIGNED_ABOVE_USD);
}

await main();
