// Mass balance (FICTIONAL_DATA §15, OPEN_QUESTIONS #27): for every confirmed batch, material
// issued = tablets × tablet weight + QC samples + recorded waste. Whatever does not balance is
// unaccounted material. Kevin flags a batch, and a plant's product over the period, when the
// unaccounted share of what was issued passes the threshold, and says in one line whether a
// unit mix-up could explain it: the gap between the quantities as written and the formula's
// own quantity for the batch is the most a conversion could have moved. `massBalance` is a
// read over the ledger. `proposeWasteCorrections` writes Kevin's proposals for the plant to
// review; an applied one is an addendum to the waste, never an edit of the batch record.

import type { Ledger } from "@day-one/server/ledger/db";
import {
  batchInputs,
  batchRecords,
  discrepancies,
  facilities,
  formulaLines,
  formulas,
  products,
} from "@day-one/server/ledger/schema";
import { QC_SAMPLE_MG } from "@day-one/server/seed/history";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

/** Unaccounted material above this share of what was issued is flagged (§15: 0.5%). */
export const UNACCOUNTED_THRESHOLD_BP = 50;

export interface BatchBalance {
  batchNo: string;
  facility: string;
  product: string;
  completedAt: string | null;
  issuedBase: number;
  tablets: number;
  tabletsBase: number;
  qcBase: number;
  /** Waste as the batch record has it. */
  wasteBase: number;
  /** Waste the plant added on review (applied corrections); the record itself is unchanged. */
  reviewedWasteBase: number;
  unaccountedBase: number;
  /** Unaccounted material as basis points of what was issued. */
  unaccountedBp: number;
  /** How far the issued quantity is from the formula's quantity for the batch's planned size. */
  unitEffectBase: number;
  flagged: boolean;
}

/**
 * Kevin's proposed correction of one batch's recorded waste, stored as the discrepancy's
 * proposal. Applying it records the extra waste beside the batch record; nothing is edited.
 */
export interface WasteCorrection {
  kind: "waste_correction";
  batchNo: string;
  facilityId: number;
  /** Waste to add to what the record says. */
  wasteDeltaBase: number;
  reason: string;
  /** Set by the review: the staff member who applied or dismissed it, and when. */
  reviewedBy?: number;
  reviewedAt?: string;
}

export function isWasteCorrection(p: unknown): p is WasteCorrection {
  return (p as { kind?: unknown } | null)?.kind === "waste_correction";
}

export interface ProductPeriodBalance {
  facility: string;
  facilityName: string;
  product: string;
  from: string | null;
  to: string | null;
  batches: number;
  issuedBase: number;
  reviewedWasteBase: number;
  unaccountedBase: number;
  unaccountedBp: number;
  unitEffectBase: number;
  flagged: boolean;
}

export interface MassBalance {
  batches: BatchBalance[];
  periods: ProductPeriodBalance[];
  /** Kevin's line for each flagged plant and product; empty when everything balances. */
  sentences: string[];
  /** Flagged batches with material missing and no correction proposed yet. */
  unproposed: string[];
}

export interface MassBalanceInput {
  /** Only batches completed on or after this ISO time. */
  from?: string;
  /** Only batches completed on or before this ISO time. */
  to?: string;
  thresholdBp?: number;
}

export function massBalance(db: Ledger, input: MassBalanceInput = {}): MassBalance {
  const threshold = input.thresholdBp ?? UNACCOUNTED_THRESHOLD_BP;
  const where = [eq(batchRecords.status, "confirmed")];
  if (input.from) where.push(gte(batchRecords.completedAt, input.from));
  if (input.to) where.push(lte(batchRecords.completedAt, input.to));

  const rows = db
    .select({
      batch: batchRecords,
      facility: facilities.code,
      facilityName: facilities.name,
      product: products.code,
      tabletWeightMg: products.tabletWeightMg,
      standardTablets: products.standardBatchTablets,
      issuedBase: sql<number>`(select coalesce(sum(${batchInputs.actualBase}), 0) from ${batchInputs} where ${batchInputs.batchId} = ${batchRecords.id})`,
      formulaBase: sql<number>`(select coalesce(sum(${formulaLines.qtyPerBatchBase}), 0) from ${formulaLines} where ${formulaLines.formulaId} = ${batchRecords.formulaId})`,
    })
    .from(batchRecords)
    .innerJoin(facilities, eq(facilities.id, batchRecords.facilityId))
    .innerJoin(products, eq(products.id, batchRecords.productId))
    .leftJoin(formulas, eq(formulas.id, batchRecords.formulaId))
    .where(and(...where))
    .orderBy(asc(batchRecords.completedAt), asc(batchRecords.batchNo))
    .all();

  const corrections = wasteCorrections(db);
  const batches: BatchBalance[] = rows.map((r) => {
    const tablets = r.batch.actualTablets ?? 0;
    const tabletsBase = tablets * r.tabletWeightMg;
    const wasteBase = r.batch.wasteBase ?? 0;
    const reviewedWasteBase = sum(
      corrections.filter((c) => c.status === "adjusted" && c.batchNo === r.batch.batchNo),
      (c) => c.wasteDeltaBase,
    );
    const unaccountedBase =
      r.issuedBase - tabletsBase - QC_SAMPLE_MG - wasteBase - reviewedWasteBase;
    const planned = r.batch.theoreticalTablets ?? r.standardTablets;
    const formulaForBatch = Math.round((r.formulaBase * planned) / r.standardTablets);
    const unaccountedBp = r.issuedBase ? Math.round((unaccountedBase * 10_000) / r.issuedBase) : 0;
    return {
      batchNo: r.batch.batchNo,
      facility: r.facility,
      product: r.product,
      completedAt: r.batch.completedAt,
      issuedBase: r.issuedBase,
      tablets,
      tabletsBase,
      qcBase: QC_SAMPLE_MG,
      wasteBase,
      reviewedWasteBase,
      unaccountedBase,
      unaccountedBp,
      unitEffectBase: Math.abs(r.issuedBase - formulaForBatch),
      flagged: Math.abs(unaccountedBp) > threshold,
    };
  });

  const names = new Map(rows.map((r) => [r.facility, r.facilityName]));
  const groups = new Map<string, BatchBalance[]>();
  for (const b of batches) {
    const key = `${b.facility}\u0000${b.product}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const periods: ProductPeriodBalance[] = [...groups.entries()].map(([key, list]) => {
    const [facility = "", product = ""] = key.split("\u0000");
    const issuedBase = sum(list, (b) => b.issuedBase);
    const unaccountedBase = sum(list, (b) => b.unaccountedBase);
    const unaccountedBp = issuedBase ? Math.round((unaccountedBase * 10_000) / issuedBase) : 0;
    const times = list.map((b) => b.completedAt).filter((t): t is string => t !== null);
    return {
      facility,
      facilityName: names.get(facility) ?? facility,
      product,
      from: times[0] ?? null,
      to: times.at(-1) ?? null,
      batches: list.length,
      issuedBase,
      reviewedWasteBase: sum(list, (b) => b.reviewedWasteBase),
      unaccountedBase,
      unaccountedBp,
      unitEffectBase: sum(list, (b) => b.unitEffectBase),
      flagged: Math.abs(unaccountedBp) > threshold,
    };
  });

  const sentences = [
    ...periods.filter((p) => p.flagged).map((p) => explain(p, periods, batches)),
    ...periods.filter((p) => p.reviewedWasteBase > 0).map(reviewed),
  ];
  const proposed = new Set(corrections.map((c) => c.batchNo));
  const unproposed = batches
    .filter((b) => b.flagged && b.unaccountedBase > 0 && !proposed.has(b.batchNo))
    .map((b) => b.batchNo);
  return { batches, periods, sentences, unproposed };
}

export interface ProposedCorrection {
  id: number;
  batchNo: string;
  facility: string;
  wasteDeltaBase: number;
  sentence: string;
}

/**
 * For each flagged batch with material missing and no proposal yet, Kevin proposes recording
 * the missing material as waste, for the batch's plant to apply or dismiss (`reviewDiscrepancy`).
 * Never twice for a batch, whatever became of the first proposal.
 */
export function proposeWasteCorrections(db: Ledger): ProposedCorrection[] {
  const balance = massBalance(db);
  const out: ProposedCorrection[] = [];
  for (const batchNo of balance.unproposed) {
    const b = balance.batches.find((x) => x.batchNo === batchNo) as BatchBalance;
    const plant = db
      .select({ id: facilities.id, name: facilities.name })
      .from(facilities)
      .where(eq(facilities.code, b.facility))
      .get();
    if (!plant) continue;
    const correction: WasteCorrection = {
      kind: "waste_correction",
      batchNo,
      facilityId: plant.id,
      wasteDeltaBase: b.unaccountedBase,
      reason:
        `${batchNo}: ${kg(b.unaccountedBase)} issued but in neither the tablets, the QC samples ` +
        "nor the recorded waste, recorded as waste on review; the batch record stays as written.",
    };
    const sentence =
      `${batchNo} at ${shortName(plant.name)}: ${kg(b.issuedBase)} issued, ${kg(b.tabletsBase)} in ` +
      `tablets, ${kg(b.qcBase)} in QC samples and ${kg(b.wasteBase)} written as waste, so ` +
      `${kg(b.unaccountedBase)} is missing. Proposed for Plant ${b.facility} to review: record it ` +
      "as waste beside the batch record, which stays as written.";
    const row = db
      .insert(discrepancies)
      .values({
        kind: "unrecorded_consumption",
        facilityId: plant.id,
        lotId: null,
        expectedBase: b.wasteBase + b.unaccountedBase,
        observedBase: b.wasteBase,
        detectedBy: "kevin",
        status: "proposed_adjustment",
        explanation: sentence,
        proposedEventJson: JSON.stringify(correction),
      })
      .returning({ id: discrepancies.id })
      .get();
    out.push({
      id: row.id,
      batchNo,
      facility: b.facility,
      wasteDeltaBase: b.unaccountedBase,
      sentence,
    });
  }
  return out;
}

/** Every waste correction Kevin proposed, with what became of it. */
function wasteCorrections(db: Ledger) {
  return db
    .select({ status: discrepancies.status, json: discrepancies.proposedEventJson })
    .from(discrepancies)
    .where(eq(discrepancies.kind, "unrecorded_consumption"))
    .all()
    .map((r) => ({ status: r.status, proposal: JSON.parse(r.json ?? "null") as unknown }))
    .filter((r): r is { status: typeof r.status; proposal: WasteCorrection } =>
      isWasteCorrection(r.proposal),
    )
    .map((r) => ({ status: r.status, ...r.proposal }));
}

/** Kevin's line once a plant has recorded the missing material as waste on review. */
function reviewed(p: ProductPeriodBalance) {
  return (
    `${p.product} at ${shortName(p.facilityName)}: Plant ${p.facility} recorded ` +
    `${kg(p.reviewedWasteBase)} more waste on review. The batch records stay as written; ` +
    "the cost per bottle now carries it."
  );
}

/** Kevin's one line for a flagged plant and product (FICTIONAL_DATA §15 "What Kevin shows"). */
function explain(
  p: ProductPeriodBalance,
  periods: ProductPeriodBalance[],
  batches: BatchBalance[],
) {
  const here = shortName(p.facilityName);
  const parts = [
    `${p.product} at ${here}: ${kg(p.unaccountedBase)} of material issued over ${count(p.batches)} ` +
      `${p.batches === 1 ? "batch" : "batches"} is in neither the tablets nor the recorded waste ` +
      `(${(p.unaccountedBp / 100).toFixed(2)}%).`,
  ];
  for (const other of periods) {
    if (other.product !== p.product || other.facility === p.facility || other.flagged) continue;
    const perBatch = batches
      .filter((b) => b.facility === other.facility && b.product === other.product)
      .map((b) => Math.abs(b.unaccountedBase));
    const toTheGram = perBatch.every((u) => u < 1_000);
    parts.push(
      toTheGram
        ? `${shortName(other.facilityName)} balances to the gram.`
        : `${shortName(other.facilityName)} balances within ${(Math.abs(other.unaccountedBp) / 100).toFixed(2)}%.`,
    );
  }
  parts.push(`Rounding between units explains ${kg(p.unitEffectBase)} of it.`);
  if (p.unaccountedBase > 0) {
    parts.push(
      `${here}'s waste looks under-recorded, which also makes its cost per bottle look lower.`,
    );
  }
  return parts.join(" ");
}

function sum<T>(list: T[], of: (t: T) => number) {
  return list.reduce((s, t) => s + of(t), 0);
}

/** `115.2 kg`, `0.005 kg`: one decimal for amounts people argue about, three for crumbs. */
function kg(base: number) {
  const value = base / 1_000_000;
  const digits = Math.abs(value) >= 1 ? 1 : 3;
  return `${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} kg`;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
function count(n: number) {
  return WORDS[n] ?? String(n);
}

/** The plant as staff say it: "Riverside", "Hollow Pine", "Lakeview". */
function shortName(name: string) {
  return name.replace(/^Acme\s+/, "").replace(/\s+Tablet Co\.$/, "");
}
