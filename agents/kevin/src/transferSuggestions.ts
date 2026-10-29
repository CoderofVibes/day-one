// Before you buy, look at the other plants (FEATURES_V2 §3, forecast side). For each material,
// Kevin projects every plant over the horizon. A plant is short when stock on hand and on order
// minus the planned need falls below the reorder point; another plant has surplus when its usable
// stock minus its own need stays above the reorder point. Kevin proposes moving the smaller of
// the two, from released lots that do not expire inside the horizon, earliest expiry first.
// Nothing moves until a person approves: approval books the lots out of the sending plant as
// ordinary transfers (in transit, counted as on order at the receiving plant), receiving books
// them in, and the discrepancy check looks at them like any other transfer. A dismissed move is
// not proposed again while the receiving plant's shortfall stays the same.

import type { Ledger } from "@day-one/server/ledger/db";
import { appendLotEvent, type LedgerDb } from "@day-one/server/ledger/events";
import {
  facilities,
  lotBalances,
  lots,
  materials,
  poLines,
  purchaseOrders,
  transferDismissals,
  transfers,
} from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { checkTransfers, type TransferDiscrepancy } from "./discrepancies.ts";
import { amount, DEFAULT_HORIZON_DAYS, projectMaterial } from "./forecast.ts";

/** PO states whose price was really paid or committed. */
const PRICED_PO = ["funded", "shipped", "received", "released", "paid"] as const;

export interface TransferLot {
  lotCode: string;
  qtyBase: number;
  expiresOn: string | null;
}

export interface TransferSuggestion {
  /** `<material>:<from>-<to>`, what a person approves or dismisses. */
  key: string;
  material: string;
  materialName: string;
  dimension: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  qtyBase: number;
  lots: TransferLot[];
  /** What the receiving plant lacks to stay at its reorder point over the horizon. */
  shortBase: number;
  /** What the sending plant holds above its own need and reorder point. */
  surplusBase: number;
  /** The reorder Kevin would otherwise recommend at the receiving plant, if any. */
  avoidedOrderBase: number | null;
  /** The moved quantity at the last price paid, in micro-USDC; null with no price history. */
  valueUsdc: number | null;
  sentence: string;
}

export interface SuggestInput {
  now: string;
  horizonDays?: number;
  /** One material only; every material by default. */
  material?: string;
}

/** Last price paid per base unit, from the newest priced PO line of the material. */
function lastPrice(db: Ledger, materialId: number) {
  const row = db
    .select({ qty: poLines.qtyBase, ext: poLines.extendedUsdc })
    .from(poLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
    .where(
      and(
        eq(poLines.materialId, materialId),
        sql`${purchaseOrders.status} in (${sql.join(
          PRICED_PO.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(desc(purchaseOrders.id))
    .get();
  return row && row.qty > 0 ? row.ext / row.qty : null;
}

export function suggestTransfers(db: Ledger, input: SuggestInput): TransferSuggestion[] {
  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const until = new Date(Date.parse(input.now) + horizonDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const plants = db
    .select()
    .from(facilities)
    .where(sql`${facilities.role} <> 'hq'`)
    .orderBy(asc(facilities.code))
    .all();
  const mats = db
    .select()
    .from(materials)
    .where(input.material ? eq(materials.code, input.material) : undefined)
    .orderBy(asc(materials.code))
    .all();

  const out: TransferSuggestion[] = [];
  for (const m of mats) {
    const reorderPoint = m.reorderPointBase ?? 0;
    const positions = plants.map((p) => {
      const f = projectMaterial(db, {
        facility: p.code,
        material: m.code,
        now: input.now,
        horizonDays,
      });
      // Movable: released lots at this plant that outlast the horizon. A lot in use is on the
      // line; quarantined and received lots wait for QC.
      const movable = db
        .select({
          lotCode: lots.lotCode,
          qtyBase: lotBalances.onHandBase,
          expiresOn: lots.expiresOn,
        })
        .from(lotBalances)
        .innerJoin(lots, eq(lots.id, lotBalances.lotId))
        .where(
          and(
            eq(lots.materialId, m.id),
            eq(lotBalances.facilityId, p.id),
            eq(lots.state, "released"),
            gt(lotBalances.onHandBase, 0),
            sql`(${lots.expiresOn} is null or ${lots.expiresOn} > ${until})`,
          ),
        )
        .orderBy(sql`${lots.expiresOn} is null`, asc(lots.expiresOn), asc(lots.lotCode))
        .all();
      const movableBase = movable.reduce((s, l) => s + l.qtyBase, 0);
      const after = f.onHandBase + f.onOrderBase - f.needBase;
      return {
        plant: p,
        forecast: f,
        movable,
        shortBase: Math.max(0, reorderPoint - after),
        // Surplus counts usable stock only: what is on order is not there to send.
        surplusBase: Math.max(0, Math.min(f.onHandBase - f.needBase - reorderPoint, movableBase)),
      };
    });

    // Plants that stock nothing of it and need nothing are not short of it.
    const short = positions.filter(
      (p) => p.shortBase > 0 && (p.forecast.onHandBase > 0 || p.forecast.needBase > 0),
    );
    const price = short.length ? lastPrice(db, m.id) : null;
    for (const to of short) {
      let remaining = to.shortBase;
      for (const from of positions) {
        if (remaining <= 0) break;
        if (from === to || from.surplusBase <= 0) continue;
        if (dismissed(db, m.id, from.plant.id, to.plant.id, to.shortBase)) continue;
        const qtyBase = Math.min(remaining, from.surplusBase);
        const picked: TransferLot[] = [];
        let left = qtyBase;
        for (const lot of from.movable) {
          if (left <= 0) break;
          const take = Math.min(left, lot.qtyBase);
          picked.push({ lotCode: lot.lotCode, qtyBase: take, expiresOn: lot.expiresOn });
          lot.qtyBase -= take;
          left -= take;
        }
        from.surplusBase -= qtyBase;
        remaining -= qtyBase;

        const covered = remaining <= 0;
        const avoidedOrderBase = covered ? to.forecast.recommendQtyBase : null;
        // Rounded to the cent, the smallest amount the books show.
        const valueUsdc = price === null ? null : Math.round((qtyBase * price) / 10_000) * 10_000;
        const fmt = (base: number) => amount(base, m.dimension);
        const sentence = [
          `Before you buy: ${from.plant.name} has ${fmt(from.surplusBase + qtyBase)} of ${m.name} (${m.code}) above its own need and reorder point.`,
          `Moving ${fmt(qtyBase)} (${picked.map((l) => l.lotCode).join(", ")}) to ${to.plant.name} ${
            covered
              ? "keeps it at its reorder point"
              : `covers ${fmt(qtyBase)} of the ${fmt(to.shortBase)} it lacks`
          }${avoidedOrderBase ? ` instead of ordering ${fmt(avoidedOrderBase)}` : ""}.`,
          valueUsdc === null
            ? ""
            : `That is about ${formatUsd(BigInt(valueUsdc))} of stock at the last price paid.`,
        ]
          .filter(Boolean)
          .join(" ");
        out.push({
          key: `${m.code}:${from.plant.code}-${to.plant.code}`,
          material: m.code,
          materialName: m.name,
          dimension: m.dimension,
          from: from.plant.code,
          fromName: from.plant.name,
          to: to.plant.code,
          toName: to.plant.name,
          qtyBase,
          lots: picked,
          shortBase: to.shortBase,
          surplusBase: from.surplusBase + qtyBase,
          avoidedOrderBase,
          valueUsdc,
          sentence,
        });
      }
    }
  }
  return out;
}

function dismissed(db: Ledger, materialId: number, from: number, to: number, shortBase: number) {
  return Boolean(
    db
      .select({ id: transferDismissals.id })
      .from(transferDismissals)
      .where(
        and(
          eq(transferDismissals.materialId, materialId),
          eq(transferDismissals.fromFacilityId, from),
          eq(transferDismissals.toFacilityId, to),
          eq(transferDismissals.shortBase, shortBase),
        ),
      )
      .get(),
  );
}

export interface DecisionInput {
  /** The person deciding; Kevin only proposes. */
  staffId: number;
  now: string;
  horizonDays?: number;
}

/** The proposal as Kevin makes it right now; a stale key (already moved, or dismissed) throws. */
function current(db: Ledger, key: string, input: DecisionInput) {
  const material = key.split(":")[0];
  const found = suggestTransfers(db, {
    now: input.now,
    ...(input.horizonDays ? { horizonDays: input.horizonDays } : {}),
    ...(material ? { material } : {}),
  }).find((s) => s.key === key);
  if (!found) throw new Error(`no transfer proposal ${key} right now`);
  return found;
}

function facilityId(db: Ledger, code: string) {
  const row = db.select({ id: facilities.id }).from(facilities).where(eq(facilities.code, code));
  const id = row.get()?.id;
  if (id === undefined) throw new Error(`facility ${code} does not exist`);
  return id;
}

/** `TR-C-B-261116`, then `-2`, `-3` for more lots or moves the same day. */
function nextTransferNo(db: LedgerDb, from: string, to: string, now: string) {
  const base = `TR-${from}-${to}-${now.slice(2, 10).replaceAll("-", "")}`;
  for (let n = 1; ; n++) {
    const no = n === 1 ? base : `${base}-${n}`;
    if (!db.select().from(transfers).where(eq(transfers.transferNo, no)).get()) return no;
  }
}

export interface ApprovedTransfer {
  transferNo: string;
  lotCode: string;
  qtyBase: number;
}

/**
 * A person approves Kevin's proposal: each picked lot leaves the sending plant as a transfer in
 * transit (one `transfer_out` by the approver). The receiving plant books it in on arrival.
 */
export function approveTransfer(db: Ledger, key: string, input: DecisionInput) {
  const s = current(db, key, input);
  const from = facilityId(db, s.from);
  const to = facilityId(db, s.to);
  const moved = db.transaction((tx) =>
    s.lots.map((picked): ApprovedTransfer => {
      const lot = tx.select().from(lots).where(eq(lots.lotCode, picked.lotCode)).get();
      if (!lot) throw new Error(`lot ${picked.lotCode} does not exist`);
      const transferNo = nextTransferNo(tx, s.from, s.to, input.now);
      const row = tx
        .insert(transfers)
        .values({
          transferNo,
          lotId: lot.id,
          fromFacilityId: from,
          toFacilityId: to,
          qtyShippedBase: picked.qtyBase,
          state: "in_transit",
        })
        .returning({ id: transfers.id })
        .get();
      const event = appendLotEvent(tx, {
        lotId: lot.id,
        kind: "transfer_out",
        qtyDeltaBase: -picked.qtyBase,
        facilityId: from,
        refType: "transfer",
        refId: row.id,
        actorType: "staff",
        actorId: input.staffId,
        reason: `${transferNo}: Kevin's proposal approved, to ${s.toName}.`,
        occurredAt: input.now,
      });
      tx.update(transfers).set({ outEventId: event.id }).where(eq(transfers.id, row.id)).run();
      return { transferNo, lotCode: picked.lotCode, qtyBase: picked.qtyBase };
    }),
  );
  const fmt = (base: number) => amount(base, s.dimension);
  const sentence = `Approved: ${fmt(s.qtyBase)} of ${s.materialName} leaves ${s.fromName} for ${s.toName} (${moved
    .map((t) => t.transferNo)
    .join(", ")}). ${s.toName}'s forecast counts it as on order until it is received.`;
  return { suggestion: s, transfers: moved, sentence };
}

/** A person turns the proposal down; Kevin keeps quiet about it until the shortfall changes. */
export function dismissTransfer(db: Ledger, key: string, input: DecisionInput) {
  const s = current(db, key, input);
  const toId = facilityId(db, s.to);
  const material = db.select().from(materials).where(eq(materials.code, s.material)).get();
  if (!material) throw new Error(`material ${s.material} does not exist`);
  db.insert(transferDismissals)
    .values({
      materialId: material.id,
      fromFacilityId: facilityId(db, s.from),
      toFacilityId: toId,
      shortBase: s.shortBase,
      dismissedBy: input.staffId,
      dismissedAt: input.now,
    })
    .run();
  return {
    suggestion: s,
    sentence: `Dismissed: no move of ${s.materialName} to ${s.toName}; Kevin asks again only if its shortfall changes.`,
  };
}

export interface ReceiveInput {
  staffId: number;
  now: string;
  /** What the receiving plant weighed or counted; the shipped quantity by default. */
  receivedBase?: number;
}

/**
 * The receiving plant books an approved transfer in (`transfer_in` at what it counted), and
 * Kevin's usual transfer check runs on it: silent when the counts agree, a discrepancy if not.
 */
export function receiveTransfer(
  db: Ledger,
  transferNo: string,
  input: ReceiveInput,
): {
  transferNo: string;
  receivedBase: number;
  discrepancies: TransferDiscrepancy[];
  sentence: string;
} {
  const row = db.select().from(transfers).where(eq(transfers.transferNo, transferNo)).get();
  if (!row) throw new Error(`transfer ${transferNo} does not exist`);
  if (row.state !== "in_transit") throw new Error(`transfer ${transferNo} is ${row.state}`);
  const receivedBase = input.receivedBase ?? row.qtyShippedBase;
  if (!Number.isInteger(receivedBase) || receivedBase <= 0) {
    throw new Error("a received quantity is a positive whole number of base units");
  }
  db.transaction((tx) => {
    const event = appendLotEvent(tx, {
      lotId: row.lotId,
      kind: "transfer_in",
      qtyDeltaBase: receivedBase,
      facilityId: row.toFacilityId,
      refType: "transfer",
      refId: row.id,
      actorType: "staff",
      actorId: input.staffId,
      reason: `${transferNo}: received.`,
      occurredAt: input.now,
    });
    tx.update(transfers)
      .set({ inEventId: event.id, qtyReceivedBase: receivedBase, state: "received" })
      .where(eq(transfers.id, row.id))
      .run();
  });
  const lot = db.select().from(lots).where(eq(lots.id, row.lotId)).get();
  const material = db
    .select()
    .from(materials)
    .where(eq(materials.id, lot?.materialId ?? 0))
    .get();
  const found = checkTransfers(db, { now: input.now, lotCode: lot?.lotCode ?? "" });
  const fmt = (base: number) => amount(base, material?.dimension ?? "count");
  const sentence = `${transferNo}: ${fmt(receivedBase)} of ${material?.name ?? "stock"} received${
    receivedBase === row.qtyShippedBase
      ? "; the counts agree"
      : ` of the ${fmt(row.qtyShippedBase)} sent`
  }.`;
  return { transferNo, receivedBase, discrepancies: found, sentence };
}

/** Approved transfers still on the road, for the receiving plant's screen. */
export function transfersInTransit(db: Ledger) {
  const from = sql<string>`(select code from facilities where id = ${transfers.fromFacilityId})`;
  const to = sql<string>`(select code from facilities where id = ${transfers.toFacilityId})`;
  return db
    .select({
      transferNo: transfers.transferNo,
      lotCode: lots.lotCode,
      material: materials.code,
      materialName: materials.name,
      dimension: materials.dimension,
      from,
      to,
      qtyBase: transfers.qtyShippedBase,
    })
    .from(transfers)
    .innerJoin(lots, eq(lots.id, transfers.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(eq(transfers.state, "in_transit"))
    .orderBy(asc(transfers.transferNo))
    .all();
}
