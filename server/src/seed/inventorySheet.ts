// Ray's inventory workbook before the acquisition (docs/FICTIONAL_DATA.md §12 and §14), cell for
// cell. `npm run render:import` writes it to data/imports/ as the .xlsx the import wizard reads;
// the import tests read that committed file, so the fixture and the parser cannot drift apart.

import type { Sheet } from "../import/xlsx.ts";

export const INVENTORY_FILE = "INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx";

/** The snapshot date Ray kept the sheet "as of". */
export const INVENTORY_AS_OF = "2026-10-01";

const inventory: Sheet = {
  name: "Inventory",
  rows: [
    ["HOLLOW PINE INVENTORY — DO NOT SORT"],
    ["Item", "Lot #", "Qty", "Unit", "Where", "Exp", "Notes"],
    [],
    ["Ascorbic Acid", "ASC-260815-01", 412.5, "kg", "Cage 2", "08/2028"],
    ["Vit C (ascorbic) fine powder", "ASC-260815-01", 412.5, "kg", "Cage 2", "08/2028"],
    ["ASC", "ASC-260702-03", 150, "kg", "Cage 2", "07/2028", "partial"],
    ["Sorbitol", "SOR-260810-01", 620, "kg", "Rack A", "08/2028"],
    ["Microcrystalline Cellulose 102", "MCC-260901-01", 300, "kg", "Rack B", "09/2029"],
    ["MCC PH102", "MCC-260820-02", 110.2, "lb", "Rack B", "08/2029"],
    ["Citric Acid Anhyd.", "CTA-260905-01", 200, "kg", "Rack C", "09/2028"],
    ["Citric acid", "CTA-260611-02", 55.1, "lb", "Rack C", "06/2028"],
    ["Orange flavor nat.", "FOR-260301-01", 18, "kg", "Flavor rm", "03/2026"],
    ["Orange flavor nat.", "FOR-260915-02", 25, "kg", "Flavor rm", "09/2027"],
    ["Mag Stearate", "MGS-260822-01", 40, "kg", "Rack B", "08/2028"],
    ["Silicon dioxide", "SIO-260710-01", 12, "kg", "Rack B", "07/2029"],
    ["Sucralose", "SUC-260601-01", "~6 kg", null, "Flavor rm", "06/2028", "weigh it"],
    ["Calcium carbonate", "CAC-260815-01", 900, "kg", "Rack D", "08/2029"],
    ["Mag oxide", "MGO-260818-01", 180, "kg", "Rack D", "08/2029"],
    ["Croscarmellose", "CCS-260720-01", 30, "kg", "Rack B", "07/2028"],
    ["Stearic acid", null, 22, "kg", "Rack B", "05/2028", "lot label torn"],
    ["Xanthan Gum", "XG-0412", 10, "kg", "Cage 1", "04/2027", "from old product"],
    ["TOTAL", null, 3497.3],
  ],
};

const SALES: [string, string, string, number, number, number][] = [
  ["Cardinal Mart", "CM-448120", "60 ct", 4_610, 4_700, 4_820],
  ["Cardinal Mart", "CM-448121", "120 ct", 2_020, 2_090, 2_150],
  ["PillBox Pharmacy", "PB-7731-06", "100 ct", 3_150, 3_240, 3_300],
  ["Brightway Grocers", "BW-20-0915", "60 ct", 1_880, 1_910, 1_940],
  ["Online store", "HP-E216", "216 ct", 540, 575, 610],
  ["Online store", "HP-E256", "256 ct", 400, 430, 455],
  ["EU distributor", 'EU-VC500-90 "Vitamine C 500 mg à croquer"', "90 ct", 1_100, 1_150, 1_200],
];

const sales: Sheet = {
  name: "Sales by customer",
  rows: [
    ["VC500 — Vitamin C 500 mg Chewable, units sold"],
    ["Customer", "Customer SKU", "Pack", "Aug", "Sep", "Oct"],
    ...SALES.map((row) => [...row]),
  ],
};

// §14: the October column retyped by hand, with Cardinal Mart 60 ct transposed to 4,280.
const summary: Sheet = {
  name: "Summary",
  rows: [
    ["October units (typed from Sales tab)"],
    ["Customer", "Pack", "Oct"],
    ...SALES.map(([customer, , pack, , , oct]) => [
      customer,
      pack,
      customer === "Cardinal Mart" && pack === "60 ct" ? 4_280 : oct,
    ]),
  ],
};

export const INVENTORY_WORKBOOK: readonly Sheet[] = [inventory, sales, summary];
