// The director's text reply (SPEC step 5). "YES 1042" becomes `approve_po`, signed with the
// director's own key and paid for by the relayer, carrying the exact PO terms and the refused
// transaction; then Kevin retries the identical `submit_po`, which the contract now funds.
// A reply that does not name a waiting PO changes nothing and asks again. Only the approver
// the request went to can answer it.

import type { ChainClient, LoggedOutcome } from "@day-one/server/chain/client";
import type { Ledger } from "@day-one/server/ledger/db";
import { approvals, chainTx, purchaseOrders, staff, vendors } from "@day-one/server/ledger/schema";
import { and, eq } from "drizzle-orm";
import { type SubmitContext, type SubmitResult, type SubmittablePo, submitPo } from "./submit.ts";

const REPLY = /^\s*(YES|NO)\s+(?:PO-)?(\d+)\s*$/i;

export interface ReplyResult {
  handled: boolean;
  /** What Kevin texts back or shows staff. */
  sentences: string[];
  approval?: LoggedOutcome;
  retry?: SubmitResult;
}

/** Loads a PO back from the ledger in the shape `submitPo` sends. */
export function loadPo(db: Ledger, poId: number): SubmittablePo {
  const row = db
    .select({ po: purchaseOrders, vendor: vendors })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(eq(purchaseOrders.id, poId))
    .get();
  if (!row?.po.poHash) throw new Error(`PO ${poId} has no po_hash`);
  return {
    id: row.po.id,
    poNo: row.po.poNo,
    vendor: { code: row.vendor.code, name: row.vendor.name, account: row.vendor.nearAccountId },
    category: row.po.category,
    totalUsdc: row.po.totalUsdc,
    poHash: row.po.poHash,
  };
}

export async function handleApprovalReply(
  db: Ledger,
  chain: ChainClient,
  reply: { fromStaffId: number; text: string },
  ctx: Omit<SubmitContext, "summary">,
): Promise<ReplyResult> {
  const waiting = db
    .select({ approval: approvals, po: purchaseOrders })
    .from(approvals)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, approvals.poId))
    .where(and(eq(approvals.approverStaffId, reply.fromStaffId), eq(approvals.state, "requested")))
    .all();
  const match = REPLY.exec(reply.text);
  const target = match && waiting.find((w) => w.po.poNo === `PO-${match[2]}`);
  if (!match || !target) {
    const options = waiting
      .map((w) => w.po.poNo.replace(/^PO-/, ""))
      .map((n) => `YES ${n} or NO ${n}`)
      .join(", or ");
    return {
      handled: false,
      sentences: [
        waiting.length
          ? `Please reply ${options} so I know which PO you mean.`
          : "There is nothing waiting for your approval.",
      ],
    };
  }

  const approver = db.select().from(staff).where(eq(staff.id, reply.fromStaffId)).get();
  if (!approver?.nearAccountId) throw new Error(`staff ${reply.fromStaffId} has no NEAR account`);
  const po = loadPo(db, target.po.id);
  if (!po.vendor.account) throw new Error(`${po.poNo}: vendor has no NEAR account`);
  const refusedTx = target.approval.refusedTxId
    ? db.select().from(chainTx).where(eq(chainTx.id, target.approval.refusedTxId)).get()
    : undefined;
  const yes = match[1]?.toUpperCase() === "YES";

  const outcome = await chain.call(
    yes
      ? {
          kind: "approve_po",
          signerId: approver.nearAccountId,
          predecessorId: approver.nearAccountId,
          receiverId: ctx.policyContract,
          method: "approve_po",
          args: {
            po_id: po.poNo,
            supplier: po.vendor.account,
            amount: String(po.totalUsdc),
            category: po.category,
            po_hash: po.poHash,
            refused_tx: refusedTx?.txHash ?? "",
          },
          viaRelayer: true,
          related: { type: "purchase_order", id: po.id },
        }
      : {
          kind: "reject_po",
          signerId: approver.nearAccountId,
          predecessorId: approver.nearAccountId,
          receiverId: ctx.policyContract,
          method: "reject_po",
          args: { po_id: po.poNo, reason: `Declined by ${approver.name} by text.` },
          viaRelayer: true,
          related: { type: "purchase_order", id: po.id },
        },
  );
  if (outcome.status !== "success") {
    return {
      handled: true,
      approval: outcome,
      sentences: [`Your reply for ${po.poNo} did not go through; please try again in a minute.`],
    };
  }
  db.update(approvals)
    .set({
      responseText: reply.text.trim(),
      state: yes ? "approved" : "declined",
      respondedAt: ctx.now,
      approveTxId: yes ? outcome.id : null,
    })
    .where(eq(approvals.id, target.approval.id))
    .run();
  if (!yes) {
    // The PO stays waiting; Kevin tells the purchaser (SPEC step 5).
    return {
      handled: true,
      approval: outcome,
      sentences: [`Declined by ${approver.name}. ${po.poNo} is on hold; Kevin told Ray.`],
    };
  }

  const retry = await submitPo(db, chain, po, { ...ctx, summary: "" });
  const sentences = [`Approved by ${approver.name}.`];
  sentences.push(
    retry.status === "funded"
      ? `${po.poNo} sent to ${po.vendor.name}. Funds held until delivery passes QC.`
      : retry.sentence,
  );
  return { handled: true, approval: outcome, retry, sentences };
}
