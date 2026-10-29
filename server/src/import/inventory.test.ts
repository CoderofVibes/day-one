import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openLedger } from "../ledger/db.ts";
import { verifyChain } from "../ledger/events.ts";
import { lotBalances, lotEvents, lots, materials, spreadsheetImports } from "../ledger/schema.ts";
import { seedLedger } from "../seed/index.ts";
import { INVENTORY_AS_OF, INVENTORY_FILE, INVENTORY_WORKBOOK } from "../seed/inventorySheet.ts";
import {
  analyzeInventorySheet,
  ledgerLotCodes,
  planImport,
  postImport,
  type Resolution,
} from "./inventory.ts";
import { readCsv, readXlsx, writeXlsx } from "./xlsx.ts";

const DIR = join(import.meta.dirname, "..", "..", "..", "data", "imports");
const file = readFileSync(join(DIR, INVENTORY_FILE));
const answers = JSON.parse(
  readFileSync(join(DIR, INVENTORY_FILE.replace(/\.xlsx$/, ".answers.json")), "utf8"),
) as Record<string, Resolution>;
const inventorySheet = () => {
  const sheet = readXlsx(file)[0];
  if (!sheet) throw new Error("no sheet");
  return sheet;
};

function emptyPlantB() {
  const db = openLedger();
  seedLedger(db, { referenceOnly: true });
  return db;
}

const post = (db: ReturnType<typeof openLedger>, res = answers) =>
  postImport(
    db,
    analyzeInventorySheet(inventorySheet(), {
      asOf: INVENTORY_AS_OF,
      existingLots: ledgerLotCodes(db),
    }),
    res,
    {
      facility: "B",
      fileName: INVENTORY_FILE,
      file,
      confirmedBy: "Ray Delgado",
      at: "2026-11-09T13:20:00.000Z",
    },
  );

/** Available and on-hold milligrams per material at the plant. */
function openingInventory(db: ReturnType<typeof openLedger>) {
  const out: Record<string, { available: number; hold: number }> = {};
  for (const r of db
    .select({ code: materials.code, state: lots.state, onHand: lotBalances.onHandBase })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .all()) {
    const m = out[r.code] ?? { available: 0, hold: 0 };
    if (r.state === "released") m.available += r.onHand;
    else m.hold += r.onHand;
    out[r.code] = m;
  }
  return out;
}

describe("the workbook file", () => {
  it("is the fixture, byte for byte, and reads back cell for cell", () => {
    expect(writeXlsx([...INVENTORY_WORKBOOK]).equals(file)).toBe(true);
    const sheets = readXlsx(file);
    expect(sheets.map((s) => s.name)).toEqual(["Inventory", "Sales by customer", "Summary"]);
    INVENTORY_WORKBOOK.forEach((sheet, i) => {
      const read = sheets[i]?.rows ?? [];
      sheet.rows.forEach((cells, r) => {
        const trimmed = [...cells];
        while (trimmed.length && (trimmed.at(-1) === null || trimmed.at(-1) === undefined))
          trimmed.pop();
        expect(read[r] ?? []).toEqual(trimmed);
      });
    });
  });

  it("reads quoted CSV the same way", () => {
    const sheet = readCsv('Item,Qty\r\n"Orange flavor, nat.",18\r\n\r\n"He said ""hi""",\n');
    expect(sheet.rows).toEqual([
      ["Item", "Qty"],
      ["Orange flavor, nat.", "18"],
      [],
      ['He said "hi"', null],
    ]);
  });
});

describe("Kevin's reading of Ray's sheet (FICTIONAL_DATA §12)", () => {
  const analysis = analyzeInventorySheet(inventorySheet(), { asOf: INVENTORY_AS_OF });

  it("finds the header under the title and maps every column", () => {
    expect(analysis.headerRow).toBe(2);
    expect(analysis.mapping).toEqual({
      item: 0,
      lot: 1,
      qty: 2,
      unit: 3,
      location: 4,
      expiry: 5,
      notes: 6,
    });
    expect(analysis.rows).toHaveLength(19);
  });

  it("opens with one line naming every problem", () => {
    expect(analysis.message).toBe(
      "Found 19 rows. 9 need your eyes: 1 looks like the same ascorbic acid lot entered twice, 1 uses a short name for ascorbic acid, 2 are in pounds, 1 lot expired in March, 1 quantity isn't a number, 1 has no lot number, 1 material (Xanthan Gum) isn't on your material list, and the last row is a total.",
    );
  });

  it("raises flags F1–F9 on the fixture's rows and nothing else", () => {
    expect(analysis.flags.map((f) => [f.id, f.row, f.kind])).toEqual([
      ["F1", 2, "duplicate"],
      ["F2", 3, "short_name"],
      ["F3", 6, "unit_conversion"],
      ["F4", 8, "unit_conversion"],
      ["F5", 9, "expired"],
      ["F6", 13, "quantity_text"],
      ["F7", 17, "missing_lot"],
      ["F8", 18, "unknown_material"],
      ["F9", 19, "totals_row"],
    ]);
    expect(analysis.flags[2]?.proposal).toBe("110.2 lb = 49.985 879 kg");
    expect(analysis.flags[3]?.proposal).toBe("55.1 lb = 24.992 940 kg");
    expect(analysis.flags[6]?.proposal).toContain("STA-261001-01");
    expect(analysis.flags[5]?.proposal).toBeNull();
    expect(analysis.flags[7]?.answers).toEqual(["review"]);
  });

  it("maps the plant's own names without asking", () => {
    const byRow = new Map(analysis.rows.map((r) => [r.row, r.material]));
    expect([6, 7, 8, 9, 11, 15, 16, 17].map((r) => byRow.get(r))).toEqual([
      "MCC",
      "CTA",
      "CTA",
      "FOR",
      "MGS",
      "MGO",
      "CCS",
      "STA",
    ]);
  });
});

describe("posting the import", () => {
  it("posts nothing while any flag is unanswered", () => {
    const db = emptyPlantB();
    const { F6: _, ...missing } = answers;
    const result = post(db, missing);
    expect(result.status).toBe("unresolved");
    expect(result.status === "unresolved" && result.plan.unresolved).toEqual(["F6"]);
    expect(db.select().from(lotEvents).all()).toHaveLength(0);
  });

  it("refuses an answer a flag does not allow", () => {
    const plan = planImport(analyzeInventorySheet(inventorySheet(), { asOf: INVENTORY_AS_OF }), {
      ...answers,
      F8: { answer: "accept" },
    });
    expect(plan.unresolved).toEqual(["F8"]);
  });

  it("produces the expected opening inventory to the milligram", () => {
    const db = emptyPlantB();
    const result = post(db);
    expect(result.status).toBe("posted");
    expect(openingInventory(db)).toEqual({
      ASC: { available: 562_500_000, hold: 0 },
      SOR: { available: 620_000_000, hold: 0 },
      MCC: { available: 349_985_879, hold: 0 },
      CTA: { available: 224_992_940, hold: 0 },
      FOR: { available: 25_000_000, hold: 18_000_000 },
      MGS: { available: 40_000_000, hold: 0 },
      SIO: { available: 12_000_000, hold: 0 },
      SUC: { available: 5_800_000, hold: 0 },
      CAC: { available: 900_000_000, hold: 0 },
      MGO: { available: 180_000_000, hold: 0 },
      CCS: { available: 30_000_000, hold: 0 },
      STA: { available: 22_000_000, hold: 0 },
    });
    const expired = db.select().from(lots).where(eq(lots.lotCode, "FOR-260301-01")).get();
    expect(expired?.state).toBe("quarantine");
    expect(expired?.expiresOn).toBe("2026-03-31");
    expect(db.select().from(lots).where(eq(lots.lotCode, "XG-0412")).get()).toBeUndefined();
    const record = db.select().from(spreadsheetImports).get();
    expect(record?.lotsPosted).toBe(16);
    expect(JSON.parse(record?.reviewJson ?? "[]")).toEqual([
      { row: 18, item: "Xanthan Gum", reason: "Xanthan Gum is not on your material list." },
    ]);
    expect(verifyChain(db).ok).toBe(true);
  });

  it("does not double-post the same file at the same plant", () => {
    const db = emptyPlantB();
    const first = post(db);
    const events = db.select().from(lotEvents).all().length;
    const again = post(db);
    expect(again).toEqual({
      status: "already_imported",
      importId: first.status === "posted" ? first.importId : -1,
    });
    expect(db.select().from(lotEvents).all()).toHaveLength(events);
  });

  it("holds a lot the ledger already has instead of booking it twice", () => {
    const db = openLedger();
    seedLedger(db);
    const analysis = analyzeInventorySheet(inventorySheet(), {
      asOf: INVENTORY_AS_OF,
      existingLots: ledgerLotCodes(db),
    });
    const flag = analysis.flags.find((f) => f.kind === "lot_exists");
    expect(flag?.message).toBe("Lot MCC-260901-01 is already in the ledger.");
    expect(flag?.answers).toEqual(["review"]);
  });
});
