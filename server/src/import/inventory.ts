// The spreadsheet import wizard's engine (FEATURES_V2 §1, FICTIONAL_DATA §12): a plant's
// hand-kept inventory sheet in, opening stock out. Kevin reads it the way a careful new hire
// would and never fixes anything silently: each problem row gets a flag with what he proposes,
// a person answers every flag, and only then do the rows post, through appendLotEvent with the
// same received → quarantined → released steps the seed uses for opening stock. Rows nobody can
// map wait in a review queue. Deterministic throughout: no LLM, so it works offline.

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";
import { appendLotEvent } from "../ledger/events.ts";
import { facilities, lots, materials, spreadsheetImports, staff } from "../ledger/schema.ts";
import { MATERIALS, UNITS } from "../seed/reference.ts";
import type { Cell, Sheet } from "./xlsx.ts";

export const FIELDS = ["item", "lot", "qty", "unit", "location", "expiry", "notes"] as const;
export type Field = (typeof FIELDS)[number];
/** Column index per field; a field the sheet does not have is absent. */
export type Mapping = Partial<Record<Field, number>>;

const HEADER_PATTERNS: Record<Field, RegExp> = {
  item: /^(item|material|description|name|product)\b/i,
  lot: /\blot\b/i,
  qty: /^(qty|quantity|amount|on hand|count)\b/i,
  unit: /^(unit|units|uom|u\/m)$/i,
  location: /^(where|location|loc|bin|rack)\b/i,
  expiry: /^(exp|expiry|expires|expiration|use by)\b/i,
  notes: /^(notes?|comments?|remarks?)\b/i,
};

export const FLAG_KINDS = [
  "duplicate",
  "duplicate_conflict",
  "short_name",
  "name_conflict",
  "unit_conversion",
  "unit_missing",
  "unit_mismatch",
  "expired",
  "expiry_unreadable",
  "quantity_text",
  "missing_lot",
  "lot_exists",
  "unknown_material",
  "totals_row",
] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

/** What a person can answer: take Kevin's proposal, type the quantity, or hold the row back. */
export type Answer = "accept" | "quantity" | "review";

export interface Flag {
  id: string;
  row: number;
  kind: FlagKind;
  message: string;
  /** Kevin's proposal in words; null when he has none and asks instead. */
  proposal: string | null;
  answers: readonly Answer[];
}

export type Resolution =
  | { answer: "accept" }
  | { answer: "review" }
  | { answer: "quantity"; qty: number; unit: string };

export interface SheetRow {
  /** 1-based among the data rows, as the fixture numbers them. */
  row: number;
  /** 1-based row in the sheet, as the spreadsheet program shows it. */
  sheetRow: number;
  item: string;
  lotTyped: string | null;
  qtyTyped: Cell;
  unitTyped: string | null;
  location: string | null;
  expiryTyped: string | null;
  notes: string | null;
  material: string | null;
  lotCode: string | null;
  qtyBase: number | null;
  expiresOn: string | null;
  flags: Flag[];
}

export interface Analysis {
  sheet: string;
  asOf: string;
  headerRow: number;
  mapping: Mapping;
  rows: SheetRow[];
  flags: Flag[];
  /** Kevin's opening line. */
  message: string;
}

// ----------------------------------------------------------------- reading cells

const str = (c: Cell | undefined) => {
  if (c === null || c === undefined) return null;
  const s = String(c).trim();
  return s === "" ? null : s;
};

/** Words worth matching: letter runs of four or more and number runs; "PH102" → "102". */
function tokens(name: string) {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFKD")
      .split(/[^a-z0-9]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/)
      .filter((w) => /^\d+$/.test(w) || /^[a-z]{4,}$/.test(w)),
  );
}

const MASTER = MATERIALS.map((m) => ({ ...m, words: tokens(m.name) }));
const masterByCode = new Map(MASTER.map((m) => [m.code, m]));

/** The master material whose name shares the most words (by overlap ratio), if one is best. */
function matchName(name: string) {
  const typed = tokens(name);
  let best: { code: string; score: number } | null = null;
  let tie = false;
  for (const m of MASTER) {
    let shared = 0;
    for (const w of typed) if (m.words.has(w)) shared++;
    if (shared === 0) continue;
    const score = shared / new Set([...typed, ...m.words]).size;
    if (!best || score > best.score) {
      best = { code: m.code, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.code : null;
}

function parseQty(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) && c > 0 ? c : null;
  const s = str(c);
  if (!s || !/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return n > 0 ? n : null;
}

const UNIT_ALIASES: Record<string, string> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  g: "g",
  gm: "g",
  grams: "g",
  mg: "mg",
  lb: "lb",
  lbs: "lb",
  "#": "lb",
  ea: "each",
  each: "each",
  pcs: "each",
  pc: "each",
};

function unitOf(typed: string | null) {
  if (!typed) return null;
  const code = UNIT_ALIASES[typed.toLowerCase().replace(/\.$/, "")] ?? null;
  return code ? (UNITS.find((u) => u.code === code) ?? null) : null;
}

/** Base units (mg or each) for a quantity in a unit; null when the dimension is wrong. */
function toBaseUnits(qty: number, unit: (typeof UNITS)[number], uom: "kg" | "ea") {
  if ((uom === "kg") !== (unit.dimension === "mass")) return null;
  return Math.round((qty * unit.num) / unit.den);
}

/** 49_985_879 mg → "49.985 879 kg"; 562_500_000 → "562.500 kg". */
export function formatKg(mg: number) {
  const whole = Math.floor(mg / 1_000_000);
  const frac = String(mg % 1_000_000).padStart(6, "0");
  return `${whole.toLocaleString("en-US")}.${frac.slice(0, 3)}${frac.endsWith("000") ? "" : ` ${frac.slice(3)}`} kg`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "08/2028" → the last day of that month; "MM/DD/YYYY" and ISO dates as given. */
function parseExpiry(typed: string): string | null {
  let m = /^(\d{1,2})\/(\d{4})$/.exec(typed);
  if (m) {
    const month = Number(m[1]);
    if (month < 1 || month > 12) return null;
    const last = new Date(Date.UTC(Number(m[2]), month, 0));
    return last.toISOString().slice(0, 10);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(typed);
  if (m) {
    const year = (m[3] ?? "").length === 2 ? `20${m[3]}` : (m[3] ?? "");
    return `${year}-${(m[1] ?? "").padStart(2, "0")}-${(m[2] ?? "").padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(typed) ? typed : null;
}

// ----------------------------------------------------------------- the analysis

/** The first row whose cells name at least three of the known columns, and its mapping. */
export function proposeMapping(sheet: Sheet): { headerRow: number; mapping: Mapping } {
  for (let r = 0; r < sheet.rows.length; r++) {
    const mapping: Mapping = {};
    (sheet.rows[r] ?? []).forEach((cell, c) => {
      const s = str(cell);
      if (!s) return;
      const field = FIELDS.find((f) => mapping[f] === undefined && HEADER_PATTERNS[f].test(s));
      if (field) mapping[field] = c;
    });
    if (Object.keys(mapping).length >= 3 && mapping.item !== undefined) {
      return { headerRow: r, mapping };
    }
  }
  throw new Error(`import: no header row in sheet "${sheet.name}"`);
}

export interface AnalyzeOptions {
  /** The date the sheet was kept "as of" (YYYY-MM-DD); expiry is judged against it. */
  asOf: string;
  /** A person's correction of the proposed column mapping. */
  mapping?: Mapping;
  /** Lot codes already in the ledger, which an import must not reuse. */
  existingLots?: ReadonlySet<string>;
}

export function analyzeInventorySheet(sheet: Sheet, options: AnalyzeOptions): Analysis {
  const proposed = proposeMapping(sheet);
  const mapping = options.mapping ?? proposed.mapping;
  const existing = options.existingLots ?? new Set<string>();
  const get = (cells: Cell[], f: Field) =>
    mapping[f] === undefined ? null : (cells[mapping[f] as number] ?? null);

  const rows: SheetRow[] = [];
  for (let r = proposed.headerRow + 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] ?? [];
    if (cells.every((c) => str(c) === null)) continue;
    rows.push({
      row: rows.length + 1,
      sheetRow: r + 1,
      item: str(get(cells, "item")) ?? "",
      lotTyped: str(get(cells, "lot")),
      qtyTyped: get(cells, "qty"),
      unitTyped: str(get(cells, "unit")),
      location: str(get(cells, "location")),
      expiryTyped: str(get(cells, "expiry")),
      notes: str(get(cells, "notes")),
      material: null,
      lotCode: null,
      qtyBase: null,
      expiresOn: null,
      flags: [],
    });
  }

  const flags: Flag[] = [];
  const flag = (row: SheetRow, kind: FlagKind, message: string, proposal: string | null) => {
    const answers: readonly Answer[] =
      kind === "unknown_material" ||
      kind === "lot_exists" ||
      kind === "duplicate_conflict" ||
      kind === "unit_mismatch"
        ? ["review"]
        : kind === "quantity_text" || kind === "unit_missing"
          ? ["quantity", "review"]
          : kind === "totals_row"
            ? ["accept"]
            : ["accept", "review"];
    const f = { id: `F${flags.length + 1}`, row: row.row, kind, message, proposal, answers };
    flags.push(f);
    row.flags.push(f);
  };

  const seenLots = new Map<string, SheetRow>();
  const assigned = new Set<string>();
  const datePart = options.asOf.slice(2).replace(/-/g, "");

  for (const row of rows) {
    if (/^(grand\s+)?totals?\b/i.test(row.item) && !row.lotTyped) {
      flag(row, "totals_row", `Row ${row.row} is a total, not stock.`, "Skip it");
      continue;
    }

    // Material: from the lot code's prefix when it is a master code, checked against the name.
    const prefix = row.lotTyped?.split("-")[0]?.toUpperCase() ?? null;
    const byLot = prefix && masterByCode.has(prefix) ? prefix : null;
    const byName = matchName(row.item);
    if (byLot && byName === byLot) row.material = byLot;
    else if (byLot && !byName) {
      row.material = byLot;
      flag(
        row,
        "short_name",
        `"${row.item}" is not a name on your material list; the lot code says ${masterByCode.get(byLot)?.name.toLowerCase()} (${byLot}).`,
        `Map to ${masterByCode.get(byLot)?.name} (${byLot})`,
      );
    } else if (byLot && byName) {
      row.material = byLot;
      flag(
        row,
        "name_conflict",
        `"${row.item}" reads like ${masterByCode.get(byName)?.name.toLowerCase()}, but the lot code says ${masterByCode.get(byLot)?.name.toLowerCase()}.`,
        `Map to ${masterByCode.get(byLot)?.name} (${byLot}), as the lot code says`,
      );
    } else if (byName) row.material = byName;
    else {
      flag(
        row,
        "unknown_material",
        `${row.item} is not on your material list.`,
        "Hold it for review; it is not imported",
      );
      continue;
    }
    const mat = masterByCode.get(row.material);
    if (!mat) continue;

    // The same lot twice: identical lines count once; different quantities need a person.
    const lotKey = row.lotTyped?.toUpperCase() ?? null;
    const earlier = lotKey ? seenLots.get(lotKey) : undefined;
    if (earlier) {
      const same =
        String(earlier.qtyTyped) === String(row.qtyTyped) &&
        (earlier.unitTyped ?? "") === (row.unitTyped ?? "");
      if (same) {
        flag(
          row,
          "duplicate",
          `Row ${row.row} has the same lot and quantity as row ${earlier.row} (${row.lotTyped}, ${row.qtyTyped} ${row.unitTyped ?? ""}) under another name.`.replace(
            " )",
            ")",
          ),
          "Count it once",
        );
      } else {
        flag(
          row,
          "duplicate_conflict",
          `Lot ${row.lotTyped} is on rows ${earlier.row} and ${row.row} with different quantities.`,
          null,
        );
      }
      continue;
    }
    if (lotKey) seenLots.set(lotKey, row);

    // Lot code.
    if (row.lotTyped) {
      row.lotCode = row.lotTyped.toUpperCase();
      if (existing.has(row.lotCode)) {
        flag(row, "lot_exists", `Lot ${row.lotCode} is already in the ledger.`, null);
        continue;
      }
    } else {
      let seq = 1;
      let code = "";
      do code = `${mat.code}-${datePart}-${String(seq++).padStart(2, "0")}`;
      while (existing.has(code) || assigned.has(code) || seenLots.has(code));
      assigned.add(code);
      row.lotCode = code;
      flag(
        row,
        "missing_lot",
        `Row ${row.row} (${row.item}) has no lot number.`,
        `Assign internal lot ${code}, noted "lot assigned at import"`,
      );
    }

    // Quantity and unit.
    const qty = parseQty(row.qtyTyped);
    const unit = unitOf(row.unitTyped);
    if (qty === null) {
      flag(
        row,
        "quantity_text",
        `The quantity for ${row.item} is "${String(row.qtyTyped ?? "")}", not a number.`,
        null,
      );
    } else if (!unit) {
      flag(
        row,
        row.unitTyped ? "unit_mismatch" : "unit_missing",
        row.unitTyped
          ? `"${row.unitTyped}" is not a unit I know for ${row.item}.`
          : `${row.item} has a quantity but no unit.`,
        null,
      );
    } else {
      const base = toBaseUnits(qty, unit, mat.uom);
      if (base === null) {
        flag(
          row,
          "unit_mismatch",
          `${row.item} is counted in ${mat.uom === "kg" ? "kilograms" : "units"}, not ${unit.code}.`,
          null,
        );
      } else {
        row.qtyBase = base;
        if (unit.code === "lb") {
          flag(
            row,
            "unit_conversion",
            `Row ${row.row} (${row.item}) is in pounds.`,
            `${qty} lb = ${formatKg(base)}`,
          );
        }
      }
    }

    // Expiry against the sheet's date.
    if (row.expiryTyped) {
      row.expiresOn = parseExpiry(row.expiryTyped);
      if (!row.expiresOn) {
        flag(
          row,
          "expiry_unreadable",
          `I can't read the expiry "${row.expiryTyped}" for ${row.item}.`,
          "Import it with no expiry date",
        );
      } else if (row.expiresOn < options.asOf) {
        flag(
          row,
          "expired",
          `Lot ${row.lotCode} expired ${row.expiryTyped}, before the sheet's date.`,
          'Import it on hold, noted "expired, hold for disposal"',
        );
      }
    }
  }

  return {
    sheet: sheet.name,
    asOf: options.asOf,
    headerRow: proposed.headerRow + 1,
    mapping,
    rows,
    flags,
    message: openingMessage(rows, flags),
  };
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Kevin's first line: how many rows, how many need a person, and why, in plant words. */
function openingMessage(rows: SheetRow[], flags: Flag[]) {
  const by = (kind: FlagKind) => flags.filter((f) => f.kind === kind);
  const rowOf = (f: Flag) => rows.find((r) => r.row === f.row);
  const parts: string[] = [];
  const dup = by("duplicate");
  if (dup.length) {
    const name = masterByCode.get(rowOf(dup[0] as Flag)?.material ?? "")?.name.toLowerCase();
    parts.push(
      dup.length === 1
        ? `1 looks like the same ${name} lot entered twice`
        : `${dup.length} look like lots entered twice`,
    );
  }
  const short = by("short_name");
  if (short.length) {
    const name = masterByCode.get(rowOf(short[0] as Flag)?.material ?? "")?.name.toLowerCase();
    parts.push(
      short.length === 1 ? `1 uses a short name for ${name}` : `${short.length} use short names`,
    );
  }
  if (by("name_conflict").length)
    parts.push(
      n(
        by("name_conflict").length,
        "has a name that disagrees with its lot code",
        "have names that disagree with their lot codes",
      ),
    );
  if (by("unit_conversion").length)
    parts.push(n(by("unit_conversion").length, "is in pounds", "are in pounds"));
  const expired = by("expired");
  if (expired.length) {
    const month = Number(rowOf(expired[0] as Flag)?.expiresOn?.slice(5, 7));
    parts.push(
      expired.length === 1
        ? `1 lot expired in ${MONTHS[month - 1]}`
        : `${expired.length} lots are past their expiry`,
    );
  }
  if (by("quantity_text").length)
    parts.push(
      n(by("quantity_text").length, "quantity isn't a number", "quantities aren't numbers"),
    );
  if (by("unit_missing").length)
    parts.push(n(by("unit_missing").length, "has no unit", "have no unit"));
  if (by("unit_mismatch").length)
    parts.push(n(by("unit_mismatch").length, "has a unit I can't use", "have units I can't use"));
  if (by("expiry_unreadable").length)
    parts.push(
      n(by("expiry_unreadable").length, "expiry date I can't read", "expiry dates I can't read"),
    );
  if (by("missing_lot").length)
    parts.push(n(by("missing_lot").length, "has no lot number", "have no lot number"));
  if (by("lot_exists").length)
    parts.push(
      n(by("lot_exists").length, "lot is already in the ledger", "lots are already in the ledger"),
    );
  if (by("duplicate_conflict").length)
    parts.push(
      n(
        by("duplicate_conflict").length,
        "lot is listed twice with different quantities",
        "lots are listed twice with different quantities",
      ),
    );
  const unknown = by("unknown_material");
  if (unknown.length) {
    const names = unknown.map((f) => rowOf(f)?.item).join(", ");
    parts.push(
      unknown.length === 1
        ? `1 material (${names}) isn't on your material list`
        : `${unknown.length} materials (${names}) aren't on your material list`,
    );
  }
  const totals = by("totals_row");
  if (totals.length) {
    const last = rows.at(-1)?.row;
    parts.push(
      totals.length === 1 && totals[0]?.row === last
        ? "the last row is a total"
        : n(totals.length, "is a total row", "are total rows"),
    );
  }
  const flagged = new Set(flags.map((f) => f.row)).size;
  const found = `Found ${n(rows.length, "row", "rows")}.`;
  if (flagged === 0) return `${found} Every row maps cleanly.`;
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
  return `${found} ${flagged} need${flagged === 1 ? "s" : ""} your eyes: ${list}.`;
}

// ----------------------------------------------------------------- the plan to post

export interface PlannedLot {
  row: number;
  lotCode: string;
  material: string;
  qtyBase: number;
  expiresOn: string | null;
  hold: boolean;
  note: string | null;
}

export interface ImportPlan {
  lots: PlannedLot[];
  review: { row: number; item: string; reason: string }[];
  skipped: { row: number; item: string; reason: string }[];
  /** Flags still waiting for an answer, or answered with something they do not allow. */
  unresolved: string[];
}

/** What would post with these answers. Nothing posts while any flag is unresolved. */
export function planImport(
  analysis: Analysis,
  resolutions: Readonly<Record<string, Resolution>>,
): ImportPlan {
  const plan: ImportPlan = { lots: [], review: [], skipped: [], unresolved: [] };
  for (const row of analysis.rows) {
    let qtyBase = row.qtyBase;
    let hold = false;
    const notes: string[] = [];
    let outcome: "post" | "review" | "skip" = "post";
    let reason = "";
    for (const f of row.flags) {
      const res = resolutions[f.id];
      if (!res || !f.answers.includes(res.answer)) {
        plan.unresolved.push(f.id);
        continue;
      }
      if (res.answer === "review") {
        outcome = "review";
        reason = f.message;
        continue;
      }
      if (res.answer === "quantity") {
        const mat = masterByCode.get(row.material ?? "");
        const unit = unitOf(res.unit);
        const base = mat && unit && res.qty > 0 ? toBaseUnits(res.qty, unit, mat.uom) : null;
        if (base === null) plan.unresolved.push(f.id);
        else {
          qtyBase = base;
          notes.push(`quantity entered at import: ${res.qty} ${unit?.code}`);
        }
        continue;
      }
      // accept: take Kevin's proposal.
      if (f.kind === "duplicate") {
        outcome = outcome === "review" ? outcome : "skip";
        reason = `Same lot as an earlier row; counted once.`;
      } else if (f.kind === "totals_row") {
        outcome = "skip";
        reason = "Totals row.";
      } else if (f.kind === "expired") {
        hold = true;
        notes.push("expired, hold for disposal");
      } else if (f.kind === "missing_lot") notes.push("lot assigned at import");
    }
    if (outcome === "review") plan.review.push({ row: row.row, item: row.item, reason });
    else if (outcome === "skip") plan.skipped.push({ row: row.row, item: row.item, reason });
    else if (row.material && row.lotCode && qtyBase !== null) {
      plan.lots.push({
        row: row.row,
        lotCode: row.lotCode,
        material: row.material,
        qtyBase,
        expiresOn: row.expiresOn,
        hold,
        note: notes.length ? notes.join("; ") : null,
      });
    }
    // Any other row lacks a material, lot or quantity, so it carries a flag still unresolved.
  }
  return plan;
}

// ----------------------------------------------------------------- posting

export interface PostOptions {
  facility: string;
  fileName: string;
  file: Buffer;
  /** The person confirming, by name (a staff row). */
  confirmedBy: string;
  /** When the confirm happened (ISO); the opening events are dated the sheet's as-of day. */
  at: string;
}

export type PostResult =
  | { status: "posted"; importId: number; plan: ImportPlan }
  | { status: "already_imported"; importId: number }
  | { status: "unresolved"; plan: ImportPlan };

export const fileSha256 = (file: Buffer) => createHash("sha256").update(file).digest("hex");

/** Lot codes already in the ledger, for `existingLots`. */
export function ledgerLotCodes(db: Ledger) {
  return new Set(
    db
      .select({ code: lots.lotCode })
      .from(lots)
      .all()
      .map((l) => l.code),
  );
}

/**
 * Posts the planned lots as opening stock at the plant, once per file: the same file hash at
 * the same plant returns the earlier import and writes nothing.
 */
export function postImport(
  db: Ledger,
  analysis: Analysis,
  resolutions: Readonly<Record<string, Resolution>>,
  options: PostOptions,
): PostResult {
  const facility = db.select().from(facilities).where(eq(facilities.code, options.facility)).get();
  if (!facility) throw new Error(`import: no facility ${options.facility}`);
  const hash = fileSha256(options.file);
  const earlier = db
    .select()
    .from(spreadsheetImports)
    .all()
    .find((i) => i.facilityId === facility.id && i.fileSha256 === hash);
  if (earlier) return { status: "already_imported", importId: earlier.id };

  const plan = planImport(analysis, resolutions);
  if (plan.unresolved.length > 0) return { status: "unresolved", plan };
  const person = db.select().from(staff).where(eq(staff.name, options.confirmedBy)).get();
  if (!person) throw new Error(`import: no staff ${options.confirmedBy}`);

  const day = `${analysis.asOf}T00:00:00.000Z`;
  const importId = db.transaction((tx) => {
    for (const lot of plan.lots) {
      const material = tx.select().from(materials).where(eq(materials.code, lot.material)).get();
      if (!material) throw new Error(`import: no material ${lot.material}`);
      const row = tx
        .insert(lots)
        .values({ lotCode: lot.lotCode, materialId: material.id, expiresOn: lot.expiresOn })
        .returning()
        .get();
      const reason = `Opening stock from ${options.fileName}, row ${lot.row}`;
      const event = (kind: "received" | "quarantined" | "released", qty: number, why: string) =>
        appendLotEvent(tx, {
          lotId: row.id,
          kind,
          qtyDeltaBase: qty,
          facilityId: facility.id,
          actorType: "staff",
          actorId: person.id,
          reason: why,
          occurredAt: day,
          recordedAt: options.at,
        });
      event("received", lot.qtyBase, lot.note ? `${reason} (${lot.note})` : reason);
      event("quarantined", 0, lot.hold ? (lot.note ?? reason) : reason);
      if (!lot.hold) event("released", 0, reason);
    }
    return tx
      .insert(spreadsheetImports)
      .values({
        facilityId: facility.id,
        fileName: options.fileName,
        fileSha256: hash,
        sheet: analysis.sheet,
        asOf: analysis.asOf,
        rowsFound: analysis.rows.length,
        lotsPosted: plan.lots.length,
        reviewJson: JSON.stringify(plan.review),
        resolutionsJson: JSON.stringify(resolutions),
        postedBy: person.id,
        postedAt: options.at,
      })
      .returning()
      .get().id;
  });
  return { status: "posted", importId, plan };
}
