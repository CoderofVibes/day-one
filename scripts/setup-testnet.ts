// npm run setup:testnet: creates Acme's testnet accounts (docs/CONTRACTS.md §1). Idempotent:
// an account that already exists is skipped (a staff or agent key whose methods changed is
// replaced), so the script can be re-run after a failure.
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
// v2 (CONTRACTS.md §11, Nov 3): v1 at spend-policy.${ROOT} could not be deleted once its state
// grew past the protocol's limit for DeleteAccount, so v1 and its anchors stay readable there.
const SPEND_POLICY = `spend-policy-v2.${ROOT}`;
const RPC_URL = process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
const provider = new JsonRpcProvider({ url: RPC_URL });

const nearCli =
  process.env.NEAR_CLI ??
  (existsSync(join(homedir(), ".cargo", "bin", "near.exe"))
    ? join(homedir(), ".cargo", "bin", "near.exe")
    : "near");

/** Accounts Acme's root creates, with the NEAR each starts with (CONTRACTS.md §1). */
const ROOT_CHILDREN = [
  // Each plant funds its Kevin and creates its staff accounts (PLANT_CHILDREN below).
  { id: `plant-a.${ROOT}`, near: 0.8 },
  { id: PLANT_B, near: 1.5 },
  { id: `plant-c.${ROOT}`, near: 0.8 },
  // The contract with group purchasing, credentials and sealed rounds is about 400 KB of code,
  // and storage costs 1 NEAR per 100 KB (CONTRACTS.md §8).
  { id: SPEND_POLICY, near: 8 },
  { id: `dtusd.${ROOT}`, near: 3 },
  // Supplier agents are top-level accounts outside Acme's tree (created through the `testnet`
  // registrar). Acme pays for their creation but holds no say over them afterwards.
  { id: "northgate-ingredients.testnet", near: 1 },
  { id: "ridgeway-ascorbics.testnet", near: 1 },
  { id: "quickchem-direct.testnet", near: 1 },
  { id: "bayfront-labsupply.testnet", near: 1 },
  // The suppliers of the credential attacks (data/attacks/credential-attacks.json): HQ revokes,
  // lets expire and suspends their credentials. Pacific Excipient accepts and ships two
  // deliveries from its own account; the other two never sign.
  { id: "pacific-excipient.testnet", near: 0.3 },
  { id: "fennimore-polyols.testnet", near: 0.1 },
  { id: "sierra-mineral.testnet", near: 0.1 },
] as const;

/** What a plant's Kevin may call: plain and pooled POs, pools, anchors, sealed rounds, invoices. */
const AGENT_METHODS = [
  "submit_po",
  "submit_pooled_po",
  "open_pool",
  "join_pool",
  "anchor",
  "anchor_batch",
  "open_sealed_round",
  "award_sealed_round",
  // CONTRACTS.md §11 E: Kevin records the supplier's invoice he matched.
  "record_invoice",
];
const DIRECTOR_METHODS = ["approve_po", "reject_po"];

interface PlantChild {
  plant: string;
  prefix: string;
  near: number;
  methods: readonly string[];
  allowance: number;
}

/**
 * People and agents at each plant. Each gets an offline full-access key and one function-call
 * key that reaches only its own spend-policy methods; staff hold no NEAR (the relayer pays).
 * Plant B runs the whole purchasing loop; Plants A and C have a Kevin and a director for group
 * purchasing (GROUP_BUY.md §5), and their pooled POs use the placing plant's dock and QC.
 */
const PLANT_CHILDREN: readonly PlantChild[] = [
  { plant: PLANT_B, prefix: "kevin", near: 1, methods: AGENT_METHODS, allowance: 2 },
  { plant: PLANT_B, prefix: "director", near: 0, methods: DIRECTOR_METHODS, allowance: 0.25 },
  { plant: PLANT_B, prefix: "receiving", near: 0, methods: ["confirm_receipt"], allowance: 0.25 },
  { plant: PLANT_B, prefix: "qc", near: 0, methods: ["qc_release", "qc_reject"], allowance: 0.25 },
  ...["a", "c"].flatMap((code) => [
    {
      plant: `plant-${code}.${ROOT}`,
      prefix: "kevin",
      near: 0.5,
      methods: AGENT_METHODS,
      allowance: 0.5,
    },
    {
      plant: `plant-${code}.${ROOT}`,
      prefix: "director",
      near: 0,
      methods: DIRECTOR_METHODS,
      allowance: 0.25,
    },
  ]),
];

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

/** Sends `near` from Acme's root (keychain) so a plant can fund the accounts it creates. */
function topUpFromRoot(accountId: string, near: number) {
  execFileSync(
    nearCli,
    [
      "tokens",
      ROOT,
      "send-near",
      accountId,
      `${near} NEAR`,
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  console.log(`topped up ${accountId} with ${near} NEAR from ${ROOT}`);
}

/** Makes sure `plant` can pay for the children it still has to create, plus a margin. */
async function ensurePlantFunds(plant: string) {
  const missing = [];
  for (const child of PLANT_CHILDREN.filter((c) => c.plant === plant)) {
    if (!(await exists(`${child.prefix}.${plant}`))) missing.push(child);
  }
  if (missing.length === 0) return;
  // Each new account costs its transfer plus about 0.002 NEAR of storage for the keys.
  const need = missing.reduce((sum, c) => sum + c.near + 0.01, 0) + 0.1;
  const { balance } = await new Account(plant, provider).getState();
  const have = Number(balance.available / 10n ** 21n) / 1000;
  if (have < need) topUpFromRoot(plant, Math.ceil((need - have) * 10) / 10);
}

async function createUnderPlant(child: PlantChild) {
  const accountId = `${child.prefix}.${child.plant}`;
  const full = keyFor(accountId, "full");
  const fc = keyFor(accountId, "fc");
  const parent = new Account(child.plant, provider, keyFor(child.plant, "full").private_key);
  await parent.signAndSendTransaction({
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

/**
 * An account made by an earlier run keeps its function-call key, but a key's methods are fixed
 * when it is added. When the methods on chain differ from `child.methods`, the account deletes
 * the key and adds it again with the right methods, in one transaction signed with its own
 * full-access key, so the stored `.fc.json` stays valid.
 */
async function ensureFunctionCallKey(child: PlantChild) {
  const accountId = `${child.prefix}.${child.plant}`;
  if (!existsSync(keyFile(accountId, "full"))) {
    throw new Error(`${accountId} exists but its full-access key is not in ${credentialsDir}`);
  }
  const fc = keyFor(accountId, "fc");
  const { keys } = await new Account(accountId, provider).getAccessKeyList();
  const onChain = keys.find((k) => k.public_key === fc.public_key);
  const permission = onChain?.access_key.permission;
  const current =
    typeof permission === "object" && "FunctionCall" in permission
      ? permission.FunctionCall
      : undefined;
  const same =
    current?.receiver_id === SPEND_POLICY &&
    [...current.method_names].sort().join() === [...child.methods].sort().join();
  if (same) {
    console.log(`exists   ${accountId}`);
    return;
  }
  const publicKey = KeyPair.fromString(fc.private_key).getPublicKey();
  const self = new Account(accountId, provider, keyFor(accountId, "full").private_key);
  await self.signAndSendTransaction({
    receiverId: accountId,
    actions: [
      ...(onChain ? [actions.deleteKey(publicKey)] : []),
      actions.addFunctionCallAccessKey(
        publicKey,
        SPEND_POLICY,
        [...child.methods],
        nearToYocto(child.allowance),
      ),
    ],
  });
  console.log(`rekeyed  ${accountId} (FC key: ${child.methods.join(", ")})`);
}

/**
 * The relayer pays for staff approvals (research 06). Tony created it with its key in his
 * keychain; the server gets a second full-access key of its own, added once by a
 * keychain-signed add-key, so the keychain key never leaves the keychain.
 */
const RELAYER = "dayone-relayer.testnet";

async function ensureServerKey(accountId: string) {
  const key = keyFor(accountId, "full");
  const { keys } = await new Account(accountId, provider).getAccessKeyList();
  if (keys.some((k) => k.public_key === key.public_key)) {
    console.log(`has key  ${accountId}`);
    return key.public_key;
  }
  execFileSync(
    nearCli,
    [
      "account",
      "add-key",
      accountId,
      "grant-full-access",
      "use-manually-provided-public-key",
      key.public_key,
      "network-config",
      "testnet",
      "sign-with-keychain",
      "send",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  console.log(`added    server key to ${accountId}`);
  return key.public_key;
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

  for (const plant of new Set(PLANT_CHILDREN.map((c) => c.plant))) await ensurePlantFunds(plant);

  for (const child of PLANT_CHILDREN) {
    const id = `${child.prefix}.${child.plant}`;
    if (await exists(id)) {
      await ensureFunctionCallKey(child);
    } else {
      await createUnderPlant(child);
      console.log(`created  ${id} (${child.near} NEAR, FC key: ${child.methods.join(", ")})`);
    }
    accounts[id] = {
      publicKeys: [keyFor(id, "full").public_key, keyFor(id, "fc").public_key],
    };
  }

  accounts[RELAYER] = { publicKeys: [await ensureServerKey(RELAYER)] };

  mkdirSync(join(repo, "config"), { recursive: true });
  writeFileSync(
    configFile,
    `${JSON.stringify({ network: "testnet", root: ROOT, spendPolicy: SPEND_POLICY, accounts }, null, 2)}\n`,
  );
  console.log(`Wrote ${configFile}`);
}

await main();
