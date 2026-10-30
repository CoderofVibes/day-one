// The only writer of lot movements (DATA_MODEL §4). appendLotEvent validates the transition
// and quantity, extends the hash chain and updates the lots projection, all in one SQLite
// transaction. Nothing edits an event: corrections are compensating count_adjust events.

import type { RunResult } from "better-sqlite3";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { canonicalJson, sha256Hex } from "../canonical.ts";
import type * as schema from "./schema.ts";
import { type LotEventKind, type LotState, lotEvents, lots } from "./schema.ts";

/** The ledger or an open transaction on it. */
export type LedgerDb = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

export const GENESIS_HASH = "0".repeat(64);

export class LedgerRuleError extends Error {
  override name = "LedgerRuleError";
}

type Qty = "zero" | "positive" | "negative" | "nonzero";

interface Move {
  /** States the lot may be in; null means the lot has no events yet. */
  from: readonly (LotState | null)[];
  /** The new state; "same" keeps it; a terminal state applies only when the lot is emptied. */
  to: LotState | "same" | { whenEmpty: LotState };
  qty: Qty;
}

const HELD: readonly LotState[] = ["received", "quarantine", "released"];

/**
 * Allowed transitions: on_order → en_route → received → quarantine → released → in_use →
 * consumed | wasted, plus quarantine → rejected → wasted (returned or destroyed) and
 * released → wasted. Quantity is booked
 * when a lot is received; ordering and shipping carry no on-hand quantity. Transfers move a
 * lot between facilities without changing its state.
 */
export const MOVES: Record<LotEventKind, Move> = {
  ordered: { from: [null], to: "on_order", qty: "zero" },
  shipped: { from: ["on_order"], to: "en_route", qty: "zero" },
  received: { from: [null, "en_route"], to: "received", qty: "positive" },
  quarantined: { from: ["received"], to: "quarantine", qty: "zero" },
  released: { from: ["quarantine"], to: "released", qty: "zero" },
  rejected: { from: ["quarantine"], to: "rejected", qty: "zero" },
  issued: { from: ["released"], to: "in_use", qty: "zero" },
  returned: { from: ["in_use"], to: "released", qty: "zero" },
  consumed: { from: ["in_use"], to: { whenEmpty: "consumed" }, qty: "negative" },
  wasted: {
    from: ["released", "in_use", "rejected"],
    to: { whenEmpty: "wasted" },
    qty: "negative",
  },
  transfer_out: { from: HELD, to: "same", qty: "negative" },
  transfer_in: { from: HELD, to: "same", qty: "positive" },
  count_adjust: { from: [...HELD, "in_use"], to: "same", qty: "nonzero" },
};

export interface LotEventInput {
  lotId: number;
  kind: LotEventKind;
  qtyDeltaBase: number;
  facilityId: number;
  departmentId?: number | null;
  refType?: (typeof schema.REF_TYPES)[number] | null;
  refId?: number | null;
  actorType: (typeof schema.ACTOR_TYPES)[number];
  actorId?: number | null;
  reason?: string | null;
  occurredAt: string;
  /** Defaults to occurredAt, so seeded runs hash identically. */
  recordedAt?: string;
}

export type LotEvent = typeof lotEvents.$inferSelect;

/** The fields covered by event_hash, in a fixed shape with nulls explicit. */
function hashedFields(e: Omit<LotEvent, "id" | "prevHash" | "eventHash">) {
  return {
    seq: e.seq,
    lotId: e.lotId,
    kind: e.kind,
    fromState: e.fromState,
    toState: e.toState,
    qtyDeltaBase: e.qtyDeltaBase,
    facilityId: e.facilityId,
    departmentId: e.departmentId,
    refType: e.refType,
    refId: e.refId,
    actorType: e.actorType,
    actorId: e.actorId,
    reason: e.reason,
    occurredAt: e.occurredAt,
    recordedAt: e.recordedAt,
  };
}

/** event_hash = sha256(canonical_json(event) || prev_hash) */
export function eventHash(e: Omit<LotEvent, "id" | "prevHash" | "eventHash">, prevHash: string) {
  return sha256Hex(canonicalJson(hashedFields(e)) + prevHash);
}

function checkQty(kind: LotEventKind, qty: number, rule: Qty) {
  if (!Number.isSafeInteger(qty)) {
    throw new LedgerRuleError(`${kind}: quantity must be a whole number of base units`);
  }
  const ok =
    rule === "zero"
      ? qty === 0
      : rule === "positive"
        ? qty > 0
        : rule === "negative"
          ? qty < 0
          : qty !== 0;
  if (!ok) throw new LedgerRuleError(`${kind}: quantity ${qty} must be ${rule}`);
}

/** The next state, or an error naming the rule that was broken. Pure, shared with replay. */
export function nextState(
  kind: LotEventKind,
  from: LotState | null,
  lotTotalAfter: number,
): LotState {
  const move = MOVES[kind];
  if (!move.from.includes(from)) {
    throw new LedgerRuleError(`${kind} is not allowed from ${from ?? "a new lot"}`);
  }
  if (move.to === "same") {
    if (from === null) throw new LedgerRuleError(`${kind} needs an existing lot`);
    return from;
  }
  if (typeof move.to === "string") return move.to;
  if (from === null) throw new LedgerRuleError(`${kind} needs an existing lot`);
  return lotTotalAfter === 0 ? move.to.whenEmpty : from;
}

function facilityAfter(kind: LotEventKind, current: number | null, eventFacility: number) {
  return current === null || kind === "transfer_in" ? eventFacility : current;
}

/**
 * The statements appendLotEvent runs, prepared once per connection: building and preparing
 * them on every call was most of the cost of a long history (the seed writes ~3,000 events).
 * A transaction shares its database's session, so one cache entry serves both.
 */
function prepareStatements(db: LedgerDb) {
  return {
    lot: db
      .select()
      .from(lots)
      .where(eq(lots.id, sql.placeholder("lotId")))
      .prepare(),
    onHand: db
      .select({
        total: sql<number>`coalesce(sum(${lotEvents.qtyDeltaBase}), 0)`,
        atFacility: sql<number>`coalesce(sum(case when ${lotEvents.facilityId} = ${sql.placeholder("facilityId")} then ${lotEvents.qtyDeltaBase} else 0 end), 0)`,
      })
      .from(lotEvents)
      .where(eq(lotEvents.lotId, sql.placeholder("lotId")))
      .prepare(),
    last: db
      .select({ seq: lotEvents.seq, eventHash: lotEvents.eventHash })
      .from(lotEvents)
      .orderBy(desc(lotEvents.seq))
      .limit(1)
      .prepare(),
    insert: db
      .insert(lotEvents)
      .values(
        Object.fromEntries(EVENT_COLUMNS.map((c) => [c, sql.placeholder(c)])) as Record<
          (typeof EVENT_COLUMNS)[number],
          ReturnType<typeof sql.placeholder>
        > as unknown as typeof lotEvents.$inferInsert,
      )
      .returning()
      .prepare(),
    project: db
      .update(lots)
      .set({
        state: sql.placeholder("state") as unknown as LotState,
        currentFacilityId: sql.placeholder("currentFacilityId") as unknown as number,
      })
      .where(eq(lots.id, sql.placeholder("lotId")))
      .prepare(),
  };
}

/** Every stored column of an event but its id, in insert order. */
const EVENT_COLUMNS = [
  "seq",
  "lotId",
  "kind",
  "fromState",
  "toState",
  "qtyDeltaBase",
  "facilityId",
  "departmentId",
  "refType",
  "refId",
  "actorType",
  "actorId",
  "reason",
  "occurredAt",
  "recordedAt",
  "prevHash",
  "eventHash",
] as const;
const STATEMENTS = new WeakMap<object, ReturnType<typeof prepareStatements>>();

function statementsFor(db: LedgerDb) {
  const key = (db as unknown as { session: object }).session;
  let made = STATEMENTS.get(key);
  if (!made) {
    made = prepareStatements(db);
    STATEMENTS.set(key, made);
  }
  return made;
}

/** Validates, hashes, inserts and projects one lot event. Returns the stored event. */
export function appendLotEvent(db: LedgerDb, input: LotEventInput): LotEvent {
  const q = statementsFor(db);
  // A savepoint, so a refused event leaves nothing behind inside a larger transaction.
  return db.transaction(() => {
    const lot = q.lot.get({ lotId: input.lotId });
    if (!lot) throw new LedgerRuleError(`lot ${input.lotId} does not exist`);

    checkQty(input.kind, input.qtyDeltaBase, MOVES[input.kind].qty);
    if (input.kind === "count_adjust" && !input.reason?.trim()) {
      throw new LedgerRuleError("count_adjust needs a reason");
    }
    const held = q.onHand.get({ lotId: lot.id, facilityId: input.facilityId }) ?? {
      total: 0,
      atFacility: 0,
    };
    const atFacility = held.atFacility + input.qtyDeltaBase;
    if (atFacility < 0) {
      throw new LedgerRuleError(
        `${input.kind} would leave lot ${lot.lotCode} at ${atFacility} base units at facility ${input.facilityId}`,
      );
    }
    const toState = nextState(input.kind, lot.state, held.total + input.qtyDeltaBase);

    const last = q.last.get();
    const prevHash = last?.eventHash ?? GENESIS_HASH;
    const fields = {
      seq: (last?.seq ?? 0) + 1,
      lotId: lot.id,
      kind: input.kind,
      fromState: lot.state,
      toState,
      qtyDeltaBase: input.qtyDeltaBase,
      facilityId: input.facilityId,
      departmentId: input.departmentId ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      reason: input.reason ?? null,
      occurredAt: input.occurredAt,
      recordedAt: input.recordedAt ?? input.occurredAt,
    };
    const stored = q.insert.get({
      ...fields,
      prevHash,
      eventHash: eventHash(fields, prevHash),
    }) as LotEvent;

    q.project.run({
      state: toState,
      currentFacilityId: facilityAfter(input.kind, lot.currentFacilityId, input.facilityId),
      lotId: lot.id,
    });
    return stored;
  });
}

export interface LotProjection {
  lotId: number;
  state: LotState | null;
  currentFacilityId: number | null;
}

/**
 * Replays every event into the lots projection and rewrites it. Returns the lots whose
 * cached values were wrong (empty when the projection was already right).
 */
export function rebuildProjections(db: LedgerDb): LotProjection[] {
  return db.transaction((tx) => {
    const replayed = new Map<number, LotProjection>();
    for (const lot of tx.select({ id: lots.id }).from(lots).all()) {
      replayed.set(lot.id, { lotId: lot.id, state: null, currentFacilityId: null });
    }
    for (const e of tx.select().from(lotEvents).orderBy(asc(lotEvents.seq)).all()) {
      const p = replayed.get(e.lotId);
      if (!p) throw new LedgerRuleError(`event ${e.seq} names unknown lot ${e.lotId}`);
      p.state = e.toState;
      p.currentFacilityId = facilityAfter(e.kind, p.currentFacilityId, e.facilityId);
    }

    const corrected: LotProjection[] = [];
    for (const lot of tx.select().from(lots).all()) {
      const p = replayed.get(lot.id);
      if (!p || (lot.state === p.state && lot.currentFacilityId === p.currentFacilityId)) continue;
      corrected.push(p);
      tx.update(lots)
        .set({ state: p.state, currentFacilityId: p.currentFacilityId })
        .where(eq(lots.id, lot.id))
        .run();
    }
    return corrected;
  });
}

/** Recomputes the hash chain. Returns the first seq whose hash or link does not match. */
export function verifyChain(db: LedgerDb): { ok: true } | { ok: false; seq: number } {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const e of db.select().from(lotEvents).orderBy(asc(lotEvents.seq)).all()) {
    if (e.seq !== expectedSeq || e.prevHash !== prev || e.eventHash !== eventHash(e, prev)) {
      return { ok: false, seq: e.seq };
    }
    prev = e.eventHash;
    expectedSeq += 1;
  }
  return { ok: true };
}
