// The import wizard behind the HTTP API (FEATURES_V2 §1): a spreadsheet comes in, Kevin's
// reading goes back, and the person's answers post it. Ray's sheet is a snapshot from before the
// acquisition (FICTIONAL_DATA §12), so it imports into its own empty Plant B ledger, not into
// the demo run's seeded one, where its lots would be counted twice.

import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  type Analysis,
  analyzeInventorySheet,
  fileSha256,
  ledgerLotCodes,
  type Mapping,
  type PostResult,
  postImport,
  type Resolution,
} from "@day-one/server/import/inventory";
import { analyzeSalesSheets, type SalesAnalysis } from "@day-one/server/import/sales";
import { readCsv, readXlsx, type Sheet } from "@day-one/server/import/xlsx";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import {
  facilities,
  lotBalances,
  lots,
  materials,
  spreadsheetImports,
} from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { INVENTORY_AS_OF, INVENTORY_FILE } from "@day-one/server/seed/inventorySheet";
import { eq } from "drizzle-orm";
import { REPO_ROOT } from "./env.ts";
import { SessionError } from "./session.ts";

export const IMPORTS_DIR = join(REPO_ROOT, "data", "imports");

/** What a screen draws for one uploaded file. */
export interface ImportView {
  id: string;
  fileName: string;
  sheets: string[];
  analysis: Analysis;
  sales: SalesAnalysis | null;
  /** The fixture's recorded answers, offered as a shortcut for the demo; null for other files. */
  suggestedAnswers: Record<string, Resolution> | null;
  /** True when this file is already in at the plant; `opening` then shows what it posted. */
  posted: boolean;
  opening: OpeningLine[];
}

export interface OpeningLine {
  material: string;
  name: string;
  lots: string[];
  availableBase: number;
  holdBase: number;
}

interface Upload {
  fileName: string;
  bytes: Buffer;
  sheets: Sheet[];
  analysis: Analysis;
  sales: SalesAnalysis | null;
}

export class ImportDesk {
  #db: Ledger = ImportDesk.#emptyPlant();
  #uploads = new Map<string, Upload>();
  readonly plant = "B";

  static #emptyPlant() {
    const db = openLedger();
    seedLedger(db, { referenceOnly: true });
    return db;
  }

  reset() {
    this.#db = ImportDesk.#emptyPlant();
    this.#uploads.clear();
  }

  /** Reads a file: an uploaded body, or a file name in data/imports (the fixture). */
  upload(input: { bytes: Buffer; name?: string } | { file: string }): ImportView {
    let bytes: Buffer;
    let fileName: string;
    if ("file" in input) {
      fileName = basename(input.file);
      try {
        bytes = readFileSync(join(IMPORTS_DIR, fileName));
      } catch {
        throw new SessionError(404, `no file ${fileName} in data/imports`);
      }
    } else {
      bytes = input.bytes;
      fileName = basename(input.name ?? "upload.xlsx");
    }
    let sheets: Sheet[];
    try {
      sheets =
        extname(fileName).toLowerCase() === ".csv"
          ? [readCsv(bytes.toString("utf8"), basename(fileName, ".csv"))]
          : readXlsx(bytes);
    } catch (error) {
      throw new SessionError(422, `could not read ${fileName} as a spreadsheet: ${message(error)}`);
    }
    const first = sheets[0];
    if (!first) throw new SessionError(422, `${fileName} has no sheets`);
    const analysis = this.#analyze(first);
    let sales: SalesAnalysis | null = null;
    if (sheets.some((s) => /sales/i.test(s.name))) {
      try {
        sales = analyzeSalesSheets(sheets);
      } catch {
        sales = null;
      }
    }
    const id = fileSha256(bytes);
    this.#uploads.set(id, { fileName, bytes, sheets, analysis, sales });
    return this.#view(id);
  }

  /** A person's correction of the column mapping; Kevin reads the sheet again with it. */
  remap(id: string, mapping: Mapping): ImportView {
    const u = this.#get(id);
    const first = u.sheets[0] as Sheet;
    u.analysis = this.#analyze(first, mapping);
    return this.#view(id);
  }

  confirm(
    id: string,
    answers: Record<string, Resolution>,
    staffName = "Ray Delgado",
  ): { result: PostResult; opening: OpeningLine[] } {
    const u = this.#get(id);
    const result = postImport(this.#db, u.analysis, answers, {
      facility: this.plant,
      fileName: u.fileName,
      file: u.bytes,
      confirmedBy: staffName,
      at: new Date().toISOString(),
    });
    return { result, opening: this.opening() };
  }

  /** The plant's opening inventory and the posted imports with their review queues. */
  state() {
    return {
      plant: this.plant,
      opening: this.opening(),
      imports: this.#db
        .select()
        .from(spreadsheetImports)
        .all()
        .map((i) => ({
          id: i.id,
          fileName: i.fileName,
          sheet: i.sheet,
          asOf: i.asOf,
          rowsFound: i.rowsFound,
          lotsPosted: i.lotsPosted,
          review: JSON.parse(i.reviewJson) as { row: number; item: string; reason: string }[],
          postedAt: i.postedAt,
        })),
    };
  }

  opening(): OpeningLine[] {
    const facility = this.#db
      .select()
      .from(facilities)
      .where(eq(facilities.code, this.plant))
      .get();
    const out = new Map<string, OpeningLine>();
    for (const r of this.#db
      .select({
        code: materials.code,
        name: materials.name,
        lot: lots.lotCode,
        state: lots.state,
        onHand: lotBalances.onHandBase,
      })
      .from(lotBalances)
      .innerJoin(lots, eq(lots.id, lotBalances.lotId))
      .innerJoin(materials, eq(materials.id, lots.materialId))
      .where(eq(lotBalances.facilityId, facility?.id ?? -1))
      .all()) {
      const line = out.get(r.code) ?? {
        material: r.code,
        name: r.name,
        lots: [],
        availableBase: 0,
        holdBase: 0,
      };
      line.lots.push(r.lot);
      if (r.state === "released") line.availableBase += r.onHand;
      else line.holdBase += r.onHand;
      out.set(r.code, line);
    }
    return [...out.values()];
  }

  #analyze(sheet: Sheet, mapping?: Mapping) {
    try {
      return analyzeInventorySheet(sheet, {
        asOf: INVENTORY_AS_OF,
        existingLots: ledgerLotCodes(this.#db),
        ...(mapping ? { mapping } : {}),
      });
    } catch (error) {
      throw new SessionError(422, message(error));
    }
  }

  #get(id: string) {
    const u = this.#uploads.get(id);
    if (!u)
      throw new SessionError(404, `no upload ${id}; send the file to POST /api/imports first`);
    return u;
  }

  #view(id: string): ImportView {
    const u = this.#get(id);
    const posted = this.#db
      .select()
      .from(spreadsheetImports)
      .all()
      .some((i) => i.fileSha256 === id);
    let suggestedAnswers: Record<string, Resolution> | null = null;
    if (u.fileName === INVENTORY_FILE) {
      suggestedAnswers = JSON.parse(
        readFileSync(join(IMPORTS_DIR, INVENTORY_FILE.replace(/\.xlsx$/, ".answers.json")), "utf8"),
      ) as Record<string, Resolution>;
    }
    return {
      id,
      fileName: u.fileName,
      sheets: u.sheets.map((s) => s.name),
      analysis: u.analysis,
      sales: u.sales,
      suggestedAnswers,
      posted,
      opening: this.opening(),
    };
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
