// The "Sales by customer" tab of a plant's workbook (FICTIONAL_DATA §14): units sold per
// customer SKU and month, turned into tablets and into the active material those tablets
// carried. A hand-retyped Summary tab is checked against it, and a figure that disagrees is
// asked about, never picked. Deterministic: no LLM. The result informs the forecast as history
// and never overrides the ledger's actual usage from batch records.

import { EXPECTED_YIELD_BP, MATERIALS, PRODUCTS } from "../seed/reference.ts";
import type { Cell, Sheet } from "./xlsx.ts";

const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;

export interface SkuLine {
  customer: string;
  sku: string;
  /** Tablets per unit sold, from the pack column ("60 ct"). */
  count: number;
  units: number[];
  tablets: number[];
}

export interface ActiveUse {
  material: string;
  name: string;
  mgPerTablet: number;
  /** In the tablets sold, per month. */
  inTabletsMg: number[];
  /** Issued to make them at the expected yield, per month. */
  issuedMg: number[];
}

export interface Mismatch {
  customer: string;
  pack: string;
  month: string;
  sales: number;
  summary: number;
  message: string;
}

export interface SalesAnalysis {
  product: string;
  months: string[];
  lines: SkuLine[];
  tabletsByMonth: number[];
  actives: ActiveUse[];
  mismatches: Mismatch[];
  /** Kevin's line on the latest month. */
  message: string;
}

const str = (c: Cell | undefined) => {
  if (c === null || c === undefined) return null;
  const s = String(c).trim();
  return s === "" ? null : s;
};

const num = (c: Cell | undefined) => {
  if (typeof c === "number") return c;
  const s = str(c);
  return s && /^\d[\d,]*$/.test(s) ? Number(s.replace(/,/g, "")) : null;
};

const packCount = (pack: string) => {
  const m = /^(\d+)\s*(ct|count|tabs?|tablets?)\b/i.exec(pack.trim());
  return m ? Number(m[1]) : null;
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** The header row: Customer, a SKU column, Pack, then month columns. */
function header(sheet: Sheet) {
  for (let r = 0; r < sheet.rows.length; r++) {
    const cells = (sheet.rows[r] ?? []).map((c) => str(c) ?? "");
    const customer = cells.findIndex((c) => /^customer$/i.test(c));
    const pack = cells.findIndex((c) => /^pack/i.test(c));
    const months = cells.flatMap((c, i) => (MONTH.test(c) ? [i] : []));
    if (customer >= 0 && pack >= 0 && months.length > 0) {
      const sku = cells.findIndex((c) => /sku/i.test(c));
      return { row: r, customer, sku, pack, months, names: months.map((i) => cells[i] ?? "") };
    }
  }
  return null;
}

/** The product the tab is about, from a product code in its title row ("VC500 — …"). */
function productOf(sheet: Sheet, headerRow: number) {
  const title = sheet.rows
    .slice(0, headerRow)
    .flat()
    .map((c) => str(c) ?? "")
    .join(" ");
  return PRODUCTS.find((p) => new RegExp(`\\b${p.code.replace(/^P-/, "")}\\b`, "i").test(title));
}

export function analyzeSalesSheets(sheets: readonly Sheet[]): SalesAnalysis {
  const sales = sheets.find((s) => /sales/i.test(s.name));
  if (!sales) throw new Error("import: no sales tab");
  const h = header(sales);
  if (!h) throw new Error(`import: no header row in "${sales.name}"`);
  const product = productOf(sales, h.row);
  if (!product) throw new Error(`import: "${sales.name}" does not name a product`);

  const lines: SkuLine[] = [];
  for (const cells of sales.rows.slice(h.row + 1)) {
    const customer = str(cells[h.customer]);
    const pack = str(cells[h.pack]);
    if (!customer || !pack) continue;
    const count = packCount(pack);
    if (count === null) throw new Error(`import: pack "${pack}" for ${customer} has no count`);
    const units = h.months.map((i) => num(cells[i]) ?? 0);
    lines.push({
      customer,
      sku: str(cells[h.sku]) ?? "",
      count,
      units,
      tablets: units.map((u) => u * count),
    });
  }
  const tabletsByMonth = h.months.map((_, m) =>
    lines.reduce((sum, l) => sum + (l.tablets[m] ?? 0), 0),
  );

  const actives: ActiveUse[] = product.lines.flatMap(([code, kgPerBatch]) => {
    const mat = MATERIALS.find((x) => x.code === code);
    if (mat?.category !== "active") return [];
    const mgPerTablet = (kgPerBatch * 1_000_000) / product.batchTablets;
    const inTabletsMg = tabletsByMonth.map((t) => Math.round(t * mgPerTablet));
    return [
      {
        material: code,
        name: mat.name,
        mgPerTablet,
        inTabletsMg,
        issuedMg: inTabletsMg.map((mg) => Math.round((mg * 10_000) / EXPECTED_YIELD_BP)),
      },
    ];
  });

  // A Summary tab retypes figures by hand; compare every one it has with the sales tab.
  const mismatches: Mismatch[] = [];
  const summary = sheets.find((s) => /summary/i.test(s.name));
  const sh = summary ? header(summary) : null;
  if (summary && sh) {
    const main = actives[0];
    for (const cells of summary.rows.slice(sh.row + 1)) {
      const customer = str(cells[sh.customer]);
      const pack = str(cells[sh.pack]);
      if (!customer || !pack) continue;
      const line = lines.find((l) => l.customer === customer && packCount(pack) === l.count);
      sh.names.forEach((month, k) => {
        const typed = num(cells[sh.months[k] as number]);
        const m = h.names.findIndex((n) => n.toLowerCase() === month.toLowerCase());
        const real = line && m >= 0 ? line.units[m] : undefined;
        if (typed === null || real === undefined || typed === real || !line) return;
        const bottles = Math.abs(real - typed);
        const tablets = bottles * line.count;
        const kg = main ? (tablets * main.mgPerTablet) / 1_000_000 : 0;
        mismatches.push({
          customer,
          pack,
          month,
          sales: real,
          summary: typed,
          message: `${customer} ${pack} for ${fullMonth(month)} is ${fmt(real)} on the customer tab and ${fmt(typed)} on Summary. That is ${fmt(bottles)} bottles, ${fmt(tablets)} tablets${main ? `, about ${kg.toFixed(1)} kg of ${main.name.toLowerCase()}` : ""}. Which one is right?`,
        });
      });
    }
  }

  const last = h.months.length - 1;
  const lead = actives[0];
  const message =
    `${fullMonth(h.names[last] ?? "")}: ${fmt(tabletsByMonth[last] ?? 0)} tablets of ${product.code} sold across ${lines.length} customer SKUs` +
    (lead
      ? `, carrying ${roundKg(lead.inTabletsMg[last] ?? 0)} of ${lead.name.toLowerCase()}; at the ${EXPECTED_YIELD_BP / 100}% expected yield that is ${roundKg(lead.issuedMg[last] ?? 0)} issued.`
      : ".") +
    (mismatches.length
      ? ` ${mismatches.length === 1 ? "One figure on Summary disagrees" : `${mismatches.length} figures on Summary disagree`} with the customer tab; I use neither until you say which is right.`
      : "");

  return {
    product: product.code,
    months: h.names,
    lines,
    tabletsByMonth,
    actives,
    mismatches,
    message,
  };
}

const FULL: Record<string, string> = {
  jan: "January",
  feb: "February",
  mar: "March",
  apr: "April",
  may: "May",
  jun: "June",
  jul: "July",
  aug: "August",
  sep: "September",
  oct: "October",
  nov: "November",
  dec: "December",
};
const fullMonth = (m: string) => FULL[m.slice(0, 3).toLowerCase()] ?? m;

/** Milligrams to kilograms at gram precision: 772_408_444 → "772.408 kg". */
const roundKg = (mg: number) => `${(Math.round(mg / 1_000) / 1_000).toFixed(3)} kg`;
