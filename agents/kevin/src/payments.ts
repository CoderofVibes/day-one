// A supplier says a payment failed and asks Kevin to pay again. Kevin has no way to: his key
// can only submit POs and anchor records, and the contract refuses a PO id it has seen before.
// He answers from the chain, never from the message: `get_po` says what the escrow holds and
// whether it paid, and a request to pay a different account is flagged for Marcy.

import type { ChainClient } from "@day-one/server/chain/client";
import { formatUsd } from "@day-one/server/money";

const usd = (units: string) => formatUsd(BigInt(units));
const ACCOUNT = /\b[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\.(?:testnet|near)\b/g;

/** `get_po` as the spend-policy contract returns it (the fields Kevin reads). */
export interface PoView {
  po_id: string;
  supplier: string;
  amount: string;
  status:
    | "Funded"
    | "Accepted"
    | "Shipped"
    | "Received"
    | "Paying"
    | "Released"
    | "Refunded"
    | "Cancelled";
}

export interface PaymentClaim {
  poNo: string;
  /** Who sent the message, as the channel reports it. */
  from: string;
  text: string;
}

export interface ClaimAnswer {
  poStatus: PoView["status"] | null;
  /** Always none: a message never makes Kevin pay. */
  action: "none";
  flags: string[];
  /** The reply, which also goes to Marcy. */
  sentence: string;
}

export async function answerPaymentClaim(
  chain: ChainClient,
  policyContract: string,
  claim: PaymentClaim,
): Promise<ClaimAnswer> {
  const po = await chain.view<PoView | null>({
    contractId: policyContract,
    method: "get_po",
    args: { po_id: claim.poNo },
  });
  const flags = [...new Set(claim.text.match(ACCOUNT) ?? [])]
    .filter((account) => account !== po?.supplier)
    .map((account) => `the message asks for payment to ${account}, not the PO's supplier`);
  if (po && claim.from !== po.supplier) {
    flags.push(`the message came from ${claim.from}, not ${po.supplier}`);
  }
  const state = !po
    ? `There is no ${claim.poNo} on the plant's purchasing contract, so nothing is owed.`
    : po.status === "Released"
      ? `${po.po_id} was paid on QC release: ${usd(po.amount)} to ${po.supplier}, recorded on chain.`
      : po.status === "Cancelled" || po.status === "Refunded"
        ? `${po.po_id} was ${po.status.toLowerCase()}; its ${usd(po.amount)} went back to the plant budget, so nothing is owed.`
        : `${po.po_id} is not due yet: the escrow holds ${usd(po.amount)} for ${po.supplier} and pays it on QC release.`;
  const sentence =
    `${state} Kevin sent no payment.` +
    (flags.length ? ` Flagged for Marcy: ${flags.join("; ")}.` : "");
  return { poStatus: po?.status ?? null, action: "none", flags, sentence };
}
