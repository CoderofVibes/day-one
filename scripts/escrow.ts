// npm run escrow — what the spend-policy contract holds right now, read with view calls only:
// the plant budget, the amount in escrow, Kevin's spend this month and every PO with its status.
// No keys.
//   --json   print one JSON line after the readable text

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LiveTransport } from "../server/src/chain/live.ts";
import { formatUsd } from "../server/src/money.ts";

const json = process.argv.slice(2).includes("--json");
const accounts = JSON.parse(
  readFileSync(fileURLToPath(new URL("../config/testnet-accounts.json", import.meta.url)), "utf8"),
) as { network: string; root: string; spendPolicy: string };
const kevin = `kevin.plant-b.${accounts.root}`;
const chain = new LiveTransport(accounts.network, () => {
  throw new Error("escrow signs nothing");
});
const view = (method: string, args: Record<string, unknown> = {}) =>
  chain.view({ contractId: accounts.spendPolicy, method, args });

interface Po {
  po_id: string;
  supplier: string;
  amount: string;
  category: string;
  status: string;
  approved_by: string | null;
  supplier_lot: string | null;
}

const budget = (await view("get_budget")) as { budget: string; escrowed: string };
const spent = (await view("get_spent", { agent: kevin })) as string;
const pos: Po[] = [];
for (let from = 0; ; from += 100) {
  const page = (await view("list_pos", { from, limit: 100 })) as Po[];
  pos.push(...page);
  if (page.length < 100) break;
}

const usd = (units: string) => formatUsd(BigInt(units));
const lines = [
  `${accounts.spendPolicy} on ${accounts.network}`,
  `Budget ${usd(budget.budget)}, in escrow ${usd(budget.escrowed)}, Kevin spent ${usd(spent)} this month.`,
  `${pos.length} POs:`,
  ...pos.map(
    (p) =>
      `  ${p.po_id.padEnd(9)} ${p.status.padEnd(9)} ${usd(p.amount).padStart(10)}  ${p.supplier}` +
      (p.approved_by ? `, approved by ${p.approved_by}` : "") +
      (p.supplier_lot ? `, lot ${p.supplier_lot}` : ""),
  ),
];
console.log(lines.join("\n"));
if (json) {
  console.log(
    JSON.stringify({
      contract: accounts.spendPolicy,
      network: accounts.network,
      budget: budget.budget,
      escrowed: budget.escrowed,
      kevinSpentThisMonth: spent,
      pos,
    }),
  );
}
