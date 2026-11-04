// What a demo run needs from the repo: the seeded ledger, the chain and model clients (replayed
// from data/replay/ with no keys, or live on testnet and NEAR AI Cloud from .env and the
// server-held keys), the salts, the photographed records and the invoice. npm run demo and the
// HTTP API build their runs from here, so the two cannot drift apart.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { recordedSignatures } from "@day-one/kevin/decision";
import {
  type BatchRecordPage,
  DEMO_CLOCK,
  type DemoDeps,
  type DemoSalts,
} from "@day-one/kevin/demo";
import type { PackingSlip } from "@day-one/kevin/receiving";
import { type ContractFeatures, contractExtras } from "@day-one/kevin/settlementExtras";
import { AttestationClient } from "@day-one/server/attestation/fetch";
import { ChainClient } from "@day-one/server/chain/client";
import { LiveTransport } from "@day-one/server/chain/live";
import {
  fixtureHasCall,
  RecordingTransport,
  ReplayTransport,
  readFixture,
} from "@day-one/server/chain/replay";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { createLlm, type LlmFixture, RecordingLlm, ReplayLlm } from "@day-one/server/llm/client";
import type { LlmClient } from "@day-one/server/llm/types";
import { plantBStaff } from "@day-one/server/relayer";
import { seedLedger } from "@day-one/server/seed";
import { DEMO_QUOTES, SUPPLIERS } from "@day-one/server/seed/quotes";
import { demoBus } from "@day-one/suppliers/bus";
import { acceptAndShip } from "@day-one/suppliers/shipping";

/** The repository root, where data/, config/ and .env live. */
export const REPO_ROOT = resolve(import.meta.dirname, "../..");
export const RELAYER = "dayone-relayer.testnet";
/** The folder Kevin watches for scanned batch records (research 24 §1). */
export const INBOX_DIR = join(REPO_ROOT, "data/inbox/batch-records");
/** The PO numbers the demo submits; a contract accepts each id once. */
export const DEMO_POS = ["PO-1041", "PO-1042"];

const scan = (name: string) => `data/batch-records/${name}`;
/** Plant B's week on paper: a yield note, the run's own record, a smudge, and a slip by mistake. */
export const DEMO_INBOX = [
  scan("BR-B-1044.jpg"),
  scan("BR-B-1045.jpg"),
  scan("BR-B-1046.jpg"),
  "data/packing-slips/NG-PS-60417.jpg",
];
/** Every scan with a recorded answer. BR-B-1045's is the run's own (data/replay/demo-llm.json). */
export const RECORDABLE_SCANS = [
  ...["BR-B-1041", "BR-B-1042", "BR-B-1043", "BR-B-1044", "BR-B-1046", "BR-A-2207"].map((b) =>
    scan(`${b}.jpg`),
  ),
  "data/packing-slips/NG-PS-60417.jpg",
];
/** The whole week: the run's record first, then every scan with a recorded answer. */
export const ALL_SCANS = [scan("BR-B-1045.jpg"), ...RECORDABLE_SCANS];
const BATCH_RECORD = "data/batch-records/BR-B-1045.jpg";
const SLIP = "NG-PS-60417";

export interface TestnetAccounts {
  network: string;
  root: string;
  spendPolicy: string;
  /** Set by deploy:testnet once the contract has CONTRACTS.md §11; absent before. */
  contractFeatures?: {
    receiptSettlement?: boolean;
    signedDecisions?: boolean;
    signedAboveUsd?: number;
  };
}

export function fixtureFiles(root = REPO_ROOT) {
  return {
    chain: join(root, "data/replay/demo-chain.json"),
    llm: join(root, "data/replay/demo-llm.json"),
    salts: join(root, "data/replay/demo-salts.json"),
    transcript: join(root, "data/replay/transcript.txt"),
    /** The vision answers for the other scans in the demo inbox (npm run inbox -- --live --record). */
    inboxLlm: join(root, "data/replay/inbox-llm.json"),
    /** The reading of each mailbox message for the morning review (npm run review -- --live --record). */
    reviewLlm: join(root, "data/replay/review-llm.json"),
    /** Talk to Kevin's answers to the suggested questions (npm run ask -- --live --record). */
    askLlm: join(root, "data/replay/ask-llm.json"),
    proof: join(root, "data/batch-records/BR-B-1045.json"),
  };
}

export interface DemoEnvOptions {
  root?: string;
  /** Testnet and the live models instead of the recorded run. */
  live?: boolean;
  /** Wrap the live clients so the run can be saved as the new fixtures. */
  record?: boolean;
  env?: NodeJS.ProcessEnv;
  /** A ledger already seeded, e.g. by the ERP cutover (scripts/lib/erp-demo-run.ts). */
  db?: Ledger;
}

export interface DemoEnv {
  root: string;
  live: boolean;
  accounts: TestnetAccounts;
  db: Ledger;
  transport: LiveTransport | RecordingTransport | ReplayTransport;
  llm: LlmClient;
  /** Reads the watched folder: the live models, or the recorded answers for the demo inbox. */
  inboxLlm: LlmClient;
  salts: DemoSalts;
  deps: DemoDeps;
  /** The chain log's clock, moved by the run. */
  clock: () => string;
}

/** A missing prerequisite, explained for whoever started the run. */
export class DemoEnvError extends Error {
  override name = "DemoEnvError";
}

export async function openDemoEnv(options: DemoEnvOptions = {}): Promise<DemoEnv> {
  const root = options.root ?? REPO_ROOT;
  const live = options.live ?? false;
  const env = options.env ?? process.env;
  const fixtures = fixtureFiles(root);
  if (options.record && !live) {
    throw new DemoEnvError("--record needs a live run: npm run demo:live -- --record");
  }
  if (!live) {
    const files = [fixtures.chain, fixtures.llm, fixtures.salts, fixtures.transcript];
    const missing = files.filter((f) => !existsSync(f));
    if (missing.length) {
      throw new DemoEnvError(
        "No recorded run yet. Record one with npm run demo:live -- --record " +
          `(missing ${missing.map((f) => f.slice(root.length + 1)).join(", ")}).`,
      );
    }
  }
  const accounts = JSON.parse(
    readFileSync(join(root, "config/testnet-accounts.json"), "utf8"),
  ) as TestnetAccounts;

  const db = options.db ?? openLedger();
  if (!options.db) seedLedger(db);
  let clock: string = DEMO_CLOCK.start;

  let transport: DemoEnv["transport"];
  let llm: LlmClient;
  let salts: DemoSalts;
  // The supplier agents answer the RFQ and anchor their quotes from their own accounts. A
  // replay of the Oct 28 recording, made before the agents anchored, answers from the same
  // plain quote set it recorded with; the agents join the replay at the next re-record.
  let agentsQuote = true;
  if (live) {
    if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
    if (!existsSync(join(root, `.near-credentials/testnet/${RELAYER}.json`))) {
      throw new DemoEnvError(
        `The relayer's server key is missing (.near-credentials/testnet/${RELAYER}.json). ` +
          "Tony runs npm run setup:testnet once in his session (PLAN human task 12, OPEN_QUESTIONS #31).",
      );
    }
    const liveChain = new LiveTransport(accounts.network, undefined, undefined, {
      relayerId: RELAYER,
      policyContract: accounts.spendPolicy,
      staffMethods: plantBStaff(accounts.root),
    });
    await assertDemoPosUnused(liveChain, accounts);
    transport = options.record ? new RecordingTransport(liveChain) : liveChain;
    const routed = createLlm(fixtures.llm, {
      ...env,
      DAYONE_MODE: "live",
      LLM_RECORD_FIXTURES: "false",
    });
    llm = options.record ? new RecordingLlm(routed) : routed;
    const salt = () => randomBytes(16).toString("hex");
    salts = {
      po1041: salt(),
      po1042: salt(),
      batch: salt(),
      receipt: salt(),
      quotes: Object.fromEntries(SUPPLIERS.map((s) => [s.account, salt()])),
    };
  } else {
    const recorded = readFixture(fixtures.chain);
    agentsQuote = fixtureHasCall(recorded, "quote");
    transport = new ReplayTransport(recorded);
    llm = ReplayLlm.fromFile(fixtures.llm);
    // The Oct 28 salts predate the quote salts.
    const recordedSalts = JSON.parse(readFileSync(fixtures.salts, "utf8")) as Omit<
      DemoSalts,
      "quotes"
    > &
      Partial<Pick<DemoSalts, "quotes">>;
    salts = { ...recordedSalts, quotes: recordedSalts.quotes ?? {} };
  }

  const chain = new ChainClient(db, transport, () => clock);
  const bus = demoBus(chain, {
    policyContract: accounts.spendPolicy,
    salt: (account) => {
      const salt = salts.quotes[account];
      if (!salt) throw new DemoEnvError(`no quote salt for ${account} in the recorded salts`);
      return salt;
    },
  });
  const deps: DemoDeps = {
    db,
    chain,
    llm,
    setClock: (iso) => {
      clock = iso;
    },
    kevin: `kevin.plant-b.${accounts.root}`,
    policyContract: accounts.spendPolicy,
    relayer: RELAYER,
    tokenSymbol: "DTUSD",
    batchRecord: loadBatchRecord(root, BATCH_RECORD),
    batchRecordCount: readdirSync(join(root, "data/batch-records")).filter((f) =>
      f.endsWith(".jpg"),
    ).length,
    slip: loadPackingSlip(root, SLIP),
    invoiceText: (
      JSON.parse(readFileSync(join(root, "data/attacks/invoices.json"), "utf8")) as {
        invoices: { genuine: string };
      }
    ).invoices.genuine,
    quotes: agentsQuote
      ? (rfq) => bus.requestQuotes(rfq)
      : async (rfq) => [...(DEMO_QUOTES[rfq.material] ?? [])],
    ship: (shipment) => acceptAndShip(chain, shipment, { policyContract: accounts.spendPolicy }),
    salts,
  };
  // What the deployed contract takes beyond CONTRACTS.md §1–§10 (§11), as deploy:testnet wrote it.
  const features: ContractFeatures & { signedAboveUsd?: number } = accounts.contractFeatures ?? {};
  if (features.receiptSettlement || features.signedDecisions) {
    const attestationFile = join(root, "data/replay/attestation.json");
    const signatures = live
      ? (chatId: string) =>
          new AttestationClient(process.env.NEARAI_API_KEY ?? "").signature(chatId)
      : existsSync(attestationFile)
        ? recordedSignatures(JSON.parse(readFileSync(attestationFile, "utf8")))
        : null;
    deps.features = features;
    deps.extras = contractExtras(db, {
      features,
      llm,
      signatures,
      signedAboveUsdc: (features.signedAboveUsd ?? 2_500) * 1_000_000,
    });
  }
  const inboxLlm = live ? llm : inboxReplay(fixtures.llm, fixtures.inboxLlm);
  return { root, live, accounts, db, transport, llm, inboxLlm, salts, deps, clock: () => clock };
}

/**
 * The recorded vision answers for the watched folder: the run's own (BR-B-1045 is read the same
 * way whether uploaded or dropped) and the other scans of the demo inbox, when recorded. Its own
 * client, so reading the folder never uses up an answer the run replays.
 */
export function inboxReplay(runFixture: string, inboxFixture: string): ReplayLlm {
  const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as LlmFixture;
  const run = read(runFixture);
  const extra = existsSync(inboxFixture) ? read(inboxFixture).entries : [];
  return new ReplayLlm({
    ...run,
    entries: [...run.entries.filter((e) => e.task === "vision"), ...extra],
  });
}

/** A PO id can be submitted once per contract; a second live run needs fresh state. */
export async function assertDemoPosUnused(chain: LiveTransport, accounts: TestnetAccounts) {
  for (const po of DEMO_POS) {
    const existing = await chain.view({
      contractId: accounts.spendPolicy,
      method: "get_po",
      args: { po_id: po },
    });
    if (existing) {
      throw new DemoEnvError(`${po} is already on chain; the demo needs a contract without it.`);
    }
  }
}

/** A committed batch-record photo by its path under data/batch-records/. */
export function loadBatchRecord(root: string, file: string): BatchRecordPage {
  const name = basename(file);
  if (!/^[\w-]+\.jpg$/.test(name)) throw new DemoEnvError(`not a batch-record photo: ${file}`);
  const path = join(root, "data/batch-records", name);
  if (!existsSync(path)) throw new DemoEnvError(`no such batch record: ${name}`);
  return pageOf(`data/batch-records/${name}`, readFileSync(path));
}

/** An uploaded page: the bytes, hashed, in the shape the vision route takes. */
export function pageOf(file: string, bytes: Buffer): BatchRecordPage {
  return {
    file,
    sha256: sha256(bytes),
    image: { mediaType: "image/jpeg", base64: bytes.toString("base64") },
  };
}

/**
 * A packing slip from its ground-truth file and photo under data/packing-slips/. Reading the
 * slip photo with the vision route is not built yet; the truth file stands in for it.
 */
export function loadPackingSlip(root: string, slipNo: string): PackingSlip {
  if (!/^[\w-]+$/.test(slipNo)) throw new DemoEnvError(`not a packing-slip number: ${slipNo}`);
  const truthFile = join(root, "data/packing-slips", `${slipNo}.truth.json`);
  if (!existsSync(truthFile)) throw new DemoEnvError(`no such packing slip: ${slipNo}`);
  const truth = JSON.parse(readFileSync(truthFile, "utf8")) as {
    slipNo: string;
    poNo: string;
    shipFrom: string[];
    description: string;
    shipped: string;
    backOrdered: string;
    supplierLot: string;
  };
  const kg = (text: string) => Math.round((Number.parseFloat(text.replace(/,/g, "")) || 0) * 1e6);
  const file = `data/packing-slips/${slipNo}.jpg`;
  return {
    slipNo: truth.slipNo,
    poNo: truth.poNo,
    vendorName: truth.shipFrom[0] ?? "",
    lines: [
      {
        description: truth.description,
        shippedBase: kg(truth.shipped),
        backorderedBase: kg(truth.backOrdered),
        supplierLot: truth.supplierLot,
      },
    ],
    file,
    sha256: sha256(readFileSync(join(root, file))),
  };
}

export function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
