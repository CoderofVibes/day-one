import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "./db.ts";
import {
  appendLotEvent,
  GENESIS_HASH,
  LedgerRuleError,
  type LotEventInput,
  rebuildProjections,
  verifyChain,
} from "./events.ts";
import { facilities, lotBalances, lots, materials, units } from "./schema.ts";

const KG = 1_000_000; // mg

let db: Ledger;
let plantA: number;
let plantB: number;
let lotId: number;
let clock = 0;

function at() {
  clock += 1;
  return `2026-10-09T08:${String(clock).padStart(2, "0")}:00.000Z`;
}

function append(kind: LotEventInput["kind"], qtyDeltaBase = 0, extra: Partial<LotEventInput> = {}) {
  return appendLotEvent(db, {
    lotId,
    kind,
    qtyDeltaBase,
    facilityId: plantB,
    actorType: "system",
    occurredAt: at(),
    ...extra,
  });
}

function lot() {
  return db.select().from(lots).where(eq(lots.id, lotId)).get();
}

beforeEach(() => {
  clock = 0;
  db = openLedger();
  db.insert(units).values({ code: "mg", dimension: "mass", toBaseNum: 1 }).run();
  [plantA, plantB] = db
    .insert(facilities)
    .values([
      { code: "A", name: "Plant A (fictional)", role: "sister" },
      { code: "B", name: "Plant B (fictional)", role: "acquired" },
    ])
    .returning({ id: facilities.id })
    .all()
    .map((r) => r.id) as [number, number];
  const material = db
    .insert(materials)
    .values({
      code: "ASC",
      name: "Ascorbic acid",
      category: "active",
      dimension: "mass",
      baseUnit: "mg",
    })
    .returning()
    .get();
  lotId = db
    .insert(lots)
    .values({ lotCode: "ASC-261009-01", materialId: material.id })
    .returning()
    .get().id;
});

describe("schema", () => {
  it("makes every table STRICT", () => {
    const loose = db.all<{ name: string }>(
      sql`select name from pragma_table_list where type = 'table' and strict = 0
          and schema = 'main' and name not like 'sqlite_%' and name not like '__drizzle%'`,
    );
    expect(loose).toEqual([]);
  });

  it("rejects values outside an enum", () => {
    expect(() =>
      db
        .insert(facilities)
        .values({ code: "X", name: "x", role: "moon" as "hq" })
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("enforces foreign keys", () => {
    expect(() => db.insert(lots).values({ lotCode: "L-404", materialId: 404 }).run()).toThrow(
      /FOREIGN KEY/,
    );
  });
});

describe("appendLotEvent", () => {
  it("walks a lot from order to consumption and keeps the projection", () => {
    append("ordered");
    append("shipped");
    append("received", 200 * KG);
    append("quarantined");
    append("released");
    expect(lot()?.state).toBe("released");
    append("issued");
    append("consumed", -150 * KG);
    expect(lot()?.state).toBe("in_use"); // partly used
    append("consumed", -50 * KG);
    expect(lot()?.state).toBe("consumed");
    expect(lot()?.currentFacilityId).toBe(plantB);
  });

  it("chains hashes from the genesis hash", () => {
    const first = append("received", 5 * KG);
    const second = append("quarantined");
    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(second.prevHash).toBe(first.eventHash);
    expect(first.eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyChain(db)).toEqual({ ok: true });
  });

  it("produces identical hashes for identical seeded runs", () => {
    const run = () => {
      clock = 0;
      return [append("received", 5 * KG), append("quarantined")].map((e) => e.eventHash);
    };
    const firstRun = run();
    db = openLedger();
    db.insert(units).values({ code: "mg", dimension: "mass", toBaseNum: 1 }).run();
    db.insert(facilities)
      .values([
        { code: "A", name: "Plant A (fictional)", role: "sister" },
        { code: "B", name: "Plant B (fictional)", role: "acquired" },
      ])
      .run();
    db.insert(materials)
      .values({
        code: "ASC",
        name: "Ascorbic acid",
        category: "active",
        dimension: "mass",
        baseUnit: "mg",
      })
      .run();
    db.insert(lots).values({ lotCode: "ASC-261009-01", materialId: 1 }).run();
    expect(run()).toEqual(firstRun);
  });

  it("refuses transitions the state machine does not allow", () => {
    append("received", 5 * KG);
    expect(() => append("released")).toThrow(LedgerRuleError); // skips quarantine
    expect(() => append("shipped")).toThrow(/not allowed from received/);
    expect(lot()?.state).toBe("received");
  });

  it("refuses wrong quantities and leaves no partial write", () => {
    expect(() => append("received", 0)).toThrow(/must be positive/);
    expect(() => append("received", 1.5)).toThrow(/whole number/);
    append("received", 5 * KG);
    append("quarantined");
    append("released");
    expect(() => append("wasted", -6 * KG)).toThrow(/would leave lot/);
    expect(() => append("count_adjust", -KG)).toThrow(/needs a reason/);
    expect(db.select().from(lotBalances).all()).toEqual([
      { lotId, facilityId: plantB, onHandBase: 5 * KG },
    ]);
    expect(verifyChain(db)).toEqual({ ok: true });
  });

  it("moves a lot between facilities; a short receipt leaves the gap visible", () => {
    append("received", 200 * KG);
    append("quarantined");
    append("released");
    append("transfer_out", -200 * KG, { refType: "transfer" });
    expect(lot()?.currentFacilityId).toBe(plantB); // in transit
    append("transfer_in", 187_450_000, { facilityId: plantA, refType: "transfer" });
    expect(lot()).toMatchObject({ state: "released", currentFacilityId: plantA });
    const balances = db.select().from(lotBalances).all();
    expect(balances).toContainEqual({ lotId, facilityId: plantA, onHandBase: 187_450_000 });
    expect(balances).toContainEqual({ lotId, facilityId: plantB, onHandBase: 0 });
  });
});

describe("append-only log", () => {
  it("blocks UPDATE and DELETE on lot_events", () => {
    append("received", 5 * KG);
    expect(() => db.$client.exec("update lot_events set qty_delta_base = 1")).toThrow(
      /append-only/,
    );
    expect(() => db.$client.exec("delete from lot_events")).toThrow(/append-only/);
  });

  it("detects a tampered event when the trigger is bypassed", () => {
    append("received", 5 * KG);
    append("quarantined");
    append("released");
    db.run(sql`drop trigger lot_events_no_update`);
    db.run(sql`update lot_events set qty_delta_base = 4000000 where seq = 1`);
    expect(verifyChain(db)).toEqual({ ok: false, seq: 1 });
  });
});

describe("rebuildProjections", () => {
  it("matches the cached projection after normal writes", () => {
    append("received", 200 * KG);
    append("quarantined");
    append("released");
    append("transfer_out", -200 * KG);
    append("transfer_in", 200 * KG, { facilityId: plantA });
    expect(rebuildProjections(db)).toEqual([]);
  });

  it("repairs a projection that was edited outside the event writer", () => {
    append("received", 5 * KG);
    db.update(lots).set({ state: "released" }).where(eq(lots.id, lotId)).run();
    expect(rebuildProjections(db)).toEqual([
      { lotId, state: "received", currentFacilityId: plantB },
    ]);
    expect(lot()?.state).toBe("received");
  });
});
