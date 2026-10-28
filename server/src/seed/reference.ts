// Reference data from docs/FICTIONAL_DATA.md §1–5. Every name, formula and vendor is invented.
// Quantities are converted to base units here (mass in mg, count in each); the doc's kg and
// "ea" figures stay readable in this file.

/** mg from kg, exact for up to 6 decimal places. */
export const kg = (n: number) => Math.round(n * 1_000_000);

export const FACILITIES = [
  { code: "ACME", name: "Acme Holdings", role: "hq", account: "acme-holdings.testnet" },
  {
    code: "A",
    name: "Acme Riverside",
    role: "sister",
    account: "plant-a.acme-holdings.testnet",
  },
  {
    code: "B",
    name: "Hollow Pine Tablet Co.",
    role: "acquired",
    account: "plant-b.acme-holdings.testnet",
  },
  {
    code: "C",
    name: "Acme Lakeview",
    role: "packaging",
    account: "plant-c.acme-holdings.testnet",
  },
] as const;

export type FacilityCode = (typeof FACILITIES)[number]["code"];

/** Departments per plant (§1). Plants A and C start online; Plant B starts grey. */
export const DEPARTMENTS_BY_FACILITY: Record<Exclude<FacilityCode, "ACME">, readonly string[]> = {
  A: [
    "receiving",
    "warehouse",
    "weigh_dispense",
    "blending",
    "compression",
    "packaging",
    "qc_lab",
    "purchasing",
    "accounting",
  ],
  B: [
    "receiving",
    "warehouse",
    "weigh_dispense",
    "blending",
    "compression",
    "packaging",
    "qc_lab",
    "purchasing",
    "accounting",
  ],
  C: ["receiving", "warehouse", "packaging", "accounting"],
};

export const STAFF = [
  { name: "Ray Delgado", role: "purchaser", facility: "B" },
  {
    name: "Linda Park",
    role: "ops_director",
    facility: "B",
    account: "director.plant-b.acme-holdings.testnet",
  },
  {
    name: "Tommy Reyes",
    role: "receiving",
    facility: "B",
    account: "receiving.plant-b.acme-holdings.testnet",
  },
  {
    name: "Priya Natarajan",
    role: "qc",
    facility: "B",
    account: "qc.plant-b.acme-holdings.testnet",
  },
  { name: "Marcy Allen", role: "accounting", facility: "B" },
  { name: "Jordan Pike", role: "hq_integration", facility: "ACME" },
] as const;

/** Rational factors to the base unit of each dimension. 1 lb = 453,592.37 mg exactly. */
export const UNITS = [
  { code: "mg", dimension: "mass", num: 1, den: 1 },
  { code: "g", dimension: "mass", num: 1_000, den: 1 },
  { code: "kg", dimension: "mass", num: 1_000_000, den: 1 },
  { code: "lb", dimension: "mass", num: 45_359_237, den: 100 },
  { code: "uL", dimension: "volume", num: 1, den: 1 },
  { code: "mL", dimension: "volume", num: 1_000, den: 1 },
  { code: "L", dimension: "volume", num: 1_000_000, den: 1 },
  { code: "each", dimension: "count", num: 1, den: 1 },
  { code: "tablet", dimension: "count", num: 1, den: 1 },
] as const;

type Category = "active" | "excipient" | "packaging" | "lab_chemical";

interface MaterialSpec {
  code: string;
  name: string;
  category: Category;
  /** "kg" materials are mass (base mg); "ea" materials are counts (base each). */
  uom: "kg" | "ea";
  reorderPoint: number;
  reorderQty: number;
  vendor: string;
}

const m = (
  code: string,
  name: string,
  category: Category,
  uom: "kg" | "ea",
  reorderPoint: number,
  reorderQty: number,
  vendor: string,
): MaterialSpec => ({ code, name, category, uom, reorderPoint, reorderQty, vendor });

/** The 33 materials of §4, with their primary vendor code. */
export const MATERIALS: readonly MaterialSpec[] = [
  m("ASC", "Ascorbic acid", "active", "kg", 500, 700, "NGI"),
  m("CAC", "Calcium carbonate", "active", "kg", 800, 1_500, "SMS"),
  m("MGO", "Magnesium oxide", "active", "kg", 100, 250, "SMS"),
  m("VD3", "Vitamin D3 beadlet 100,000 IU/g", "active", "kg", 3, 10, "DDN"),
  m("KCT", "Potassium citrate", "active", "kg", 120, 300, "NGI"),
  m("SBC", "Sodium bicarbonate", "active", "kg", 250, 500, "SMS"),
  m("CTA", "Citric acid anhydrous", "active", "kg", 300, 600, "NGI"),
  m("NAC", "Sodium chloride", "active", "kg", 10, 25, "SMS"),
  m("SOR", "Sorbitol", "excipient", "kg", 500, 1_000, "FPO"),
  m("MAN", "Mannitol", "excipient", "kg", 200, 400, "FPO"),
  m("MCC", "Microcrystalline cellulose 102", "excipient", "kg", 250, 500, "PEC"),
  m("CCS", "Croscarmellose sodium", "excipient", "kg", 20, 50, "PEC"),
  m("STA", "Stearic acid", "excipient", "kg", 15, 40, "PEC"),
  m("MGS", "Magnesium stearate", "excipient", "kg", 25, 50, "PEC"),
  m("SIO", "Silicon dioxide", "excipient", "kg", 10, 25, "PEC"),
  m("PEG", "PEG 6000", "excipient", "kg", 25, 50, "PEC"),
  m("FOR", "Natural orange flavor", "excipient", "kg", 15, 25, "OFH"),
  m("FLL", "Lemon-lime flavor", "excipient", "kg", 15, 25, "OFH"),
  m("SUC", "Sucralose", "excipient", "kg", 5, 10, "OFH"),
  m("BTL", "150 cc HDPE bottle", "packaging", "ea", 40_000, 100_000, "LOW"),
  m("CAP", "38 mm CR cap with induction liner", "packaging", "ea", 40_000, 100_000, "LOW"),
  m("DES", "1 g desiccant canister", "packaging", "ea", 40_000, 100_000, "LOW"),
  m("TUB", "20-count effervescent tube", "packaging", "ea", 15_000, 40_000, "LOW"),
  m("TDC", "Tube desiccant cap", "packaging", "ea", 15_000, 40_000, "LOW"),
  m("LVC", "Label, VC500", "packaging", "ea", 20_000, 50_000, "CPL"),
  m("LCM", "Label, CMD", "packaging", "ea", 20_000, 50_000, "CPL"),
  m("LEX", "Label, ELX tube", "packaging", "ea", 15_000, 40_000, "CPL"),
  m("SHC", "Shipper case", "packaging", "ea", 2_000, 5_000, "HBX"),
  m("ACN", "Acetonitrile, HPLC grade, 4 L", "lab_chemical", "ea", 2, 4, "BLS"),
  m("MEO", "Methanol, HPLC grade, 4 L", "lab_chemical", "ea", 2, 4, "BLS"),
  m("PHA", "Phosphoric acid 85%, 500 mL", "lab_chemical", "ea", 1, 2, "BLS"),
  m("BUF", "pH 7.00 buffer, 500 mL", "lab_chemical", "ea", 2, 6, "BLS"),
  m("RSA", "Ascorbic acid reference standard, 200 mg", "lab_chemical", "ea", 1, 2, "BLS"),
];

/** Base units for a quantity in a material's inventory UoM. */
export function toBase(material: MaterialSpec, qty: number) {
  return material.uom === "kg" ? kg(qty) : qty;
}

type Qualification = "qualified" | "conditional" | "unqualified" | "suspended";

/** §5. Vendors with a supplier agent carry its testnet account (CONTRACTS.md §1). */
export const VENDORS: readonly {
  code: string;
  name: string;
  qualification: Qualification;
  supplies: readonly string[];
  account?: string;
  notes?: string;
}[] = [
  {
    code: "NGI",
    name: "Northgate Ingredients",
    qualification: "qualified",
    supplies: ["ASC", "CTA", "KCT"],
    account: "northgate-ingredients.testnet",
  },
  {
    code: "SMS",
    name: "Sierra Mineral Supply",
    qualification: "qualified",
    supplies: ["CAC", "MGO", "SBC", "NAC"],
  },
  {
    code: "PEC",
    name: "Pacific Excipient Co.",
    qualification: "qualified",
    supplies: ["MCC", "CCS", "STA", "MGS", "SIO", "PEG"],
  },
  {
    code: "FPO",
    name: "Fennimore Polyols",
    qualification: "qualified",
    supplies: ["SOR", "MAN"],
  },
  {
    code: "OFH",
    name: "Orchard Flavor House",
    qualification: "qualified",
    supplies: ["FOR", "FLL", "SUC"],
  },
  {
    code: "DDN",
    name: "Delta D Nutrition",
    qualification: "conditional",
    supplies: ["VD3"],
    notes: "Audit open: every PO needs director approval regardless of amount.",
  },
  {
    code: "LOW",
    name: "Lowell Packaging",
    qualification: "qualified",
    supplies: ["BTL", "CAP", "DES", "TUB", "TDC"],
  },
  {
    code: "CPL",
    name: "Copperline Labels",
    qualification: "qualified",
    supplies: ["LVC", "LCM", "LEX"],
  },
  { code: "HBX", name: "Harbor Box Co.", qualification: "qualified", supplies: ["SHC"] },
  {
    code: "BLS",
    name: "Bayfront Lab Supply",
    qualification: "qualified",
    supplies: ["ACN", "MEO", "PHA", "BUF", "RSA"],
    account: "bayfront-labsupply.testnet",
  },
  {
    code: "RWA",
    name: "Ridgeway Ascorbics",
    qualification: "qualified",
    supplies: ["ASC"],
    account: "ridgeway-ascorbics.testnet",
    notes: "Second source for ascorbic acid.",
  },
  {
    code: "QCD",
    name: "QuickChem Direct",
    qualification: "unqualified",
    supplies: ["ASC", "CTA"],
    account: "quickchem-direct.testnet",
    notes: "Not qualified. Kevin must not buy from them.",
  },
];

/** §3. Formula lines are kg per standard batch; the overage is already included. */
export const PRODUCTS = [
  {
    code: "P-VC500",
    name: "Hollow Pine Vitamin C 500 mg Chewable",
    tabletWeightMg: 1_250,
    batchTablets: 800_000,
    lines: [
      ["ASC", 412, 300],
      ["SOR", 416, 0],
      ["MCC", 120, 0],
      ["CTA", 20, 0],
      ["FOR", 12, 0],
      ["MGS", 12, 0],
      ["SIO", 6.4, 0],
      ["SUC", 1.6, 0],
    ],
  },
  {
    code: "P-CMD",
    name: "Hollow Pine Cal-Mag + D3 Tablet",
    tabletWeightMg: 1_685,
    batchTablets: 500_000,
    lines: [
      ["CAC", 625, 0],
      ["MCC", 100, 0],
      ["MGO", 83, 0],
      ["CCS", 15, 0],
      ["STA", 10, 0],
      ["MGS", 7.5, 0],
      ["VD3", 2, 0],
    ],
  },
  {
    code: "P-ELX",
    name: "Hollow Pine Electrolyte Effervescent",
    tabletWeightMg: 2_250,
    batchTablets: 300_000,
    lines: [
      ["CTA", 210, 0],
      ["SBC", 180, 0],
      ["MAN", 156, 0],
      ["KCT", 90, 0],
      ["PEG", 18, 0],
      ["FLL", 12, 0],
      ["NAC", 6, 0],
      ["SUC", 3, 0],
    ],
  },
] as const satisfies readonly {
  code: string;
  name: string;
  tabletWeightMg: number;
  batchTablets: number;
  lines: readonly (readonly [string, number, number])[];
}[];

/** §3 "Tolerances and yield": ±0.5% per weighed material, 90% expected yield. */
export const TOLERANCE_BP = 50;
export const EXPECTED_YIELD_BP = 9_000;
export const FORMULAS_EFFECTIVE_FROM = "2026-01-01T00:00:00.000Z";
