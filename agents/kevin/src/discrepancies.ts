// Three facilities, one truth (SPEC step 3, FICTIONAL_DATA §8): when a plant weighs in less
// of a transferred lot than the sending plant booked out, and the sending plant's book still
// shows the difference, that difference is phantom stock. Kevin raises a discrepancy with both
// numbers and proposes the compensating `count_adjust` at the source; the source plant's staff
// apply or dismiss it. Nothing is edited: the adjustment is one more event on the chain.
//
// The proposal's fingerprint is anchored when the record anchoring covers movements (it joins
// the recorded run at the next re-record, PLAN Nov 12); until then it is a ledger row only.

import type { Ledger } from "@day-one/server/ledger/db";
import { appendLotEvent, type LotEventInput } from "@day-one/server/ledger/events";
import {
  discrepancies,
  facilities,
  lotBalances,
  lots,
  materials,
  transfers,
} from "@day-one/server/ledger/schema";
import { and, eq } from "drizzle-orm";
import { isWasteCorrection } from "./massBalance.ts";

/** A received quantity this far from the shipped one is a weighing difference, not a loss. */
export const TRANSFER_TOLERANCE_BP = 50;

export interface TransferDiscrepancy {
  id: number;
  transferNo: string;
  lotCode: string;
  material: string;
  from: { id: number; code: string };
  to: { id: number; code: string };
  shippedBase: number;
  receivedBase: number;
  /** What the sending plant still books of the lot. */
  sourceBookBase: number;
  /** The compensating event, when the numbers explain each other; null when a count is needed. */
  proposed: LotEventInput | null;
  sentence: string;
}

export interface CheckInput {
  /** The demo clock. */
  now: string;
  /** Only transfers of this lot; all received transfers when omitted. */
  lotCode?: string;
}

/**
 * Looks at received transfers whose received quantity is off from the shipped one by more
 * than the tolerance and raises one discrepancy per transfer (never twice). When the shortfall
 * equals what the source still books, the proposal is to write that stock off at the source.
 */
export function checkTransfers(db: Ledger, input: CheckInput): TransferDiscrepancy[] {
  const rows = db
    .select({
      transfer: transfers,
      lot: lots,
      material: materials,
    })
    .from(transfers)
    .innerJoin(lots, eq(lots.id, transfers.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(
      input.lotCode
        ? and(eq(transfers.state, "received"), eq(lots.lotCode, input.lotCode))
        : eq(transfers.state, "received"),
    )
    .all();

  const raised: TransferDiscrepancy[] = [];
  for (const { transfer, lot, material } of rows) {
    const received = transfer.qtyReceivedBase ?? 0;
    const shortfall = transfer.qtyShippedBase - received;
    if (Math.abs(shortfall) * 10_000 <= transfer.qtyShippedBase * TRANSFER_TOLERANCE_BP) continue;
    const already = db
      .select({ id: discrepancies.id })
      .from(discrepancies)
      .where(and(eq(discrepancies.kind, "transfer_qty"), eq(discrepancies.lotId, lot.id)))
      .get();
    if (already) continue;

    const from = facility(db, transfer.fromFacilityId);
    const to = facility(db, transfer.toFacilityId);
    const sourceBook =
      db
        .select({ base: lotBalances.onHandBase })
        .from(lotBalances)
        .where(and(eq(lotBalances.lotId, lot.id), eq(lotBalances.facilityId, from.id)))
        .get()?.base ?? 0;
    const unit = (base: number) => amount(base, material.dimension);
    const explained = shortfall > 0 && sourceBook === shortfall;
    const proposed: LotEventInput | null = explained
      ? {
          lotId: lot.id,
          kind: "count_adjust",
          qtyDeltaBase: -sourceBook,
          facilityId: from.id,
          refType: "transfer",
          refId: transfer.id,
          actorType: "kevin",
          reason:
            `${transfer.transferNo}: Plant ${to.code} weighed in ${unit(received)} of the ` +
            `${unit(transfer.qtyShippedBase)} sent; the ${unit(sourceBook)} still on Plant ${from.code}'s ` +
            "book left with the shipment.",
          occurredAt: input.now,
        }
      : null;
    const sentence =
      `Plant ${from.code} still shows ${unit(sourceBook)} of lot ${lot.lotCode}, but Plant ${to.code} ` +
      `weighed in ${unit(received)} of the ${unit(transfer.qtyShippedBase)} sent. ` +
      (proposed
        ? `Proposed adjustment sent to Plant ${from.code} for review.`
        : `Asked Plant ${from.code} and Plant ${to.code} for a count.`);

    const id = db.transaction((tx) => {
      const row = tx
        .insert(discrepancies)
        .values({
          kind: "transfer_qty",
          facilityId: from.id,
          lotId: lot.id,
          expectedBase: transfer.qtyShippedBase,
          observedBase: received,
          detectedBy: "kevin",
          status: proposed ? "proposed_adjustment" : "open",
          explanation: sentence,
          proposedEventJson: proposed ? JSON.stringify(proposed) : null,
        })
        .returning({ id: discrepancies.id })
        .get();
      tx.update(transfers).set({ state: "discrepancy" }).where(eq(transfers.id, transfer.id)).run();
      return row.id;
    });
    raised.push({
      id,
      transferNo: transfer.transferNo,
      lotCode: lot.lotCode,
      material: material.code,
      from,
      to,
      shippedBase: transfer.qtyShippedBase,
      receivedBase: received,
      sourceBookBase: sourceBook,
      proposed,
      sentence,
    });
  }
  return raised;
}

export interface ReviewInput {
  /** The reviewer at the source plant. */
  staffId: number;
  decision: "apply" | "dismiss";
  now: string;
}

/**
 * The source plant's review of a proposed adjustment: applying it posts the `count_adjust`
 * as the reviewer (Kevin proposed, a person decided) and resolves the transfer; dismissing it
 * leaves the books as they are and the transfer marked resolved by a person. A waste
 * correction from the mass balance posts no event: applying it records the extra waste.
 */
export function reviewDiscrepancy(db: Ledger, discrepancyId: number, input: ReviewInput) {
  const row = db.select().from(discrepancies).where(eq(discrepancies.id, discrepancyId)).get();
  if (!row) throw new Error(`discrepancy ${discrepancyId} does not exist`);
  if (row.status !== "proposed_adjustment") {
    throw new Error(`discrepancy ${discrepancyId} is ${row.status}, not awaiting review`);
  }
  const proposal = JSON.parse(row.proposedEventJson ?? "null") as unknown;
  if (!proposal) throw new Error(`discrepancy ${discrepancyId} has no proposed adjustment`);
  const status = input.decision === "apply" ? "adjusted" : "dismissed";
  if (isWasteCorrection(proposal)) {
    // Waste left the floor with the batch; no lot moves. The applied row is the addendum the
    // mass balance reads, and the anchored batch record keeps its own figure.
    const decided = { ...proposal, reviewedBy: input.staffId, reviewedAt: input.now };
    db.update(discrepancies)
      .set({ status, proposedEventJson: JSON.stringify(decided) })
      .where(eq(discrepancies.id, discrepancyId))
      .run();
    return { event: null, status } as const;
  }
  const proposed = proposal as LotEventInput;
  return db.transaction((tx) => {
    const event =
      input.decision === "apply"
        ? appendLotEvent(tx, {
            ...proposed,
            actorType: "staff",
            actorId: input.staffId,
            occurredAt: input.now,
          })
        : null;
    tx.update(discrepancies)
      .set({ status: input.decision === "apply" ? "adjusted" : "dismissed" })
      .where(eq(discrepancies.id, discrepancyId))
      .run();
    if (proposed.refType === "transfer" && proposed.refId) {
      tx.update(transfers).set({ state: "resolved" }).where(eq(transfers.id, proposed.refId)).run();
    }
    return { event, status: input.decision === "apply" ? "adjusted" : "dismissed" } as const;
  });
}

function facility(db: Ledger, id: number) {
  const row = db
    .select({ id: facilities.id, code: facilities.code })
    .from(facilities)
    .where(eq(facilities.id, id))
    .get();
  if (!row) throw new Error(`facility ${id} does not exist`);
  return row;
}

/** `12.55 kg`, `200 kg`, or a plain count. */
function amount(base: number, dimension: string) {
  if (dimension !== "mass") return base.toLocaleString("en-US");
  const kg = Math.round(base / 1_000) / 1_000;
  return `${kg.toLocaleString("en-US", { maximumFractionDigits: 3 })} kg`;
}
