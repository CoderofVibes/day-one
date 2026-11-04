// The recorded runs that pay suppliers outside Day One's books, for the reconciliation: the
// group purchase (npm run demo:group), the plant attacks that settle an order (npm run
// test:attacks), and payouts from interrupted takes, listed with their reason in
// data/attacks/stray-payouts.json. npm run erp:reconcile and the proof points read the same list.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attackRunsFromFixture,
  type GroupRunPo,
  groupRunsFromFixture,
} from "../../server/src/erp-connector/reconcile.ts";

export function recordedRunsOutsideDayOne(root: string, network: string): GroupRunPo[] {
  const read = (p: string) =>
    existsSync(join(root, p)) ? JSON.parse(readFileSync(join(root, p), "utf8")) : null;
  const group = read("data/replay/group-chain.json");
  const attacks = read("data/attacks/plant-attacks-testnet.json");
  const strays = (read("data/attacks/stray-payouts.json")?.payouts ?? []) as GroupRunPo[];
  return [
    ...(group ? groupRunsFromFixture(group, network) : []),
    ...(attacks ? attackRunsFromFixture(attacks, network) : []),
    ...strays,
  ];
}
