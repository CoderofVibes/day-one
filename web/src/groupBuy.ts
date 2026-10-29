// The recorded group buy (docs/GROUP_BUY.md) as the three-plant view shows it: written by
// npm run demo:group -- --web from the replayed run, so the screen and the transcript agree.

import groupBuyRun from "./data/group-buy.json";
import type { Approval, RunData, Step, Summary, Transaction } from "./run.ts";
import type { TwinOptions } from "./twin/model.ts";

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

/** The group purchase as a run the plant map can draw, step by step, beside the demo run. */
export const groupRun: RunData = {
  network: groupBuy.network,
  summary: groupBuy.summary,
  approvals: groupBuy.approvals,
  steps: groupBuy.steps,
  transactions: groupBuy.transactions,
  attestation: null,
};

/** The group run happens after onboarding: every plant starts online (docs/GROUP_BUY.md). */
export const GROUP_TWIN: TwinOptions = { plantB: "online" };
