// The replayed demo loop with the acquirer's ERP attached: the ERP rebuilt from nothing
// (masters, cutover sync, migrated AP history), then the recorded testnet run through Kevin's
// hooks. Shared by `npm run erp:demo` and `npm run erp:reconcile`; no keys, no network.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_CLOCK, type DemoSalts, runDemo } from "../../agents/kevin/src/demo.ts";
import { KevinErp } from "../../agents/kevin/src/erp.ts";
import type { PackingSlip } from "../../agents/kevin/src/receiving.ts";
import { acceptAndShip } from "../../agents/suppliers/src/shipping.ts";
import { ChainClient } from "../../server/src/chain/client.ts";
import { ReplayTransport } from "../../server/src/chain/replay.ts";
import { rebuildErp } from "../../server/src/erp-connector/rebuild.ts";
import { ReplayLlm } from "../../server/src/llm/client.ts";

export interface TestnetAccounts {
  network: string;
  root: string;
  spendPolicy: string;
}

export function testnetAccounts(root: string): TestnetAccounts {
  return JSON.parse(
    readFileSync(join(root, "config/testnet-accounts.json"), "utf8"),
  ) as TestnetAccounts;
}

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * Rebuilds the ERP into `file` (":memory:" for none) and replays the recorded demo against it.
 * Returns the ERP, Day One's ledger as the run left it, the connector, and the run itself.
 */
export async function replayDemoWithErp(root: string, file: string) {
  const at = (p: string) => join(root, p);
  const accounts = testnetAccounts(root);
  const kevin = `kevin.plant-b.${accounts.root}`;

  // 1. The ERP: masters, cutover from Day One's seed, migrated AP history.
  const cutover: string[] = [];
  const built = await rebuildErp(file, (l) => cutover.push(l));
  const { dayOne: db, connector } = built;

  // 2. The replayed demo loop, as scripts/demo.ts sets it up, plus the ERP hooks.
  let clock: string = DEMO_CLOCK.start;
  const transport = ReplayTransport.fromFile(at("data/replay/demo-chain.json"));
  const chain = new ChainClient(db, transport, () => clock);
  const llm = ReplayLlm.fromFile(at("data/replay/demo-llm.json"));
  const salts = JSON.parse(readFileSync(at("data/replay/demo-salts.json"), "utf8")) as DemoSalts;
  const image = readFileSync(at("data/batch-records/BR-B-1045.jpg"));
  const slipFile = "data/packing-slips/NG-PS-60417.jpg";
  const truth = JSON.parse(
    readFileSync(at("data/packing-slips/NG-PS-60417.truth.json"), "utf8"),
  ) as {
    slipNo: string;
    poNo: string;
    shipFrom: string[];
    description: string;
    shipped: string;
    backOrdered: string;
    supplierLot: string;
  };
  const kg = (text: string) => Math.round((Number.parseFloat(text.replace(/,/g, "")) || 0) * 1e6);
  const slip: PackingSlip = {
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
    file: slipFile,
    sha256: sha256(readFileSync(at(slipFile))),
  };

  const run = await runDemo({
    db,
    chain,
    llm,
    setClock: (iso) => {
      clock = iso;
    },
    kevin,
    policyContract: accounts.spendPolicy,
    relayer: "dayone-relayer.testnet",
    tokenSymbol: "DTUSD",
    batchRecord: {
      file: "data/batch-records/BR-B-1045.jpg",
      sha256: sha256(image),
      image: { mediaType: "image/jpeg", base64: image.toString("base64") },
    },
    batchRecordCount: readdirSync(at("data/batch-records")).filter((f) => f.endsWith(".jpg"))
      .length,
    slip,
    invoiceText: (
      JSON.parse(readFileSync(at("data/attacks/invoices.json"), "utf8")) as {
        invoices: { genuine: string };
      }
    ).invoices.genuine,
    ship: (shipment) => acceptAndShip(chain, shipment, { policyContract: accounts.spendPolicy }),
    salts,
    erp: new KevinErp(connector),
  });
  transport.assertDone();

  return { ...built, accounts, kevin, cutover, run };
}
