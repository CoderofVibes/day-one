// The per-PO arguments a contract with CONTRACTS.md §11 takes, worked out when Kevin submits:
// the ordered quantity of a one-line PO (E: the release pays for what reached stock) and, above
// HQ's threshold, Kevin's decision signed in the enclave (F). Off until the deployed contract has
// the features (config/testnet-accounts.json "contractFeatures"), so recorded runs replay as
// they were recorded.

import type { Ledger } from "@day-one/server/ledger/db";
import { forecasts, materials, poLines, quotes, vendors } from "@day-one/server/ledger/schema";
import type { LlmClient } from "@day-one/server/llm/types";
import { formatUsd } from "@day-one/server/money";
import { desc, eq } from "drizzle-orm";
import { type Decision, decideOnPo, type SignatureSource } from "./decision.ts";
import { amount } from "./forecast.ts";
import type { SubmitContext, SubmittablePo } from "./submit.ts";

export interface ContractFeatures {
  /** §11 E: submit sends qty, receipts send what reached stock, Kevin records invoices. */
  receiptSettlement?: boolean;
  /** §11 F: POs above the threshold carry an enclave-signed decision. */
  signedDecisions?: boolean;
}

export interface ExtrasOptions {
  features: ContractFeatures;
  llm?: LlmClient;
  signatures?: SignatureSource | null;
  /** HQ's threshold in token base units (6 decimals): POs above it need a signed decision. */
  signedAboveUsdc?: number;
  /** Told about every decision Kevin asked for, for the run's transcript and the curtain. */
  onDecision?: (po: SubmittablePo, decision: Decision) => void;
}

const usd = (units: number) => formatUsd(BigInt(units));

/** The facts Kevin gives the attested model about a PO, from the ledger. */
function factsOf(db: Ledger, po: SubmittablePo) {
  const lines = db
    .select({ line: poLines, material: materials })
    .from(poLines)
    .innerJoin(materials, eq(materials.id, poLines.materialId))
    .where(eq(poLines.poId, po.id))
    .all();
  const what = lines
    .map((l) => `${amount(l.line.qtyBase, l.material.dimension)} ${l.material.name.toLowerCase()}`)
    .join(", ");
  const unit = (dim: string) => (dim === "mass" ? "kg" : "each");
  const price = `${usd(po.totalUsdc)} (${lines.map((l) => `${usd(l.line.unitPriceUsdc)}/${unit(l.material.dimension)}`).join(", ")})`;
  const first = lines[0];
  const forecast = first
    ? db
        .select()
        .from(forecasts)
        .where(eq(forecasts.materialId, first.material.id))
        .orderBy(desc(forecasts.id))
        .get()
    : undefined;
  const plan = forecast
    ? `need ${amount(forecast.projectedNeedBase, first?.material.dimension ?? "mass")} over ${forecast.horizonDays} days, ${amount(forecast.onHandBase, first?.material.dimension ?? "mass")} on hand, ${amount(forecast.onOrderBase, first?.material.dimension ?? "mass")} on order, short ${amount(forecast.shortfallBase, first?.material.dimension ?? "mass")}`
    : "no forecast on record";
  const quoteIds = lines.map((l) => l.line.quoteId).filter((q): q is number => q !== null);
  const quoted = quoteIds.length
    ? db
        .select({ quote: quotes, vendor: vendors })
        .from(quotes)
        .innerJoin(vendors, eq(vendors.id, quotes.vendorId))
        .where(
          eq(
            quotes.rfqId,
            db
              .select()
              .from(quotes)
              .where(eq(quotes.id, quoteIds[0] as number))
              .get()?.rfqId ?? -1,
          ),
        )
        .all()
        .map(
          (q) =>
            `${q.vendor.name} ${usd(q.quote.unitPriceUsdc)}, ${q.quote.leadTimeDays} days, ${q.quote.status}${q.quote.exclusionReason ? ` (${q.quote.exclusionReason})` : ""}`,
        )
        .join("; ")
    : "no RFQ (a reorder from the vendor on file)";
  return {
    poNo: po.poNo,
    poHash: po.poHash ?? "",
    supplier: po.vendor.name,
    what,
    price,
    plan,
    quotes: quoted,
    oneLineQty: lines.length === 1 ? first?.line.qtyBase : undefined,
  };
}

/** The `extras` hook for SubmitContext; decisions are asked once per PO hash and reused. */
export function contractExtras(db: Ledger, opts: ExtrasOptions): SubmitContext["extras"] {
  const asked = new Map<string, Decision>();
  return async (po) => {
    const out: Awaited<ReturnType<NonNullable<SubmitContext["extras"]>>> = {};
    const facts = factsOf(db, po);
    if (opts.features.receiptSettlement && facts.oneLineQty !== undefined) {
      out.qtyBase = facts.oneLineQty;
    }
    const above = opts.signedAboveUsdc;
    if (opts.features.signedDecisions && opts.llm && above !== undefined && po.totalUsdc > above) {
      const key = po.poHash ?? po.poNo;
      let decision = asked.get(key);
      if (!decision) {
        const { oneLineQty: _q, ...asks } = facts;
        decision = await decideOnPo(opts.llm, opts.signatures ?? null, asks);
        asked.set(key, decision);
        opts.onDecision?.(po, decision);
      }
      if (decision.approved && decision.signed) out.decision = decision.signed;
    }
    return out;
  };
}
