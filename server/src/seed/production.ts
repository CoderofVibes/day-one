// The plant's longer past and its next four weeks (docs/VISION.md §6.12.2, §6.7): about 120 days
// of batches for all ten products at Hollow Pine and Riverside, the purchases that fed them, the
// packaging runs on the dry side, and the production plan to Dec 7. Deterministic: the same
// seed every run, no clock and no randomness (yields come from a hash of the batch number).
//
// It runs on its own lots. The hand-written history (history.ts, lots.ts) and the demo's
// recorded run depend on the exact lots and quantities there, so:
//   - batches here draw only lots made here, and the batches there never draw these;
//   - a material whose only use here is before Aug 28 (ascorbic acid, calcium carbonate, ...)
//     is bought to the gram and used up, so its stock from Aug 28 on is what it always was;
//   - a material the next four weeks' plan uses keeps enough here to cover that plan (and its
//     reorder point when the material is new), so no plant runs short in any forecast window.
// The tests in production.test.ts hold each of these.

import { HISTORY_BATCHES } from "./history.ts";
import { LOTS, TRANSFERS } from "./lots.ts";
import type { FacilityCode } from "./reference.ts";
import { LIST_PRICE, MATERIALS, PRODUCTS } from "./reference.ts";

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The next Monday-to-Friday day after a date: the dry side does not work weekends. */
function nextWorkingDay(date: string) {
  let d = addDays(date, 1);
  while ([0, 6].includes(new Date(`${d}T00:00:00.000Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

/** FNV-1a, for yields that look varied and never change. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

type ProductCode = (typeof PRODUCTS)[number]["code"];

/** Where a product is made and how its units leave the plant. */
interface ProductRoute {
  /** Batch-number prefix: the tablet line, the capsule room or the powder room. */
  prefix: string;
  /** Yield band in basis points, low and span. */
  yieldBp: [number, number];
  /** Units per bottle or canister. */
  perPack: number;
  /** Packaging drawn per pack, and shippers per case. */
  pack: readonly string[];
  perCase: number;
  /** Components drawn per theoretical unit at the batch, beyond the formula (capsule shells). */
  components?: readonly (readonly [string, number])[];
}

const TABLET_YIELD: [number, number] = [8_860, 340];

export const ROUTES: Readonly<Partial<Record<ProductCode, ProductRoute>>> = {
  "P-VC500": { prefix: "BR-B", yieldBp: TABLET_YIELD, perPack: 90, pack: [], perCase: 48 },
  "P-CMD": { prefix: "BR-B", yieldBp: TABLET_YIELD, perPack: 120, pack: [], perCase: 48 },
  "P-ELX": { prefix: "BR-B", yieldBp: TABLET_YIELD, perPack: 20, pack: [], perCase: 48 },
  "P-ZN50": {
    prefix: "BR-B",
    yieldBp: TABLET_YIELD,
    perPack: 100,
    pack: ["BT1", "CP3", "LZN"],
    perCase: 48,
  },
  "P-MEL5": {
    prefix: "BR-B",
    yieldBp: TABLET_YIELD,
    perPack: 60,
    pack: ["BT1", "CP3", "LML", "CTN"],
    perCase: 96,
  },
  "P-PRO": {
    prefix: "BC-B",
    yieldBp: [9_620, 230],
    perPack: 30,
    pack: ["BT1", "CP3", "LPR", "CTN", "DES"],
    perCase: 96,
    components: [["HPC", 1.02]],
  },
  "P-FBR": { prefix: "BP-B", yieldBp: [9_450, 250], perPack: 1, pack: ["CAN", "LFB"], perCase: 12 },
  "P-BCX": {
    prefix: "BR-A",
    yieldBp: TABLET_YIELD,
    perPack: 100,
    pack: ["BT3", "CP4", "LBC"],
    perCase: 48,
  },
  "P-MG100": {
    prefix: "BR-A",
    yieldBp: TABLET_YIELD,
    perPack: 120,
    pack: ["BT3", "CP4", "LMG"],
    perCase: 48,
  },
  "P-D3K": {
    prefix: "BR-A",
    yieldBp: TABLET_YIELD,
    perPack: 180,
    pack: ["BT1", "CP3", "LD3"],
    perCase: 48,
  },
};

/**
 * When each product ran, by plant. Batch numbers run in date order per prefix and stop short of
 * the hand-written ones: BR-B-1033 (Sep 14) to BR-B-1046 and BR-A-2201 (Oct 13), 2204, 2207
 * keep their numbers and dates, so the tablet lines run here before them and in their gaps.
 */
const RUNS: readonly { product: ProductCode; facility: "A" | "B"; dates: readonly string[] }[] = [
  // Hollow Pine's tablet line before the acquisition month.
  {
    product: "P-VC500",
    facility: "B",
    dates: ["2026-07-15", "2026-07-29", "2026-08-12", "2026-08-26"],
  },
  { product: "P-CMD", facility: "B", dates: ["2026-07-22", "2026-08-19"] },
  {
    product: "P-ELX",
    facility: "B",
    dates: [
      "2026-07-16",
      "2026-07-23",
      "2026-07-30",
      "2026-08-06",
      "2026-08-13",
      "2026-08-20",
      "2026-08-27",
      "2026-09-03",
      "2026-09-10",
    ],
  },
  { product: "P-ZN50", facility: "B", dates: ["2026-07-20", "2026-08-17", "2026-09-15"] },
  { product: "P-MEL5", facility: "B", dates: ["2026-07-27", "2026-08-24", "2026-09-22"] },
  // The capsule and powder rooms, every two weeks all the way to the demo week.
  {
    product: "P-PRO",
    facility: "B",
    dates: [
      "2026-07-14",
      "2026-07-28",
      "2026-08-11",
      "2026-08-25",
      "2026-09-08",
      "2026-09-22",
      "2026-10-06",
      "2026-10-20",
      "2026-11-03",
    ],
  },
  {
    // Thursdays, so the canisters are packed on the Friday.
    product: "P-FBR",
    facility: "B",
    dates: [
      "2026-07-16",
      "2026-07-30",
      "2026-08-13",
      "2026-08-27",
      "2026-09-10",
      "2026-09-24",
      "2026-10-08",
      "2026-10-22",
      "2026-11-05",
    ],
  },
  // Riverside: magnesium weekly until its Cal-Mag line started in October, D3 and B-complex
  // every two weeks.
  {
    product: "P-MG100",
    facility: "A",
    dates: [
      "2026-07-14",
      "2026-07-21",
      "2026-07-28",
      "2026-08-04",
      "2026-08-11",
      "2026-08-18",
      "2026-08-25",
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      "2026-09-22",
      "2026-09-29",
      "2026-10-06",
      "2026-10-20",
      "2026-11-03",
    ],
  },
  {
    product: "P-D3K",
    facility: "A",
    dates: [
      "2026-07-16",
      "2026-07-30",
      "2026-08-13",
      "2026-08-27",
      "2026-09-10",
      "2026-09-24",
      "2026-10-08",
      "2026-10-22",
    ],
  },
  {
    product: "P-BCX",
    facility: "A",
    dates: [
      "2026-07-20",
      "2026-08-03",
      "2026-08-17",
      "2026-08-31",
      "2026-09-14",
      "2026-09-28",
      "2026-10-12",
      "2026-10-28",
    ],
  },
];

/** The first number each prefix uses here, chosen so the sequence meets the hand-written one. */
const FIRST_NUMBER: Record<string, number> = { "BR-A": 2174, "BC-B": 301, "BP-B": 501 };
/** Hollow Pine's tablet line: these numbers are free, in date order (1033 and 1036–1046 are taken). */
const BR_B_FREE = [
  ...Array.from({ length: 19 }, (_, i) => 1014 + i), // 1014–1032, before Sep 14
  1034,
  1035,
];
/** Riverside's numbers that are taken by the hand-written records. */
const BR_A_TAKEN = new Set([2201, 2204, 2207]);

/**
 * The next four weeks after the demo clock (Nov 9): every product's next batches. Hollow Pine's
 * BR-B-1047 and BR-B-1048 (Nov 17 and 19, history.ts) are the Vitamin C batches Kevin's demo
 * forecast reads; nothing here adds Vitamin C or Cal-Mag at Hollow Pine, or Cal-Mag at
 * Riverside, before Nov 30, so every forecast the recorded run and the brief make is unchanged.
 */
const PLAN: readonly {
  product: ProductCode;
  facility: "A" | "B";
  dates: readonly string[];
  /** The plan's need is held in this history's stock (false: the plant buys it as usual). */
  covered: boolean;
}[] = [
  {
    product: "P-ELX",
    facility: "B",
    dates: ["2026-11-19", "2026-11-26", "2026-12-03"],
    covered: true,
  },
  { product: "P-ZN50", facility: "B", dates: ["2026-11-24"], covered: true },
  { product: "P-MEL5", facility: "B", dates: ["2026-11-30"], covered: true },
  { product: "P-PRO", facility: "B", dates: ["2026-11-17", "2026-12-01"], covered: true },
  { product: "P-FBR", facility: "B", dates: ["2026-11-19", "2026-12-03"], covered: true },
  { product: "P-VC500", facility: "B", dates: ["2026-12-01"], covered: false },
  { product: "P-CMD", facility: "B", dates: ["2026-12-02"], covered: false },
  { product: "P-MG100", facility: "A", dates: ["2026-11-17", "2026-12-01"], covered: true },
  { product: "P-D3K", facility: "A", dates: ["2026-11-19", "2026-12-03"], covered: true },
  { product: "P-BCX", facility: "A", dates: ["2026-11-23", "2026-12-07"], covered: true },
  { product: "P-CMD", facility: "A", dates: ["2026-12-03"], covered: false },
];

/** Opening stock for this history is on hand on Jul 6; the first batch runs Jul 14. */
export const HISTORY_START = "2026-07-06";
/** Hollow Pine orders in rounds; the last one is before PO-1035 (Sep 24) takes the next number. */
const B_ORDER_DAYS = ["2026-08-24", "2026-09-21"];
/** Riverside buys on Acme's system, every four weeks to the end of October. */
const A_ORDER_DAYS = ["2026-07-27", "2026-08-24", "2026-09-21", "2026-10-19"];
const LEAD_DAYS = 7;
const RELEASE_DAYS = 2;
/** The last day the plan is covered to. */
const COVER_UNTIL = "2026-12-07";
/** Hollow Pine's PO numbers end at PO-1034, the last free number before PO-1035. */
const LAST_PO_NUMBER = 1034;
/** PO-1001 is the first number the plant's paper PO book shows. */
const FIRST_PO_NUMBER = 1001;
/** Orders are split to stay under the ERP's controller threshold of $25,000. */
const PO_SPLIT_USD = 24_000;

const BATCH_HOUR = "06:00";

export interface GeneratedLot {
  code: string;
  material: string;
  vendor: string;
  facility: FacilityCode;
  qty: number;
  receivedOn: string;
  po?: string;
}
export interface GeneratedPo {
  poNo: string;
  vendor: string;
  shipTo: FacilityCode;
  category: "raw_material" | "packaging";
  orderedAt: string;
  lines: readonly (readonly [string, number, number])[];
}
export interface GeneratedBatch {
  batchNo: string;
  product: ProductCode;
  facility: "A" | "B";
  date: string;
  tablets: number;
  /** Start hour: 6 for the day's first batch, an hour later for each one after it. */
  hour: number;
}
export interface PackagingRun {
  batchNo: string;
  facility: "A" | "B";
  date: string;
  units: number;
  /** [material, quantity] drawn: packaging per pack, shippers per case, components per unit. */
  draws: readonly (readonly [string, number])[];
  /** Drawn at the batch itself rather than on the dry side (capsule shells). */
  atBatch: boolean;
  /** The hour the run starts (the capsule shells follow their batch). */
  hour: number;
}
export interface PlannedBatch {
  batchNo: string;
  product: ProductCode;
  facility: "A" | "B";
  plannedFor: string;
}

const material = (code: string) => {
  const m = MATERIALS.find((x) => x.code === code);
  if (!m) throw new Error(`production: no material ${code}`);
  return m;
};
const product = (code: ProductCode) => {
  const p = PRODUCTS.find((x) => x.code === code);
  if (!p) throw new Error(`production: no product ${code}`);
  return p;
};
/** The batch-number prefix where a product is made: the plant's letter on its line's prefix. */
const prefixOf = (code: ProductCode, facility: "A" | "B") =>
  route(code).prefix.replace(/-[AB]$/, `-${facility}`);

const route = (code: ProductCode) => {
  const r = ROUTES[code];
  if (!r) throw new Error(`production: no route for ${code}`);
  return r;
};

/** Round a quantity up to how the material is bought: 25 kg bags, whole kg, cases of 1,000. */
function packUp(code: string, qty: number) {
  const m = material(code);
  if (m.uom === "ea") return Math.ceil(qty / 1_000) * 1_000;
  if (qty >= 200) return Math.ceil(qty / 25) * 25;
  return Math.ceil(qty);
}

/** Days the hand-written history already runs a batch at 06:00 (history.ts). */
const HAND_WRITTEN_DAYS = new Set(HISTORY_BATCHES.map((b) => b.date));

/** One batch per hour from 06:00 on any day, the hand-written batch first. */
function stagger(list: GeneratedBatch[]) {
  const taken = new Map<string, number>();
  for (const b of list) {
    const used = taken.get(b.date) ?? (HAND_WRITTEN_DAYS.has(b.date) ? 1 : 0);
    b.hour = 6 + used;
    taken.set(b.date, used + 1);
  }
  return list;
}

function batches(): GeneratedBatch[] {
  const all = RUNS.flatMap((r) =>
    r.dates.map((date) => ({ product: r.product, facility: r.facility, date })),
  );
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.product < b.product ? -1 : 1));
  const next: Record<string, number> = { ...FIRST_NUMBER };
  let bFree = 0;
  return all.map((b) => {
    const r = route(b.product);
    const prefix = prefixOf(b.product, b.facility);
    let n: number;
    if (prefix === "BR-B") {
      const free = BR_B_FREE[bFree++];
      if (free === undefined) throw new Error("production: out of BR-B numbers");
      n = free;
    } else {
      n = next[prefix] ?? 1;
      while (prefix === "BR-A" && BR_A_TAKEN.has(n)) n += 1;
      next[prefix] = n + 1;
    }
    const batchNo = `${prefix}-${prefix.startsWith("BR") ? n : String(n).padStart(4, "0")}`;
    const p = product(b.product);
    const [low, span] = r.yieldBp;
    const yieldBp = low + (hash(batchNo) % span);
    const tablets = Math.round((p.batchTablets * yieldBp) / 10_000 / 100) * 100;
    return { batchNo, product: b.product, facility: b.facility, date: b.date, tablets, hour: 6 };
  });
}

function packagingRuns(list: GeneratedBatch[]): PackagingRun[] {
  return list.flatMap((b) => {
    const r = route(b.product);
    const runs: PackagingRun[] = [];
    if (r.components) {
      const p = product(b.product);
      runs.push({
        batchNo: b.batchNo,
        facility: b.facility,
        date: b.date,
        units: p.batchTablets,
        draws: r.components.map(([code, per]) => [code, Math.round(p.batchTablets * per)] as const),
        atBatch: true,
        hour: b.hour,
      });
    }
    if (r.pack.length > 0) {
      const packs = Math.floor(b.tablets / r.perPack);
      const cases = Math.ceil(packs / r.perCase);
      runs.push({
        batchNo: b.batchNo,
        facility: b.facility,
        date: nextWorkingDay(b.date),
        units: packs,
        draws: [...r.pack.map((code) => [code, packs] as const), ["SHC", cases] as const],
        atBatch: false,
        hour: 11,
      });
    }
    return runs;
  });
}

function plan(): PlannedBatch[] {
  const next: Record<string, number> = { "BR-B": 1049, "BR-A": 2208, "BC-B": 0, "BP-B": 0 };
  const generated = batches();
  for (const prefix of ["BC-B", "BP-B"]) {
    const last = generated
      .filter((b) => b.batchNo.startsWith(prefix))
      .map((b) => Number(b.batchNo.slice(prefix.length + 1)))
      .reduce((a, b) => Math.max(a, b), 0);
    next[prefix] = last + 1;
  }
  const all = PLAN.flatMap((p) =>
    p.dates.map((d) => ({ product: p.product, facility: p.facility, plannedFor: d })),
  );
  all.sort((a, b) =>
    a.plannedFor < b.plannedFor
      ? -1
      : a.plannedFor > b.plannedFor
        ? 1
        : a.product < b.product
          ? -1
          : 1,
  );
  return all.map((p) => {
    const prefix = prefixOf(p.product, p.facility);
    let n = next[prefix] ?? 1;
    // BR-A-2210 is the group purchase's Vitamin C batch at Riverside (agents/kevin/src/groupBuy.ts).
    while (prefix === "BR-A" && n === 2210) n += 1;
    next[prefix] = n + 1;
    const batchNo = `${prefix}-${prefix.startsWith("BR") ? n : String(n).padStart(4, "0")}`;
    return { batchNo, ...p };
  });
}

interface Need {
  facility: "A" | "B";
  material: string;
  date: string;
  qty: number;
}

/** Every draw this history makes, and the covered plan's needs, per plant and material. */
function needs(list: GeneratedBatch[], runs: PackagingRun[], planned: PlannedBatch[]) {
  const drawn: Need[] = [];
  for (const b of list) {
    for (const [code, kgPerBatch] of product(b.product).lines) {
      drawn.push({ facility: b.facility, material: code, date: b.date, qty: kgPerBatch });
    }
  }
  for (const r of runs) {
    for (const [code, qty] of r.draws)
      drawn.push({ facility: r.facility, material: code, date: r.date, qty });
  }
  const coveredProducts = new Set(
    PLAN.filter((p) => p.covered).map((p) => `${p.facility}|${p.product}`),
  );
  const ahead: Need[] = [];
  for (const p of planned) {
    if (!coveredProducts.has(`${p.facility}|${p.product}`)) continue;
    const prod = product(p.product);
    for (const [code, kgPerBatch] of prod.lines) {
      ahead.push({ facility: p.facility, material: code, date: p.plannedFor, qty: kgPerBatch });
    }
    const r = route(p.product);
    const packs = Math.floor(
      (prod.batchTablets * (r.yieldBp[0] + r.yieldBp[1])) / 10_000 / r.perPack,
    );
    for (const code of r.pack)
      ahead.push({ facility: p.facility, material: code, date: p.plannedFor, qty: packs });
    if (r.pack.length > 0) {
      ahead.push({
        facility: p.facility,
        material: "SHC",
        date: p.plannedFor,
        qty: Math.ceil(packs / r.perCase),
      });
    }
    for (const [code, per] of r.components ?? []) {
      ahead.push({
        facility: p.facility,
        material: code,
        date: p.plannedFor,
        qty: Math.round(prod.batchTablets * per),
      });
    }
  }
  return { drawn, ahead };
}

/**
 * Where the hand-written seed holds a material (its lots and the transfers into a plant): there
 * the reorder margin is already held. Anywhere else this history is the plant's only stock of
 * it, so it keeps the reorder point too.
 */
const HAND_HELD = new Set([
  ...LOTS.map((l) => `${l.facility}|${l.material}`),
  ...TRANSFERS.map((t) => `${t.to}|${t.lot.split("-")[0]}`),
]);
const keepsMargin = (facility: string, code: string) => !HAND_HELD.has(`${facility}|${code}`);

/** Opening lots, purchases and their lots, sized so every draw is covered on its day. */
function supply(drawn: Need[], ahead: Need[]) {
  const keys = new Set([...drawn, ...ahead].map((n) => `${n.facility}|${n.material}`));
  const lots: GeneratedLot[] = [];
  const orders: { facility: "A" | "B"; material: string; orderedAt: string; qty: number }[] = [];

  for (const key of [...keys].sort()) {
    const [facility, code] = key.split("|") as ["A" | "B", string];
    const mine = drawn.filter((n) => n.facility === facility && n.material === code);
    const later = ahead.filter((n) => n.facility === facility && n.material === code);
    const between = (from: string, to: string) =>
      mine.filter((n) => n.date >= from && n.date < to).reduce((s, n) => s + n.qty, 0);
    const m = material(code);
    // A material only the plan needs ahead keeps its reorder point here when it is new.
    const keep =
      later.reduce((s, n) => s + n.qty, 0) +
      (later.length > 0 && keepsMargin(facility, code) ? m.reorderPoint : 0);
    const orderDays = facility === "B" ? B_ORDER_DAYS : A_ORDER_DAYS;
    // Usable the day after QC releases it (lots release at 16:00; batches start at 06:00).
    const arrivals = orderDays.map((d) => addDays(d, LEAD_DAYS + RELEASE_DAYS + 1));

    if (later.length === 0) {
      // Used up here: one opening lot, exactly what this history draws.
      const total = mine.reduce((s, n) => s + n.qty, 0);
      if (total > 0)
        lots.push({
          code: "",
          material: code,
          vendor: m.vendor,
          facility,
          qty: round(code, total),
          receivedOn: HISTORY_START,
        });
      continue;
    }

    // Opening stock covers until the first order is released; each order covers to the next
    // release, the last one to the end of the plan plus what is kept.
    const firstRelease = arrivals[0] ?? COVER_UNTIL;
    const opening = packUp(
      code,
      between(HISTORY_START, firstRelease) + (keepsMargin(facility, code) ? m.reorderPoint : 0),
    );
    lots.push({
      code: "",
      material: code,
      vendor: m.vendor,
      facility,
      qty: opening,
      receivedOn: HISTORY_START,
    });
    let stock = opening - between(HISTORY_START, firstRelease);
    orderDays.forEach((orderedAt, i) => {
      const release = arrivals[i] as string;
      const nextRelease = arrivals[i + 1];
      const lastRound = nextRelease === undefined;
      const demand = lastRound
        ? between(release, "9999-12-31") + keep
        : between(release, nextRelease);
      const safety = !lastRound && keepsMargin(facility, code) ? m.reorderPoint : 0;
      const qty = Math.max(0, demand + safety - stock);
      const bought = qty > 0 ? packUp(code, qty) : 0;
      if (bought > 0) orders.push({ facility, material: code, orderedAt, qty: bought });
      stock +=
        bought - (lastRound ? between(release, "9999-12-31") : between(release, nextRelease));
    });
  }
  return { lots, orders };
}

const round = (code: string, qty: number) =>
  material(code).uom === "ea" ? Math.round(qty) : Math.round(qty * 1_000) / 1_000;

export interface ProductionHistory {
  batches: GeneratedBatch[];
  packaging: PackagingRun[];
  lots: GeneratedLot[];
  pos: GeneratedPo[];
  plan: PlannedBatch[];
}

/** Lot code with the receipt date, numbered after any lot already received that day. */
function lotCodes(lots: GeneratedLot[], taken: ReadonlySet<string>) {
  const used = new Set(taken);
  for (const lot of lots) {
    const yymmdd = lot.receivedOn.slice(2).replaceAll("-", "");
    let seq = 1;
    let code = "";
    do {
      code = `${lot.material}-${yymmdd}-${String(seq).padStart(2, "0")}`;
      seq += 1;
    } while (used.has(code));
    used.add(code);
    lot.code = code;
  }
}

/** The whole generated history. `taken` is every lot code the hand-written seed uses. */
export function productionHistory(taken: ReadonlySet<string>): ProductionHistory {
  const list = stagger(batches());
  const runs = packagingRuns(list);
  // The dry side runs one packaging job per hour from 11:00, across both plants, so every
  // event of the day stays in time order.
  const dryHours = new Map<string, number>();
  for (const r of runs.filter((x) => !x.atBatch)) {
    const used = dryHours.get(r.date) ?? 0;
    r.hour = 11 + used;
    dryHours.set(r.date, used + 1);
  }
  const planned = plan();
  const { drawn, ahead } = needs(list, runs, planned);
  const { lots, orders } = supply(drawn, ahead);

  // Hollow Pine's orders become POs, one per vendor per order day, numbered up to PO-1034. An
  // order over the ERP's controller threshold ($25,000, erp/src/seed/data.ts) is split into
  // POs under it, as the plant would have split the delivery.
  type Line = readonly [string, number, number];
  const byVendorDay = new Map<string, { vendor: string; orderedAt: string; lines: Line[] }>();
  for (const o of orders.filter((x) => x.facility === "B")) {
    const vendor = material(o.material).vendor;
    const key = `${o.orderedAt}|${vendor}`;
    const group = byVendorDay.get(key) ?? { vendor, orderedAt: o.orderedAt, lines: [] };
    group.lines.push([o.material, o.qty, LIST_PRICE[o.material] ?? 0] as const);
    byVendorDay.set(key, group);
  }
  const drafts: { vendor: string; orderedAt: string; lines: Line[] }[] = [];
  for (const key of [...byVendorDay.keys()].sort()) {
    const group = byVendorDay.get(key) as { vendor: string; orderedAt: string; lines: Line[] };
    const parts: Line[] = group.lines.flatMap(([code, qty, price]) => {
      const pieces = Math.ceil((qty * price) / PO_SPLIT_USD);
      if (pieces <= 1) return [[code, qty, price] as const];
      const each = packUp(code, qty / pieces);
      return Array.from({ length: pieces }, (_, i) => {
        const q = i < pieces - 1 ? each : qty - each * (pieces - 1);
        return [code, q, price] as const;
      }).filter(([, q]) => q > 0);
    });
    let bin: Line[] = [];
    let binTotal = 0;
    for (const part of parts) {
      const cost = part[1] * part[2];
      if (bin.length > 0 && binTotal + cost > PO_SPLIT_USD) {
        drafts.push({ vendor: group.vendor, orderedAt: group.orderedAt, lines: bin });
        bin = [];
        binTotal = 0;
      }
      bin.push(part);
      binTotal += cost;
    }
    if (bin.length > 0)
      drafts.push({ vendor: group.vendor, orderedAt: group.orderedAt, lines: bin });
  }
  const firstNo = LAST_PO_NUMBER - drafts.length + 1;
  if (firstNo < FIRST_PO_NUMBER) throw new Error("production: more POs than free numbers");
  const pos: GeneratedPo[] = drafts.map((d, i) => ({
    poNo: `PO-${firstNo + i}`,
    vendor: d.vendor,
    shipTo: "B",
    category: d.lines.every(([code]) => material(code).category === "packaging")
      ? "packaging"
      : "raw_material",
    orderedAt: d.orderedAt,
    lines: d.lines,
  }));
  // One lot per PO line at Hollow Pine; Riverside's buying has no Day One PO.
  for (const po of pos) {
    for (const [code, qty] of po.lines) {
      lots.push({
        code: "",
        material: code,
        vendor: po.vendor,
        facility: "B",
        qty,
        receivedOn: addDays(po.orderedAt, LEAD_DAYS),
        po: po.poNo,
      });
    }
  }
  for (const o of orders.filter((x) => x.facility === "A")) {
    lots.push({
      code: "",
      material: o.material,
      vendor: material(o.material).vendor,
      facility: "A",
      qty: o.qty,
      receivedOn: addDays(o.orderedAt, LEAD_DAYS),
    });
  }
  lots.sort((a, b) =>
    a.receivedOn < b.receivedOn
      ? -1
      : a.receivedOn > b.receivedOn
        ? 1
        : a.material < b.material
          ? -1
          : a.material > b.material
            ? 1
            : a.facility < b.facility
              ? -1
              : 1,
  );
  lotCodes(lots, taken);
  return { batches: list, packaging: runs, lots, pos, plan: planned };
}

export const RELEASE_AFTER_DAYS = RELEASE_DAYS;
export const BATCH_TIME = BATCH_HOUR;
