import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../ledger/db.ts";
import {
  batchInputs,
  batchRecords,
  facilities,
  lotBalances,
  lotEvents,
  lots,
  materials,
  poLines,
  purchaseOrders,
  qcDecisions,
  receipts,
} from "../ledger/schema.ts";
import { HISTORY_BATCHES, QC_SAMPLE_MG } from "./history.ts";
import { seedLedger } from "./index.ts";
import { kg, MATERIALS } from "./reference.ts";

let db: Ledger;

beforeAll(() => {
  db = openLedger();
  seedLedger(db);
});

function batch(batchNo: string) {
  const row = db.select().from(batchRecords).where(eq(batchRecords.batchNo, batchNo)).get();
  if (!row) throw new Error(batchNo);
  return row;
}

function issued(batchId: number) {
  return (
    db
      .select({ total: sql<number>`sum(${batchInputs.actualBase})` })
      .from(batchInputs)
      .where(eq(batchInputs.batchId, batchId))
      .get()?.total ?? 0
  );
}

describe("history POs (FICTIONAL_DATA §13)", () => {
  it("has six paid POs totalling $9,632.50, each received and matched", () => {
    // The bookkeeper pack's six; the plant's earlier POs (PO-1007 to PO-1034) are §17's.
    const pos = db
      .select()
      .from(purchaseOrders)
      .all()
      .filter((p) => p.poNo >= "PO-1035");
    expect(pos.map((p) => p.poNo)).toEqual([
      "PO-1035",
      "PO-1036",
      "PO-1037",
      "PO-1038",
      "PO-1039",
      "PO-1040",
    ]);
    expect(new Set(pos.map((p) => p.status))).toEqual(new Set(["paid"]));
    expect(pos.reduce((sum, p) => sum + p.totalUsdc, 0)).toBe(9_632_500_000);
    const received = new Set(
      db
        .select()
        .from(receipts)
        .all()
        .map((r) => r.poId),
    );
    expect(pos.every((p) => received.has(p.id))).toBe(true);
  });

  it("keeps each PO total equal to its lines", () => {
    const rows = db
      .select({
        poNo: purchaseOrders.poNo,
        total: purchaseOrders.totalUsdc,
        lines: sql<number>`sum(${poLines.extendedUsdc})`,
      })
      .from(purchaseOrders)
      .innerJoin(poLines, eq(poLines.poId, purchaseOrders.id))
      .groupBy(purchaseOrders.poNo)
      .all();
    for (const r of rows) expect(r.lines, r.poNo).toBe(r.total);
  });

  it("receives each PO line as a lot of the same quantity", () => {
    const rows = db
      .select({
        poNo: purchaseOrders.poNo,
        ordered: poLines.qtyBase,
        received: lotEvents.qtyDeltaBase,
      })
      .from(lotEvents)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, lotEvents.refId))
      .innerJoin(lots, eq(lots.id, lotEvents.lotId))
      .innerJoin(
        poLines,
        and(eq(poLines.poId, purchaseOrders.id), eq(poLines.materialId, lots.materialId)),
      )
      .where(and(eq(lotEvents.kind, "received"), eq(lotEvents.refType, "po")))
      .all();
    expect(rows).toHaveLength(db.select().from(poLines).all().length);
    for (const r of rows) expect(r.received, r.poNo).toBe(r.ordered);
  });

  it("bills magnesium stearate at $8.20/kg, then $9.35/kg (the price drift)", () => {
    const prices = db
      .select({ price: poLines.unitPriceUsdc, poNo: purchaseOrders.poNo })
      .from(poLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, poLines.poId))
      .innerJoin(materials, eq(materials.id, poLines.materialId))
      .where(eq(materials.code, "MGS"))
      .orderBy(purchaseOrders.poNo)
      .all();
    expect(prices.at(-1)).toEqual({ price: 9_350_000, poNo: "PO-1040" });
    expect(new Set(prices.slice(0, -1).map((p) => p.price))).toEqual(new Set([8_200_000]));
    expect(prices.map((p) => p.poNo)).toContain("PO-1035");
  });
});

describe("history batches (FICTIONAL_DATA §10, §15)", () => {
  it("has eight confirmed summarized batches, none of the rendered §7 records", () => {
    const all = db.select().from(batchRecords).all();
    const handWritten = new Set(HISTORY_BATCHES.map((b) => b.batchNo));
    expect(all.filter((b) => handWritten.has(b.batchNo))).toHaveLength(8);
    expect(all.some((b) => /^BR-[AB]-104[1-6]$|^BR-A-2207$/.test(b.batchNo))).toBe(false);
    expect(new Set(all.map((b) => b.status))).toEqual(new Set(["confirmed"]));
    expect(all.every((b) => b.sourceFile === null)).toBe(true);
  });

  it("takes the 165.100 kg from ASC-260921-02 in BR-B-1036", () => {
    const draws = db
      .select({ lot: lots.lotCode, qty: batchInputs.actualBase })
      .from(batchInputs)
      .innerJoin(lots, eq(lots.id, batchInputs.lotId))
      .innerJoin(materials, eq(materials.id, batchInputs.materialId))
      .where(and(eq(batchInputs.batchId, batch("BR-B-1036").id), eq(materials.code, "ASC")))
      .all();
    expect(draws).toEqual([
      { lot: "ASC-260828-01", qty: kg(246.9) },
      { lot: "ASC-260921-02", qty: kg(165.1) },
    ]);
  });

  it("balances Hollow Pine's BR-B-1038 to the milligram", () => {
    const b = batch("BR-B-1038");
    expect(b).toMatchObject({ actualTablets: 450_000, yieldBp: 9_000, wasteBase: kg(83.75) });
    expect(issued(b.id)).toBe(kg(842.5));
  });

  it("leaves 57.600 kg unaccounted on each Riverside P-CMD batch", () => {
    for (const no of ["BR-A-2201", "BR-A-2204"]) {
      const b = batch(no);
      expect(issued(b.id), no).toBe(842_502_468);
      expect(b.wasteBase, no).toBe(25_310_454);
      const output = (b.actualTablets ?? 0) * 1_685;
      expect(issued(b.id) - output - (b.wasteBase ?? 0) - QC_SAMPLE_MG, no).toBe(57_599_514);
    }
  });

  it("links every draw to its consume event", () => {
    const unlinked = db.all(sql`
      select bi.id from batch_inputs bi
      left join lot_events e on e.id = bi.issue_event_id
      where e.kind is not 'consumed' or e.ref_id is not bi.batch_id`);
    expect(unlinked).toEqual([]);
  });
});

describe("the past QC rejection", () => {
  it("rejected CCS-261023-01 and returned it, so it holds nothing", () => {
    const lot = db.select().from(lots).where(eq(lots.lotCode, "CCS-261023-01")).get();
    expect(lot?.state).toBe("wasted");
    const decision = db
      .select()
      .from(qcDecisions)
      .where(eq(qcDecisions.lotId, lot?.id ?? 0))
      .get();
    expect(decision?.decision).toBe("rejected");
  });
});

describe("Plant B stock at demo start", () => {
  it("keeps every material except ascorbic acid and two lab chemicals at its reorder point", () => {
    const plantB = db.select().from(facilities).where(eq(facilities.code, "B")).get();
    const rows = db
      .select({
        code: materials.code,
        onHand: sql<number>`sum(${lotBalances.onHandBase})`,
        reorderPoint: materials.reorderPointBase,
      })
      .from(lotBalances)
      .innerJoin(lots, eq(lots.id, lotBalances.lotId))
      .innerJoin(materials, eq(materials.id, lots.materialId))
      .where(
        and(
          eq(lotBalances.facilityId, plantB?.id ?? 0),
          inArray(lots.state, ["released", "in_use"]),
          inArray(materials.category, ["active", "excipient"]),
        ),
      )
      .groupBy(materials.code)
      .all();
    const blendMaterials = MATERIALS.filter(
      (m) => m.category === "active" || m.category === "excipient",
    );
    // Plant B holds every blend material but Riverside's B-vitamin premix and bisglycinate (§17).
    expect(rows).toHaveLength(
      blendMaterials.filter((m) => m.code !== "BVP" && m.code !== "MBG").length,
    );
    for (const r of rows) {
      if (r.code === "ASC") continue;
      expect(r.onHand, r.code).toBeGreaterThanOrEqual(r.reorderPoint ?? 0);
    }
  });
});
