// Kevin submits a drafted PO to the spend-policy contract with his own key. The contract
// decides: within his limits it funds the escrow in the same call; otherwise it refuses with
// a reason. Kevin never checks a limit himself ("enforced, not logged"). He reads the result:
// a refusal that ends "director approval required." becomes an approval request to the
// approver named in his on-chain policy; any other refusal has no approval path.

import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import type { Ledger } from "@day-one/server/ledger/db";
import { approvals, purchaseOrders, staff } from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { eq } from "drizzle-orm";
import type { PoDraft } from "./purchasing.ts";

const NEEDS_APPROVAL = "director approval required.";

export interface AgentPolicyView {
  name: string;
  per_po_limit: string;
  approver: string;
}

export interface SubmitResult {
  outcome: LoggedOutcome;
  status: "funded" | "awaiting_approval" | "refused" | "failed";
  /** The line staff see. */
  sentence: string;
  /** The approval request text sent to the approver, when there is one. */
  requestText?: string;
}

export interface SubmitContext {
  kevin: string;
  policyContract: string;
  /** What the approval request says was ordered, e.g. "700 kg ascorbic acid". */
  summary: string;
  now: string;
}

const usd = (units: number | bigint) => formatUsd(BigInt(units));
/** "$2,500" for whole dollars in a text message, "$2,500.50" otherwise. */
const usdShort = (units: bigint) => usd(units).replace(/\.00$/, "");

export async function submitPo(
  db: Ledger,
  chain: ChainClient,
  po: PoDraft,
  ctx: SubmitContext,
): Promise<SubmitResult> {
  if (!po.vendor.account) throw new Error(`${po.poNo}: ${po.vendor.name} has no NEAR account`);
  const outcome = await chain.call({
    kind: "submit_po",
    signerId: ctx.kevin,
    receiverId: ctx.policyContract,
    method: "submit_po",
    args: {
      po_id: po.poNo,
      supplier: po.vendor.account,
      amount: String(po.totalUsdc),
      category: po.category,
      po_hash: po.poHash,
    },
    related: { type: "purchase_order", id: po.id },
  });
  const setStatus = (status: typeof purchaseOrders.status._.data) =>
    db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, po.id)).run();
  const head = `${po.poNo} to ${po.vendor.name}, ${usd(po.totalUsdc)}`;

  if (outcome.status === "success") {
    setStatus("funded");
    return { outcome, status: "funded", sentence: `${head} — approved automatically and funded.` };
  }
  if (outcome.status === "failed") {
    return {
      outcome,
      status: "failed",
      sentence: `${po.poNo} could not be sent to the chain; Kevin will retry. (${outcome.errorMessage})`,
    };
  }

  const reason = outcome.errorMessage ?? "";
  if (!reason.endsWith(NEEDS_APPROVAL)) {
    setStatus("refused");
    return { outcome, status: "refused", sentence: `${head} was refused: ${reason}` };
  }

  const policy = await chain.view<AgentPolicyView>({
    contractId: ctx.policyContract,
    method: "get_agent_policy",
    args: { agent: ctx.kevin },
  });
  const approver = db.select().from(staff).where(eq(staff.nearAccountId, policy.approver)).get();
  if (!approver) throw new Error(`${po.poNo}: approver ${policy.approver} is not on staff`);
  const limit = BigInt(policy.per_po_limit);
  const overLimit = BigInt(po.totalUsdc) > limit;
  const why = overLimit
    ? `Over ${policy.name}'s ${usdShort(limit)} limit.`
    : `${reason.replace(`${po.poNo}: `, "").replace(` ${NEEDS_APPROVAL}`, "").replace(/;$/, "")}.`;
  const number = po.poNo.replace(/^PO-/, "");
  const requestText =
    `${policy.name} needs approval: ${po.poNo}, ${usd(po.totalUsdc)} to ${po.vendor.name} for ` +
    `${ctx.summary}. ${why} Reply YES ${number} or NO ${number}.`;
  db.insert(approvals)
    .values({
      poId: po.id,
      approverStaffId: approver.id,
      channel: "sms_sim",
      requestText,
      requestedAt: ctx.now,
      refusedTxId: outcome.id,
    })
    .run();
  setStatus("awaiting_approval");
  const firstName = approver.name.split(" ")[0];
  const sentence = overLimit
    ? `${head} is over ${policy.name}'s ${usd(limit)} limit. Sent to ${firstName} for approval.`
    : `${head} needs ${firstName}'s approval: ${why} Sent to ${firstName}.`;
  return { outcome, status: "awaiting_approval", sentence, requestText };
}
