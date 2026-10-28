import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../ledger/db.ts";
import { rebuildProjections, verifyChain } from "../ledger/events.ts";
import {
  departments,
  facilities,
  formulaLines,
  formulas,
  lotBalances,
  lotEvents,
  lots,
  materials,
  products,
  transfers,
  vendors,
} from "../ledger/schema.ts";
import { seedLedger } from "./index.ts";
import { kg } from "./reference.ts";

let db: Ledger;

beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

function facility(code: string) {
  const row = db.select().from(facilities).where(eq(facilities.code, code)).get();
  if (!row) throw new Error(code);
  return row.id;
}

function lot(code: string) {
  const row = db.select().from(lots).where(eq(lots.lotCode, code)).get();
  if (!row) throw new Error(code);
  return row;
}

function onHand(materialCode: string, facilityCode: string) {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${lotBalances.onHandBase}), 0)` })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(
      and(eq(materials.code, materialCode), eq(lotBalances.facilityId, facility(facilityCode))),
    )
    .get();
  return row?.total ?? 0;
}

describe("reference data", () => {
  it("has the four facilities, 33 materials, 12 vendors and three products", () => {
    expect(
      db
        .select()
        .from(facilities)
        .all()
        .map((f) => f.code),
    ).toEqual(["ACME", "A", "B", "C"]);
    expect(db.select().from(materials).all()).toHaveLength(33);
    expect(db.select().from(vendors).all()).toHaveLength(12);
    expect(db.select().from(products).all()).toHaveLength(3);
  });

  it("starts Plant B's departments grey and the others online", () => {
    const b = db
      .select()
      .from(departments)
      .where(eq(departments.facilityId, facility("B")))
      .all();
    expect(b).toHaveLength(9);
    expect(new Set(b.map((d) => d.onboardingStatus))).toEqual(new Set(["grey"]));
    const c = db
      .select()
      .from(departments)
      .where(eq(departments.facilityId, facility("C")))
      .all();
    expect(new Set(c.map((d) => d.onboardingStatus))).toEqual(new Set(["online"]));
  });

  it("keeps formula lines summing to the batch blend weight", () => {
    const totals = db
      .select({
        code: products.code,
        total: sql<number>`sum(${formulaLines.qtyPerBatchBase})`,
        blend: sql<number>`${products.tabletWeightMg} * ${products.standardBatchTablets}`,
      })
      .from(formulaLines)
      .innerJoin(formulas, eq(formulas.id, formulaLines.formulaId))
      .innerJoin(products, eq(products.id, formulas.productId))
      .groupBy(products.code)
      .all();
    expect(totals).toHaveLength(3);
    for (const p of totals) expect(p.total, p.code).toBe(p.blend);
  });

  it("marks QuickChem unqualified and Delta D conditional", () => {
    const status = (code: string) =>
      db.select().from(vendors).where(eq(vendors.code, code)).get()?.qualificationStatus;
    expect(status("QCD")).toBe("unqualified");
    expect(status("DDN")).toBe("conditional");
  });
});

describe("lots at demo start (FICTIONAL_DATA §6, §8)", () => {
  it("has at least one lot per material", () => {
    const missing = db.all<{ code: string }>(
      sql`select code from materials where id not in (select material_id from lots)`,
    );
    expect(missing).toEqual([]);
  });

  it("holds 722.350 kg of ascorbic acid at Plant B across the two lots", () => {
    expect(onHand("ASC", "B")).toBe(kg(722.35));
    expect(lot("ASC-261009-01")).toMatchObject({
      state: "in_use",
      currentFacilityId: facility("B"),
    });
    expect(lot("ASC-260921-02").state).toBe("released");
  });

  it("leaves 12.550 kg of phantom ascorbic acid on Plant A's book", () => {
    expect(onHand("ASC", "A")).toBe(kg(12.55));
    const tr = db.select().from(transfers).get();
    expect(tr).toMatchObject({
      transferNo: "TR-A-B-261102",
      qtyShippedBase: kg(200),
      qtyReceivedBase: kg(187.45),
      state: "received",
    });
    expect(tr?.outEventId).not.toBeNull();
    expect(tr?.inEventId).not.toBeNull();
  });

  it("shows the quarantine, en-route and on-order states", () => {
    expect(lot("MGS-261106-01").state).toBe("quarantine");
    expect(lot("CAC-261111-01")).toMatchObject({
      state: "en_route",
      currentFacilityId: facility("A"),
    });
    expect(lot("VD3-261123-01").state).toBe("on_order");
  });

  it("stocks packaging at Plant C", () => {
    expect(onHand("BTL", "C")).toBe(120_000);
    expect(onHand("BTL", "B")).toBe(0);
  });

  it("writes events before the demo clock, in time order, on an intact chain", () => {
    const events = db.select().from(lotEvents).orderBy(lotEvents.seq).all();
    const times = events.map((e) => e.occurredAt);
    expect(times).toEqual([...times].sort());
    expect((times.at(-1) ?? "") < "2026-11-09T13:00:00.000Z").toBe(true);
    expect(verifyChain(db)).toEqual({ ok: true });
    expect(rebuildProjections(db)).toEqual([]);
  });

  it("produces the same chain head on every run", () => {
    const again = openLedger();
    seedLedger(again);
    const head = (l: Ledger) =>
      l.select().from(lotEvents).orderBy(sql`${lotEvents.seq} desc`).limit(1).get()?.eventHash;
    expect(head(again)).toBe(head(db));
  });
});
