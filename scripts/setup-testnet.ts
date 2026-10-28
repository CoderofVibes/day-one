// npm run setup:testnet: creates Acme's testnet accounts (docs/CONTRACTS.md §1). Idempotent:
// an account that already exists is skipped, so the script can be re-run after a failure.
//
// Acme's root key never leaves Tony's OS keychain: root-signed steps go through near-cli-rs
// with `sign-with-keychain`. Every new key pair is generated here; private keys go to the
// git-ignored .near-credentials/testnet/ in this repo, and public account ids and keys go to
// config/testnet-accounts.json (committed), so replay mode needs no secrets.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  actions,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  nearToYocto,
} from "near-api-js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const credentialsDir = join(repo, ".near-credentials", "testnet");
const configFile = join(repo, "config", "testnet-accounts.json");

const ROOT = "acme-holdings.testnet";
const PLANT_B = `plant-b.${ROOT}`;
const SPEND_POLICY = `spend-policy.${ROOT}`;
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const provider = new JsonRpcProvider({ url: RPC_URL });

const nearCli =
  process.env.NEAR_CLI ??
  (existsSync(join(homedir(), ".cargo", "bin", "near.exe"))
    ? join(homedir(), ".cargo", "bin", "near.exe")
    : "near");

/** Accounts Acme's root creates, with the NEAR each starts with (CONTRACTS.md §1). */
const ROOT_CHILDREN = [
  { id: `plant-a.${ROOT}`, near: 0.2 },
  // Plant B funds Kevin's 1 NEAR and creates the staff accounts, so it starts with more.
  { id: PLANT_B, near: 1.5 },
  { id: `plant-c.${ROOT}`, near: 0.2 },
  { id: SPEND_POLICY, near: 5 },
  { id: `dtusd.${ROOT}`, near: 3 },
  // Supplier agents are top-level accounts outside Acme's tree (created through the `testnet`
  // registrar). Acme pays for their creation but holds no say over them afterwards.
  { id: "northgate-ingredients.testnet", near: 1 },
  { id: "ridgeway-ascorbics.testnet", near: 1 },
  { id: "quickchem-direct.testnet", near: 1 },
  { id: "bayfront-labsupply.testnet", near: 1 },
] as const;

/**
 * People and agents at Plant B. Each gets an offline full-access key and one function-call
 * key that reaches only its own spend-policy methods; staff hold no NEAR (the relayer pays).
 */
const PLANT_B_CHILDREN = [
  { prefix: "kevin", near: 1, methods: ["submit_po", "anchor", "anchor_batch"], allowance: 2 },
  { prefix: "director", near: 0, methods: ["approve_po", "reject_po"], allowance: 0.25 },
  { prefix: "receiving", near: 0, methods: ["confirm_receipt"], allowance: 0.25 },
  { prefix: "qc", near: 0, methods: ["qc_release", "qc_reject"], allowance: 0.25 },
] as const;

interface StoredKey {
  account_id: string;
  public_key: string;
  private_key: KeyPairString;
}

function keyFile(accountId: string, role: "full" | "fc") {
  return join(credentialsDir, role === "full" ? `${accountId}.json` : `${accountId}.fc.json`);
}

/** The stored key for an account, or a new one written to disk before any transaction. */
function keyFor(accountId: string, role: "full" | "fc"): StoredKey {
  const file = keyFile(accountId, role);
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

async function exists(accountId: string) {
  try {
    await new Account(accountId, provider).getState();
    return true;
  } catch (error) {
    if (String(error).includes("does not exist")) return false;
    throw error;
  }
}

function createFromRoot(accountId: string, near: number, publicKey: string) {
  execFileSync(
    nearCli,
    [
      "account",
      "create-account",
      "fund-myself",
      accountId,
      `${near} NEAR`,
      "use-manually-provided-public-key",
      publicKey,
      "sign-as",
      ROOT,
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}

async function createUnderPlantB(child: (typeof PLANT_B_CHILDREN)[number]) {
  const accountId = `${child.prefix}.${PLANT_B}`;
  const full = keyFor(accountId, "full");
  const fc = keyFor(accountId, "fc");
  const plantB = new Account(PLANT_B, provider, keyFor(PLANT_B, "full").private_key);
  await plantB.signAndSendTransaction({
    receiverId: accountId,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto(child.near)),
      actions.addFullAccessKey(KeyPair.fromString(full.private_key).getPublicKey()),
      actions.addFunctionCallAccessKey(
        KeyPair.fromString(fc.private_key).getPublicKey(),
        SPEND_POLICY,
        [...child.methods],
        nearToYocto(child.allowance),
      ),
    ],
  });
}

async function main() {
  const accounts: Record<string, { publicKeys: string[] }> = {};

  for (const child of ROOT_CHILDREN) {
    const key = keyFor(child.id, "full");
    if (await exists(child.id)) {
      console.log(`exists   ${child.id}`);
    } else {
      createFromRoot(child.id, child.near, key.public_key);
      console.log(`created  ${child.id} (${child.near} NEAR)`);
    }
    accounts[child.id] = { publicKeys: [key.public_key] };
  }

  for (const child of PLANT_B_CHILDREN) {
    const id = `${child.prefix}.${PLANT_B}`;
    if (await exists(id)) {
      console.log(`exists   ${id}`);
    } else {
      await createUnderPlantB(child);
      console.log(`created  ${id} (${child.near} NEAR, FC key: ${child.methods.join(", ")})`);
    }
    accounts[id] = {
      publicKeys: [keyFor(id, "full").public_key, keyFor(id, "fc").public_key],
    };
  }

  mkdirSync(join(repo, "config"), { recursive: true });
  writeFileSync(
    configFile,
    `${JSON.stringify({ network: "testnet", root: ROOT, spendPolicy: SPEND_POLICY, accounts }, null, 2)}\n`,
  );
  console.log(`Wrote ${configFile}`);
}

await main();
