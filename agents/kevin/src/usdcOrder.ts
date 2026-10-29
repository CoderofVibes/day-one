// PO-1047 in real Circle testnet USDC (DEMO_SCRIPT step 13, CONTRACTS.md §2): the same
// spend-policy wasm as the main deployment, initialized with Circle's USDC as its token, runs one
// small order end to end. Kevin submits it within his limits and the escrow is funded, Bayfront
// accepts and ships from its own account, Tommy's receipt and Priya's QC release are relayed,
// and the release pays Bayfront in USDC. Every step goes through the chain client, so the run
// records on testnet and replays from its fixture with no keys (`npm run usdc`).

import { canonicalJson, sha256Hex } from "@day-one/server/canonical";
import type { ChainClient, ChainTxKind, LoggedOutcome } from "@day-one/server/chain/client";
import { formatUsd } from "@day-one/server/money";

/** Circle's USDC on NEAR testnet (research 01). */
export const USDC_TESTNET = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";

export interface UsdcOrderSpec {
  poId: string;
  /** The USDC deployment of spend-policy. */
  policy: string;
  token: string;
  kevin: string;
  receiving: string;
  qc: string;
  supplier: string;
  supplierName: string;
  category: string;
  /** What staff read, e.g. "pH buffer ×2". */
  summary: string;
  lines: { material: string; qty: number; unitPriceUnits: string }[];
  supplierLot: string;
}

/** FICTIONAL_DATA §9: BUF ×2 at $9.50 from Bayfront Lab Supply, $19.00. */
export function po1047(root = "acme-holdings.testnet"): UsdcOrderSpec {
  const plantB = `plant-b.${root}`;
  return {
    poId: "PO-1047",
    policy: `spend-policy-usdc.${root}`,
    token: USDC_TESTNET,
    kevin: `kevin.${plantB}`,
    receiving: `receiving.${plantB}`,
    qc: `qc.${plantB}`,
    supplier: "bayfront-labsupply.testnet",
    supplierName: "Bayfront Lab Supply",
    category: "lab_chemical",
    summary: "pH buffer ×2",
    lines: [{ material: "BUF", qty: 2, unitPriceUnits: "9500000" }],
    supplierLot: "BLS-BUF-2611-07",
  };
}

export function orderTotal(spec: UsdcOrderSpec) {
  return spec.lines.reduce((sum, l) => sum + BigInt(l.unitPriceUnits) * BigInt(l.qty), 0n);
}

/** The PO's terms fingerprinted the way Kevin's drafts are: canonical JSON, SHA-256. */
export function usdcPoHash(spec: UsdcOrderSpec) {
  return sha256Hex(
    canonicalJson({
      po_no: spec.poId,
      supplier: spec.supplier,
      category: spec.category,
      lines: spec.lines,
      total: orderTotal(spec).toString(),
      token: spec.token,
    }),
  );
}

export interface UsdcOrderResult {
  ok: boolean;
  /** What staff see: one line. */
  staffLine: string;
  /** Behind the curtain: one line per call, then the balance checks. */
  chainLines: string[];
  steps: { step: string; status: string; txHash: string | null; explorerUrl: string | null }[];
  amount: string;
  supplierBefore: string;
  supplierAfter: string;
  poStatus: string | null;
}

interface Budget {
  budget: string;
  escrowed: string;
}

const usdc = (units: bigint) => `${formatUsd(units).slice(1)} USDC`;

export async function runUsdcOrder(
  chain: ChainClient,
  spec: UsdcOrderSpec,
): Promise<UsdcOrderResult> {
  const amount = orderTotal(spec);
  const balanceOf = async (account_id: string) =>
    BigInt(
      await chain.view<string>({
        contractId: spec.token,
        method: "ft_balance_of",
        args: { account_id },
      }),
    );
  const budget = () => chain.view<Budget>({ contractId: spec.policy, method: "get_budget" });

  const supplierBefore = await balanceOf(spec.supplier);
  const budgetBefore = await budget();
  const steps: UsdcOrderResult["steps"] = [];
  const chainLines: string[] = [];
  const record = (step: string, o: LoggedOutcome) => {
    steps.push({ step, status: o.status, txHash: o.txHash, explorerUrl: o.explorerUrl });
    const why = o.errorMessage ? ` "${o.errorMessage}"` : "";
    chainLines.push(`chain: ${step}: ${o.status}${why}${o.explorerUrl ? ` ${o.explorerUrl}` : ""}`);
    return o.status === "success";
  };
  const send = (
    step: string,
    kind: ChainTxKind,
    signerId: string,
    args: Record<string, unknown>,
    viaRelayer = false,
  ) =>
    chain
      .call({
        kind,
        signerId,
        receiverId: spec.policy,
        method: kind,
        args,
        viaRelayer,
        token: spec.token,
      })
      .then((o) => record(step, o));

  const ok =
    (await send(`${spec.kevin.split(".")[0]} submit_po ${spec.poId}`, "submit_po", spec.kevin, {
      po_id: spec.poId,
      supplier: spec.supplier,
      amount: amount.toString(),
      category: spec.category,
      po_hash: usdcPoHash(spec),
    })) &&
    (await send("supplier accept_po", "accept_po", spec.supplier, { po_id: spec.poId })) &&
    (await send("supplier mark_shipped", "mark_shipped", spec.supplier, {
      po_id: spec.poId,
      supplier_lot: spec.supplierLot,
    })) &&
    (await send(
      "confirm_receipt (relayed)",
      "confirm_receipt",
      spec.receiving,
      { po_id: spec.poId },
      true,
    )) &&
    (await send("qc_release (relayed)", "qc_release", spec.qc, { po_id: spec.poId }, true));

  const po = await chain.view<{ status: string } | null>({
    contractId: spec.policy,
    method: "get_po",
    args: { po_id: spec.poId },
  });
  const supplierAfter = await balanceOf(spec.supplier);
  const budgetAfter = await budget();
  const paid = supplierAfter - supplierBefore === amount;
  const books =
    BigInt(budgetAfter.budget) === BigInt(budgetBefore.budget) - amount &&
    BigInt(budgetAfter.escrowed) === BigInt(budgetBefore.escrowed);
  const released = po?.status === "Released";
  chainLines.push(
    `chain: ${ok && paid ? "full cycle" : "stopped"} on the USDC deployment ${spec.policy}, ` +
      `${usdc(amount)} → ${spec.supplier} (${steps.length} txs)`,
    `chain: ${spec.supplier} held ${usdc(supplierBefore)}, now ${usdc(supplierAfter)}` +
      (paid ? ` (+${usdc(amount)})` : " (NOT PAID)"),
    `chain: budget ${usdc(BigInt(budgetBefore.budget))} → ${usdc(BigInt(budgetAfter.budget))}, ` +
      `escrowed ${usdc(BigInt(budgetAfter.escrowed))}, ${spec.poId} ${po?.status ?? "missing"}`,
  );
  const all = ok && paid && books && released;
  return {
    ok: all,
    staffLine: all
      ? `${spec.poId} (${spec.summary}, ${formatUsd(amount)}) settled in Circle USDC.`
      : `${spec.poId} (${spec.summary}, ${formatUsd(amount)}) did not settle.`,
    chainLines,
    steps,
    amount: amount.toString(),
    supplierBefore: supplierBefore.toString(),
    supplierAfter: supplierAfter.toString(),
    poStatus: po?.status ?? null,
  };
}
