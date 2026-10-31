// The reads behind the v2 plant, buying and HQ pages (docs/VISION.md §6.6). Live, from the API
// (api/src/session.ts plant() and brief()); on a static host, from the snapshot npm run web:data
// writes at the end of the recorded run (web/src/data/pages.json), loaded only when a page asks.
// The recordings HQ reads (the ERP attached to the run, the sealed round, the attacks, the
// suppliers' credentials) are files in data/, the same in both modes.

import type { Source } from "./series.ts";

export interface PoLineView {
  material: string;
  name: string;
  dimension: string;
  qtyBase: number;
  unit: string;
  unitPriceUsdc: number;
  extendedUsdc: number;
}
export interface PoView {
  poNo: string;
  vendor: string;
  vendorName: string;
  facility: string;
  category: string;
  totalUsdc: number;
  status: string;
  needBy: string | null;
  createdBy: string;
  date: string | null;
  lines: PoLineView[];
  approval: {
    approver: string;
    state: string;
    request: string;
    response: string | null;
    requestedAt: string;
    respondedAt: string | null;
  } | null;
  receipt: { receivedAt: string; match: string; notes: string | null; by: string | null } | null;
  qc: { decision: string; decidedAt: string; lot: string; by: string | null } | null;
}
export interface QuoteView {
  vendor: string;
  vendorName: string;
  standing: string;
  unitPriceUsdc: number;
  freightUsdc: number;
  leadTimeDays: number;
  status: string;
  exclusionReason: string | null;
}
export interface RfqView {
  rfqNo: string;
  facility: string;
  material: string;
  name: string;
  dimension: string;
  qtyBase: number;
  needBy: string;
  createdBy: string;
  quotes: QuoteView[];
}
export interface LotView {
  lotCode: string;
  material: string;
  name: string;
  category: string;
  dimension: string;
  vendor: string | null;
  state: string;
  facility: string;
  onHandBase: number;
  expiresOn: string | null;
  firstAt: string;
  lastAt: string;
  daysInState: number;
}
export interface BatchRecordView {
  batchNo: string;
  facility: string;
  product: string;
  productName: string;
  status: string;
  completedAt: string | null;
  units: number | null;
  theoreticalUnits: number | null;
  yieldBp: number | null;
  expectedYieldBp: number;
  wasteBase: number | null;
  confirmedBy: string | null;
  fromScan: boolean;
  flags: { kind: string; message: string; resolved: boolean }[];
}
export interface PlantTables {
  facility: string;
  at: string;
  orders: PoView[];
  rfqs: RfqView[];
  lots: LotView[];
  batches: BatchRecordView[];
}
export interface BriefLine {
  text: string;
  ref?: string;
}
export interface Brief {
  facility: string;
  facilityName: string;
  for: string | null;
  at: string;
  since: string;
  headline: string;
  sections: {
    key: "moved" | "waiting" | "buying" | "watch";
    title: string;
    lines: BriefLine[];
    empty: string;
  }[];
}

/** One step of the recorded run with the ERP attached (npm run erp:demo -- --json). */
export interface ErpStep {
  step: number;
  title: string;
  staff: string[];
  chain: string[];
  erp?: string[];
}
export interface ErpRecording {
  ok: boolean;
  cutover: {
    sync: Record<string, number>;
    history: {
      bills: {
        invoiceNo: string;
        matchStatus: string;
        approvalStatus: string;
        duplicateOf: string | null;
        priceDrift: number;
      }[];
      checks: { checkNo: string; appliedTo: string }[];
    };
  };
  steps: ErpStep[];
  erp: {
    bills: {
      tranId: string;
      po?: string;
      match: string;
      approval: string;
      status: string;
      total: number;
    }[];
    payments: { tranId: string; amount: number; appliedTo: string | null; ref: string }[];
    trialBalance: { balanced: boolean; totalDebits: number; totalCredits: number };
  };
}
export interface AttackResult {
  attack: string;
  held: boolean;
  evidence: string[];
  txHashes: string[];
  /** Explorer links, one per hash, where the recording kept them. */
  txUrls?: string[];
}
export interface SealedRecording {
  ok: boolean;
  round: string;
  check: {
    result: string;
    winner: string;
    bids: {
      supplier: string;
      sealedBeforeDeadline: boolean;
      opened: boolean;
      matches: boolean;
      terms: { unitPriceUsdc: number; freightUsdc: number; leadTimeDays: number; qtyBase: number };
    }[];
  };
  attacks: AttackResult[];
  staff: string[];
}
export interface SupplierStanding {
  supplier: string;
  standing: string;
  may_be_paid: boolean;
  credential: {
    categories: string[];
    issued_at: string;
    expires_at: string;
    revoked: { at: string; reason: string } | null;
    reputation: {
      released: number;
      rejected: number;
      consecutive_rejects: number;
      suspended_at: string | null;
    };
  } | null;
}
export interface Recorded {
  erp: ErpRecording;
  sealed: SealedRecording;
  attacks: { passed: boolean; attacks: AttackResult[] };
  credentials: { recordedAt: string; suppliers: SupplierStanding[] };
}

/** One area's sheet on the plant map (server/src/ledger/areas.ts). */
export interface AreaView {
  area: string;
  sentence: string;
  lots: LotView[];
  events: { at: string; text: string }[];
  batch: { batchNo: string; product: string; at: string } | null;
  equipment: {
    id: string;
    name: string;
    status: "running" | "idle" | "attention";
    batch: string | null;
  }[];
}
export interface PlantAreas {
  facility: string;
  at: string;
  areas: Record<string, AreaView>;
}

interface PagesSnapshot {
  at: string;
  plant: Record<string, PlantTables>;
  brief: Record<string, Brief>;
  areas: Record<string, PlantAreas>;
  recorded: Recorded;
}

let snapshot: Promise<PagesSnapshot> | null = null;
function loadSnapshot(): Promise<PagesSnapshot> {
  snapshot ??= import("./data/pages.json").then((m) => m.default as unknown as PagesSnapshot);
  return snapshot;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function readPlant(source: Source, plant: string): Promise<PlantTables> {
  return source.live
    ? get<PlantTables>(`api/plant?plant=${plant}`)
    : loadSnapshot().then(
        (s) =>
          s.plant[plant] ?? {
            facility: plant,
            at: s.at,
            orders: [],
            rfqs: [],
            lots: [],
            batches: [],
          },
      );
}
export function readBrief(source: Source, plant: string): Promise<Brief> {
  return source.live
    ? get<Brief>(`api/brief?plant=${plant}`)
    : loadSnapshot().then((s) => {
        const brief = s.brief[plant];
        if (!brief) throw new Error(`no brief for plant ${plant}`);
        return brief;
      });
}
export function readAreas(source: Source, plant: string): Promise<PlantAreas> {
  return source.live
    ? get<PlantAreas>(`api/areas?plant=${plant}`)
    : loadSnapshot().then((s) => s.areas[plant] ?? { facility: plant, at: s.at, areas: {} });
}
/** The recordings HQ's pages read: the same files in both modes. */
export function readRecorded(): Promise<Recorded> {
  return loadSnapshot().then((s) => s.recorded);
}
