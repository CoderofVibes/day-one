// Mass balance (FICTIONAL_DATA §15, OPEN_QUESTIONS #27): for every confirmed batch, material
// issued = tablets × tablet weight + QC samples + recorded waste. Whatever does not balance is
// unaccounted material. Kevin flags a batch, and a plant's product over the period, when the
// unaccounted share of what was issued passes the threshold, and says in one line whether a
// unit mix-up could explain it: the gap between the quantities as written and the formula's
// own quantity for the batch is the most a conversion could have moved. Everything here is a
// read over the ledger; nothing is adjusted without a person.

import type { Ledger } from "@day-one/server/ledger/db";
import {
  batchInputs,
  batchRecords,
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
  wasteBase: number;
  unaccountedBase: number;
  /** Unaccounted material as basis points of what was issued. */
  unaccountedBp: number;
  /** How far the issued quantity is from the formula's quantity for the batch's planned size. */
  unitEffectBase: number;
  flagged: boolean;
}

export interface ProductPeriodBalance {
  facility: string;
  facilityName: string;
  product: string;
  from: string | null;
  to: string | null;
  batches: number;
  issuedBase: number;
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

  const batches: BatchBalance[] = rows.map((r) => {
    const tablets = r.batch.actualTablets ?? 0;
    const tabletsBase = tablets * r.tabletWeightMg;
    const wasteBase = r.batch.wasteBase ?? 0;
    const unaccountedBase = r.issuedBase - tabletsBase - QC_SAMPLE_MG - wasteBase;
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
      unaccountedBase,
      unaccountedBp,
      unitEffectBase: sum(list, (b) => b.unitEffectBase),
      flagged: Math.abs(unaccountedBp) > threshold,
    };
  });

  const sentences = periods.filter((p) => p.flagged).map((p) => explain(p, periods, batches));
  return { batches, periods, sentences };
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
