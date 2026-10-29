// The recorded group buy (docs/GROUP_BUY.md) as the three-plant view shows it: written by
// npm run demo:group -- --web from the replayed run, so the screen and the transcript agree.

import groupBuyRun from "./data/group-buy.json";
import type { Approval, Step, Summary, Transaction } from "./run.ts";

export interface GroupShare {
  plant: string;
  plantName: string;
  agent: string;
  qtyBase: number;
  amount: number;
  approvedBy?: string;
}
export interface GroupBuyData {
  network: string;
  recordedAt: string;
  pool: {
    poolId: string;
    material: string;
    qtyBase: number;
    shares: GroupShare[];
    /** Plants that had no need and stayed out. */
    declined: string[];
  };
  po: {
    poNo: string;
    vendor: string;
    totalUsdc: number;
    unitPriceUsdc: number;
    savingsUsdc: number;
    status: string;
  } | null;
  /** Each plant's committed spend this month, from the contract, after the run. */
  spent: Record<string, number>;
  summary: Summary;
  approvals: Approval[];
  steps: Step[];
  transactions: Transaction[];
}

export const groupBuy = groupBuyRun as GroupBuyData;
