// The acquirer's masters, all fictional (docs/FICTIONAL_DATA.md §1–5, §13). Nothing here is
// an inventory balance: those come only from transactions the connector posts (docs/ERP.md §1).

import { usd } from "../money.ts";
import type { AdjustmentReason, UserRole, VendorStatus } from "../schema.ts";

export const SUBSIDIARY = "Acme Holdings";

/** The chart of accounts the postings use. Numbers are referenced by code, never by id. */
export const ACCOUNTS = [
  { number: "1000", name: "Cash – operating", type: "bank" },
  { number: "1050", name: "Purchasing escrow clearing – Hollow Pine", type: "otherCurrentAsset" },
  { number: "1400", name: "Inventory – raw materials", type: "otherCurrentAsset" },
  { number: "1410", name: "Inventory – packaging", type: "otherCurrentAsset" },
  { number: "1420", name: "Inventory – lab supplies", type: "otherCurrentAsset" },
  { number: "1430", name: "Inventory – finished goods", type: "otherCurrentAsset" },
  { number: "1500", name: "Work in process", type: "otherCurrentAsset" },
  { number: "2000", name: "Accounts payable", type: "accountsPayable" },
  {
    number: "2100",
    name: "Accrued purchases – received not billed",
    type: "otherCurrentLiability",
  },
  { number: "3900", name: "Opening balance equity – acquisition", type: "equity" },
  { number: "5100", name: "Production waste", type: "costOfGoodsSold" },
  { number: "5200", name: "Freight-in", type: "costOfGoodsSold" },
  { number: "5300", name: "Inventory adjustments", type: "costOfGoodsSold" },
] as const;

export type AccountNumber = (typeof ACCOUNTS)[number]["number"];

/** Which account each adjustment reason offsets against inventory. */
export const ADJUSTMENT_ACCOUNT: Record<AdjustmentReason, AccountNumber> = {
  opening: "3900",
  production: "1500",
  waste: "5100",
  count: "5300",
  return: "2100",
};

export const LOCATIONS = [
  { externalId: "A", name: "Acme Riverside", city: "Riverside" },
  { externalId: "B", name: "Hollow Pine Tablet Co.", city: "Hollow Pine" },
  { externalId: "C", name: "Acme Lakeview", city: "Lakeview" },
] as const;

/**
 * ERP users. Tokens are demo values for a local mock; `ERP_TOKEN_<USERNAME>` in the environment
 * overrides any of them. Linda's externalId is her on-chain account, so the contract's
 * `approve_po` maps to her.
 */
export const USERS: readonly {
  username: string;
  fullName: string;
  role: UserRole;
  token?: string;
  externalId?: string;
  location?: "A" | "B" | "C";
}[] = [
  { username: "system", fullName: "System", role: "system" },
  {
    username: "jordan.pike",
    fullName: "Jordan Pike",
    role: "controller",
    token: "demo-token-jordan",
  },
  {
    username: "marcy.allen",
    fullName: "Marcy Allen",
    role: "apManager",
    token: "demo-token-marcy",
    location: "B",
  },
  {
    username: "linda.park",
    fullName: "Linda Park",
    role: "approver",
    externalId: "director.plant-b.acme-holdings.testnet",
    location: "B",
  },
  {
    username: "kevin.dayone",
    fullName: "Kevin (Day One connector)",
    role: "connector",
    token: "demo-token-kevin",
    location: "B",
  },
  { username: "viewer", fullName: "Read-only viewer", role: "viewer", token: "demo-token-viewer" },
];

/** §5 vendors with Acme's AP status and, for the four supplier agents, the verified payout account. */
export const VENDORS: readonly {
  entityId: string;
  companyName: string;
  status: VendorStatus;
  payoutAccount?: string;
  terms?: "net30" | "onQcRelease";
  /** Vendor-level 3-way match limits; omitted = subsidiary defaults. */
  vbPoQtyToleranceBp?: number;
  vbPoAmtToleranceBp?: number;
  vbIrQtyDifferenceBase?: number;
  comments?: string;
}[] = [
  {
    entityId: "NGI",
    companyName: "Northgate Ingredients",
    status: "approved",
    payoutAccount: "northgate-ingredients.testnet",
    terms: "onQcRelease",
  },
  { entityId: "SMS", companyName: "Sierra Mineral Supply", status: "approved" },
  { entityId: "PEC", companyName: "Pacific Excipient Co.", status: "approved" },
  { entityId: "FPO", companyName: "Fennimore Polyols", status: "approved" },
  { entityId: "OFH", companyName: "Orchard Flavor House", status: "approved" },
  {
    entityId: "DDN",
    companyName: "Delta D Nutrition",
    status: "onHold",
    comments: "Supplier audit open; HQ controller signs every PO until it closes.",
  },
  {
    entityId: "LOW",
    companyName: "Lowell Packaging",
    status: "approved",
    // Packaging ships in cases; a 1% over-run on a bill is normal.
    vbPoQtyToleranceBp: 100,
  },
  { entityId: "CPL", companyName: "Copperline Labels", status: "approved" },
  { entityId: "HBX", companyName: "Harbor Box Co.", status: "approved" },
  {
    entityId: "BLS",
    companyName: "Bayfront Lab Supply",
    status: "approved",
    payoutAccount: "bayfront-labsupply.testnet",
    terms: "onQcRelease",
  },
  {
    entityId: "RWA",
    companyName: "Ridgeway Ascorbics",
    status: "approved",
    payoutAccount: "ridgeway-ascorbics.testnet",
    terms: "onQcRelease",
    comments: "Second source for ascorbic acid.",
  },
  {
    entityId: "QCD",
    companyName: "QuickChem Direct",
    status: "blocked",
    payoutAccount: "quickchem-direct.testnet",
    comments: "Not qualified by Acme quality. AP blocked; no bills accepted.",
  },
  // v2 (docs/VISION.md §6.12.2): the suppliers behind the seven new products.
  { entityId: "CNP", companyName: "Cascade Nutrient Premix", status: "approved" },
  { entityId: "HFC", companyName: "Halvorsen Fine Chemicals", status: "approved" },
  {
    entityId: "BWC",
    companyName: "Brightwater Cultures",
    status: "approved",
    comments: "Ships cold; QC checks the logger on receipt.",
  },
  {
    entityId: "KCC",
    companyName: "Keystone Capsule Co.",
    status: "approved",
    // Shells ship by the carton; a 1% over-run on a bill is normal.
    vbPoQtyToleranceBp: 100,
  },
  { entityId: "PFM", companyName: "Prairie Fiber Mills", status: "approved" },
  { entityId: "NFC", companyName: "Northfield Folding Carton", status: "approved" },
];

type ItemClass = "rawMaterial" | "packaging" | "labSupply" | "finishedGood";

/** §4 materials as items, with a standard cost per unit for opening balances. */
export const ITEMS: readonly {
  itemId: string;
  displayName: string;
  itemClass: ItemClass;
  unitsType: "kg" | "ea";
  cost: number;
}[] = [
  {
    itemId: "ASC",
    displayName: "Ascorbic acid",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 7.1,
  },
  {
    itemId: "CAC",
    displayName: "Calcium carbonate",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 0.62,
  },
  {
    itemId: "MGO",
    displayName: "Magnesium oxide",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 2.9,
  },
  {
    itemId: "VD3",
    displayName: "Vitamin D3 beadlet 100,000 IU/g",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 148,
  },
  {
    itemId: "KCT",
    displayName: "Potassium citrate",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 3.8,
  },
  {
    itemId: "SBC",
    displayName: "Sodium bicarbonate",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 0.85,
  },
  {
    itemId: "CTA",
    displayName: "Citric acid anhydrous",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 1.95,
  },
  {
    itemId: "NAC",
    displayName: "Sodium chloride",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 0.4,
  },
  { itemId: "SOR", displayName: "Sorbitol", itemClass: "rawMaterial", unitsType: "kg", cost: 2.15 },
  { itemId: "MAN", displayName: "Mannitol", itemClass: "rawMaterial", unitsType: "kg", cost: 4.2 },
  {
    itemId: "MCC",
    displayName: "Microcrystalline cellulose 102",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 3.4,
  },
  {
    itemId: "CCS",
    displayName: "Croscarmellose sodium",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 9.6,
  },
  {
    itemId: "STA",
    displayName: "Stearic acid",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 2.75,
  },
  {
    itemId: "MGS",
    displayName: "Magnesium stearate",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 8.2,
  },
  {
    itemId: "SIO",
    displayName: "Silicon dioxide",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 6.5,
  },
  { itemId: "PEG", displayName: "PEG 6000", itemClass: "rawMaterial", unitsType: "kg", cost: 4.9 },
  {
    itemId: "FOR",
    displayName: "Natural orange flavor",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 46,
  },
  {
    itemId: "FLL",
    displayName: "Lemon-lime flavor",
    itemClass: "rawMaterial",
    unitsType: "kg",
    cost: 44,
  },
  { itemId: "SUC", displayName: "Sucralose", itemClass: "rawMaterial", unitsType: "kg", cost: 92 },
  {
    itemId: "BTL",
    displayName: "150 cc HDPE bottle",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.021,
  },
  {
    itemId: "CAP",
    displayName: "38 mm CR cap with induction liner",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.034,
  },
  {
    itemId: "DES",
    displayName: "1 g desiccant canister",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.018,
  },
  {
    itemId: "TUB",
    displayName: "20-count effervescent tube",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.085,
  },
  {
    itemId: "TDC",
    displayName: "Tube desiccant cap",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.04,
  },
  {
    itemId: "LVC",
    displayName: "Label, VC500",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.012,
  },
  {
    itemId: "LCM",
    displayName: "Label, CMD",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.012,
  },
  {
    itemId: "LEX",
    displayName: "Label, ELX tube",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.01,
  },
  {
    itemId: "SHC",
    displayName: "Shipper case",
    itemClass: "packaging",
    unitsType: "ea",
    cost: 0.62,
  },
  {
    itemId: "ACN",
    displayName: "Acetonitrile, HPLC grade, 4 L",
    itemClass: "labSupply",
    unitsType: "ea",
    cost: 128,
  },
  {
    itemId: "MEO",
    displayName: "Methanol, HPLC grade, 4 L",
    itemClass: "labSupply",
    unitsType: "ea",
    cost: 96,
  },
  {
    itemId: "PHA",
    displayName: "Phosphoric acid 85%, 500 mL",
    itemClass: "labSupply",
    unitsType: "ea",
    cost: 38,
  },
  {
    itemId: "BUF",
    displayName: "pH 7.00 buffer, 500 mL",
    itemClass: "labSupply",
    unitsType: "ea",
    cost: 25,
  },
  {
    itemId: "RSA",
    displayName: "Ascorbic acid reference standard, 200 mg",
    itemClass: "labSupply",
    unitsType: "ea",
    cost: 210,
  },
  {
    itemId: "P-VC500",
    displayName: "Hollow Pine Vitamin C 500 mg Chewable",
    itemClass: "finishedGood",
    unitsType: "ea",
    cost: 0,
  },
  {
    itemId: "P-CMD",
    displayName: "Hollow Pine Cal-Mag + D3 Tablet",
    itemClass: "finishedGood",
    unitsType: "ea",
    cost: 0,
  },
  {
    itemId: "P-ELX",
    displayName: "Hollow Pine Electrolyte Effervescent",
    itemClass: "finishedGood",
    unitsType: "ea",
    cost: 0,
  },
  // v2 (docs/VISION.md §6.12.2): the seven new products' materials and the products themselves.
  ...(
    [
      ["ZNG", "Zinc gluconate", "rawMaterial", "kg", 6.8],
      ["BVP", "B-vitamin premix", "rawMaterial", "kg", 38.5],
      ["MEL", "Melatonin", "rawMaterial", "kg", 410],
      ["PBB", "Probiotic blend 100B CFU/g", "rawMaterial", "kg", 265],
      ["PSY", "Psyllium husk powder", "rawMaterial", "kg", 4.1],
      ["MBG", "Magnesium bisglycinate", "rawMaterial", "kg", 11.2],
      ["DCP", "Dicalcium phosphate anhydrous", "rawMaterial", "kg", 1.45],
      ["BT1", "100 cc HDPE bottle", "packaging", "ea", 0.018],
      ["CP3", "33 mm CR cap with induction liner", "packaging", "ea", 0.012],
      ["BT3", "250 cc HDPE bottle", "packaging", "ea", 0.026],
      ["CP4", "45 mm CR cap with induction liner", "packaging", "ea", 0.016],
      ["CAN", "300 g canister with scoop and lid", "packaging", "ea", 0.42],
      ["CTN", "Folding carton, 100 cc bottle", "packaging", "ea", 0.055],
      ["HPC", "Capsule shell, size 0, HPMC", "packaging", "ea", 0.0021],
      ["LZN", "Label, ZN50", "packaging", "ea", 0.009],
      ["LBC", "Label, BCX", "packaging", "ea", 0.009],
      ["LML", "Label, MEL5", "packaging", "ea", 0.009],
      ["LPR", "Label, PRO", "packaging", "ea", 0.009],
      ["LFB", "Label, FBR canister", "packaging", "ea", 0.011],
      ["LMG", "Label, MG100", "packaging", "ea", 0.009],
      ["LD3", "Label, D3K", "packaging", "ea", 0.009],
      ["P-ZN50", "Hollow Pine Zinc 50 mg Tablet", "finishedGood", "ea", 0],
      ["P-MEL5", "Hollow Pine Melatonin 5 mg Tablet", "finishedGood", "ea", 0],
      ["P-PRO", "Hollow Pine Probiotic 10B Capsule", "finishedGood", "ea", 0],
      ["P-FBR", "Hollow Pine Fiber Powder Canister", "finishedGood", "ea", 0],
      ["P-BCX", "Acme B-Complex Tablet", "finishedGood", "ea", 0],
      ["P-MG100", "Acme Magnesium Glycinate 100 mg Tablet", "finishedGood", "ea", 0],
      ["P-D3K", "Acme Vitamin D3 2,000 IU Tablet", "finishedGood", "ea", 0],
    ] as const
  ).map(([itemId, displayName, itemClass, unitsType, cost]) => ({
    itemId,
    displayName,
    itemClass,
    unitsType,
    cost,
  })),
];

export const ASSET_ACCOUNT: Record<ItemClass, AccountNumber> = {
  rawMaterial: "1400",
  packaging: "1410",
  labSupply: "1420",
  finishedGood: "1430",
};

/** Subsidiary defaults (docs/ERP.md §3.4–3.5). */
export const SETTINGS = {
  subsidiary: SUBSIDIARY,
  costingMethod: "average",
  vbPoQtyToleranceBp: "200",
  vbPoAmtToleranceBp: "100",
  vbIrQtyDifferenceBase: "0",
  priceDriftBp: "1000",
  duplicateWindowDays: "30",
  escrowClearingAccount: "1050",
  accruedPurchasesAccount: "2100",
  accountsPayableAccount: "2000",
  freightAccount: "5200",
  cashAccount: "1000",
} as const;

/** The approval matrix (docs/ERP.md §3.5), evaluated in ruleNo order within a scope. */
export const APPROVAL_RULES: readonly {
  scope: "purchaseOrder" | "vendorBill";
  ruleNo: number;
  description: string;
  minTotalUsdc?: number;
  maxTotalUsdc?: number;
  vendorStatus?: VendorStatus;
  matchStatus?: "matched" | "exception" | "duplicate";
  requires: "contractVerdict" | "controller" | "apManager" | "auto" | "reject";
  approverRole?: UserRole;
}[] = [
  {
    scope: "purchaseOrder",
    ruleNo: 1,
    description: "Blocked vendor: no purchase order, whatever the amount.",
    vendorStatus: "blocked",
    requires: "reject",
  },
  {
    scope: "purchaseOrder",
    ruleNo: 2,
    description: "Vendor on hold: the HQ controller signs in addition to the contract's approval.",
    vendorStatus: "onHold",
    requires: "controller",
    approverRole: "controller",
  },
  {
    scope: "purchaseOrder",
    ruleNo: 3,
    description: "Over $25,000: the HQ controller signs in addition to the contract's approval.",
    minTotalUsdc: usd(25_000) + 1,
    requires: "controller",
    approverRole: "controller",
  },
  {
    scope: "purchaseOrder",
    ruleNo: 4,
    description:
      "Otherwise the contract's verdict is the approval: funded within Kevin's limits, or the director's approve_po transaction.",
    requires: "contractVerdict",
  },
  {
    scope: "vendorBill",
    ruleNo: 1,
    description: "Duplicate invoice: rejected; nobody can approve it.",
    matchStatus: "duplicate",
    requires: "reject",
  },
  {
    scope: "vendorBill",
    ruleNo: 2,
    description: "Any match exception: the AP manager decides, with a reason.",
    matchStatus: "exception",
    requires: "apManager",
    approverRole: "apManager",
  },
  {
    scope: "vendorBill",
    ruleNo: 3,
    description: "Matched and over $10,000: the AP manager approves.",
    matchStatus: "matched",
    minTotalUsdc: usd(10_000) + 1,
    requires: "apManager",
    approverRole: "apManager",
  },
  {
    scope: "vendorBill",
    ruleNo: 4,
    description: "Matched and at most $10,000: approved automatically.",
    matchStatus: "matched",
    maxTotalUsdc: usd(10_000),
    requires: "auto",
  },
];

/**
 * The budget Acme funded into the plant's purchasing contract (CONTRACTS §8: 25,000 DTUSD),
 * booked once as cash moving into the escrow clearing account.
 */
export const ESCROW_FUNDING = { amountUsdc: usd(25_000), on: "2026-10-28" } as const;
