// The replayed demo loop with the acquirer's ERP attached: the ERP rebuilt from nothing
// (masters, cutover sync, migrated AP history), then the recorded testnet run through Kevin's
// hooks. Shared by `npm run erp:demo` and `npm run erp:reconcile`; no keys, no network.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runDemo } from "../../agents/kevin/src/demo.ts";
import { KevinErp } from "../../agents/kevin/src/erp.ts";
import { openDemoEnv } from "../../api/src/env.ts";
import { ReplayTransport } from "../../server/src/chain/replay.ts";
import { rebuildErp } from "../../server/src/erp-connector/rebuild.ts";

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
  const accounts = testnetAccounts(root);
  const kevin = `kevin.plant-b.${accounts.root}`;

  // 1. The ERP: masters, cutover from Day One's seed, migrated AP history.
  const cutover: string[] = [];
  const built = await rebuildErp(file, (l) => cutover.push(l));
  const { dayOne: db, connector } = built;

  // 2. The replayed demo loop, set up exactly as npm run demo sets it up, plus the ERP hooks.
  const env = await openDemoEnv({ root, db });
  const transport = env.transport;
  if (!(transport instanceof ReplayTransport)) throw new Error("erp demo: expected a replay");
  const run = await runDemo({ ...env.deps, erp: new KevinErp(connector) });
  transport.assertDone();

  return { ...built, accounts, kevin, cutover, run };
}
