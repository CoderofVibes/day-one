// Brings a plant's inventory spreadsheet in as opening stock (FEATURES_V2 §1). Keyless and
// offline: the reading is deterministic, no model is called.
//   npm run import -- <file.xlsx|file.csv> [--as-of YYYY-MM-DD] [--plant B] [--sheet <name>]
//                     [--answers <answers.json>] [--db <ledger.db>] [--by "<staff name>"] [--json]
// Without --answers it prints Kevin's reading and the flags waiting for a person. With answers
// it posts the rows, once per file and plant, into --db, or by default into an empty in-memory
// Plant B ledger (reference data only), and prints the opening inventory.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  analyzeInventorySheet,
  formatKg,
  ledgerLotCodes,
  postImport,
  type Resolution,
} from "../server/src/import/inventory.ts";
import { analyzeSalesSheets, type SalesAnalysis } from "../server/src/import/sales.ts";
import { readCsv, readXlsx } from "../server/src/import/xlsx.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { facilities, lotBalances, lots, materials } from "../server/src/ledger/schema.ts";
import { seedLedger } from "../server/src/seed/index.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const json = args.includes("--json");
const VALUED = new Set(["--as-of", "--plant", "--sheet", "--answers", "--db", "--by"]);
const file = args.find((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1] ?? ""));
if (!file) {
  console.error(
    "usage: npm run import -- <file.xlsx|file.csv> [--answers <answers.json>] [--json]",
  );
  process.exit(2);
}

const bytes = readFileSync(file);
const sheets =
  extname(file).toLowerCase() === ".csv" ? [readCsv(bytes.toString("utf8"))] : readXlsx(bytes);
const sheetName = opt("sheet");
const sheet = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
if (!sheet) {
  console.error(`no sheet ${sheetName}; the file has ${sheets.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const plant = opt("plant") ?? "B";
const dbFile = opt("db");
const db = openLedger(dbFile ?? ":memory:");
if (!dbFile) seedLedger(db, { referenceOnly: true });

const asOf = opt("as-of") ?? "2026-10-01";
const analysis = analyzeInventorySheet(sheet, { asOf, existingLots: ledgerLotCodes(db) });

const lines: string[] = [];
lines.push(`Kevin: ${analysis.message}`);
lines.push("");
lines.push(
  `Sheet "${analysis.sheet}", header on row ${analysis.headerRow}, columns: ${Object.entries(
    analysis.mapping,
  )
    .map(([field, col]) => `${field}=${String.fromCharCode(65 + (col as number))}`)
    .join(", ")}`,
);
for (const f of analysis.flags) {
  lines.push(
    `  ${f.id.padEnd(4)}row ${String(f.row).padEnd(3)}${f.kind.padEnd(18)}${f.message}${f.proposal ? ` → ${f.proposal}` : ""}`,
  );
}

const answersFile = opt("answers");
let result: ReturnType<typeof postImport> | null = null;
let inventory: { material: string; lots: string[]; availableMg: number; quarantineMg: number }[] =
  [];
if (answersFile) {
  const answers = JSON.parse(readFileSync(answersFile, "utf8")) as Record<string, Resolution>;
  result = postImport(db, analysis, answers, {
    facility: plant,
    fileName: basename(file),
    file: bytes,
    confirmedBy: opt("by") ?? "Ray Delgado",
    at: new Date().toISOString(),
  });
  lines.push("");
  if (result.status === "unresolved") {
    lines.push(`Nothing posted: ${result.plan.unresolved.join(", ")} still need an answer.`);
  } else if (result.status === "already_imported") {
    lines.push(`Already imported at Plant ${plant} (import ${result.importId}); nothing changed.`);
  } else {
    const p = result.plan;
    lines.push(
      `Posted ${p.lots.length} lots at Plant ${plant}; skipped ${p.skipped.length}; ${p.review.length} held for review${p.review.length ? `: ${p.review.map((r) => r.item).join(", ")}` : ""}.`,
    );
  }
  const facility = db.select().from(facilities).where(eq(facilities.code, plant)).get();
  const rows = db
    .select({
      material: materials.code,
      lot: lots.lotCode,
      state: lots.state,
      onHand: lotBalances.onHandBase,
    })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(and(eq(lotBalances.facilityId, facility?.id ?? -1)))
    .all();
  const byMaterial = new Map<string, (typeof inventory)[number]>();
  for (const r of rows) {
    const m = byMaterial.get(r.material) ?? {
      material: r.material,
      lots: [],
      availableMg: 0,
      quarantineMg: 0,
    };
    m.lots.push(r.lot);
    if (r.state === "released") m.availableMg += r.onHand;
    else m.quarantineMg += r.onHand;
    byMaterial.set(r.material, m);
  }
  inventory = [...byMaterial.values()];
  lines.push("");
  lines.push(`Opening inventory at Plant ${plant}:`);
  for (const m of inventory) {
    lines.push(
      `  ${m.material.padEnd(5)}${formatKg(m.availableMg).padStart(18)} available${m.quarantineMg ? `, ${formatKg(m.quarantineMg)} on hold` : ""}  (${m.lots.join(", ")})`,
    );
  }
}

// A workbook with a sales tab (FICTIONAL_DATA §14) gets Kevin's reading of it too.
let sales: SalesAnalysis | null = null;
if (sheets.some((s) => /sales/i.test(s.name))) {
  sales = analyzeSalesSheets(sheets);
  lines.push("");
  lines.push(`Kevin on "${sheets.find((s) => /sales/i.test(s.name))?.name}": ${sales.message}`);
  for (const m of sales.mismatches) lines.push(`  ${m.message}`);
}

console.log(lines.join("\n"));
if (json) {
  console.log(
    JSON.stringify({
      file: basename(file),
      sheet: analysis.sheet,
      asOf,
      message: analysis.message,
      mapping: analysis.mapping,
      rows: analysis.rows.length,
      flags: analysis.flags,
      result,
      inventory,
      sales,
    }),
  );
}
process.exit(result?.status === "unresolved" ? 1 : 0);
