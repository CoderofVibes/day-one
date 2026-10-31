// The walk over the lot genealogy index (docs/UPGRADE_BRIEF.md §2.3), for the Lots & recall
// page. The index is built from the ledger by server/src/ledger/genealogy.ts and read live from
// GET /api/genealogy or from the snapshot npm run web:data writes (web/src/data/genealogy.json).
// Pure: a trace, a search and the recall drill's numbers, all from the index alone, so the static
// replay and the live UI trace the same way. The drill only reads; its holds are the page's.

export interface GenealogyLot {
  code: string;
  material: string;
  materialName: string;
  category: string;
  dimension: string;
  vendor: string | null;
  vendorName: string | null;
  vendorLot: string | null;
  state: string | null;
  facility: string | null;
  onHandBase: number;
  receivedBase: number;
  receivedAt: string | null;
  po: string | null;
  receipt: { receivedAt: string; by: string | null } | null;
  qc: { decision: string; decidedAt: string; by: string | null } | null;
  price: { unitPriceUsdc: number; basePerUnit: number; from: "po" | "average" } | null;
  producedBy: string | null;
  usedIn: string[];
  shippedIn: string[];
}
export interface GenealogyBatch {
  batchNo: string;
  facility: string;
  product: string;
  productName: string;
  completedAt: string | null;
  units: number | null;
  inputs: { lot: string; qtyBase: number }[];
  outputs: string[];
}
export interface GenealogyShipment {
  shipmentNo: string;
  customer: string;
  facility: string;
  shippedAt: string;
  lots: { lot: string; qtyBase: number }[];
}
export interface Genealogy {
  lots: Record<string, GenealogyLot>;
  batches: Record<string, GenealogyBatch>;
  shipments: Record<string, GenealogyShipment>;
  has: { fgLots: boolean; shipments: boolean };
}
/** The index as a page reads it: the ledger's clock with it. */
export interface GenealogySnapshot {
  at: string;
  genealogy: Genealogy;
}

export type NodeKind = "lot" | "batch" | "shipment" | "customer";
export interface NodeRef {
  kind: NodeKind;
  id: string;
}
export interface TraceNode extends NodeRef {
  key: string;
  /** Left to right: raw lots, batches, finished-goods lots, shipments, customers. */
  col: number;
}
export interface Trace {
  start: string;
  nodes: TraceNode[];
  edges: { from: string; to: string }[];
  rawLots: string[];
  fgLots: string[];
  batches: string[];
  shipments: string[];
  customers: string[];
}

export const keyOf = (r: NodeRef) => `${r.kind}:${r.id}`;
function refOf(key: string): NodeRef {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as NodeKind, id: key.slice(i + 1) };
}

/**
 * Everything the start node came from and everything that came from it: lots into batches,
 * batches into finished-goods lots, lots into shipments, shipments to customers, and back.
 */
export function trace(g: Genealogy, start: NodeRef): Trace {
  const startKey = keyOf(start);
  const seen = new Set<string>([startKey]);
  const edges = new Map<string, { from: string; to: string }>();
  const edge = (from: string, to: string) => edges.set(`${from}>${to}`, { from, to });
  const customerShipments = (customer: string) =>
    Object.values(g.shipments).filter((s) => s.customer === customer);

  const walk = (next: (r: NodeRef) => { ref: NodeRef; forward: boolean }[]) => {
    const queue = [startKey];
    const visited = new Set(queue);
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const here = refOf(key);
      for (const { ref, forward } of next(here)) {
        const k = keyOf(ref);
        if (forward) edge(key, k);
        else edge(k, key);
        seen.add(k);
        if (!visited.has(k)) {
          visited.add(k);
          queue.push(k);
        }
      }
    }
  };
  // Forward: where it went.
  walk((r) => {
    if (r.kind === "lot") {
      const l = g.lots[r.id];
      return [
        ...(l?.usedIn ?? []).map((id) => ({ ref: { kind: "batch" as const, id }, forward: true })),
        ...(l?.shippedIn ?? []).map((id) => ({
          ref: { kind: "shipment" as const, id },
          forward: true,
        })),
      ];
    }
    if (r.kind === "batch") {
      return (g.batches[r.id]?.outputs ?? []).map((id) => ({
        ref: { kind: "lot" as const, id },
        forward: true,
      }));
    }
    if (r.kind === "shipment") {
      const s = g.shipments[r.id];
      return s ? [{ ref: { kind: "customer" as const, id: s.customer }, forward: true }] : [];
    }
    return [];
  });
  // Backward: where it came from.
  walk((r) => {
    if (r.kind === "lot") {
      const by = g.lots[r.id]?.producedBy;
      return by ? [{ ref: { kind: "batch" as const, id: by }, forward: false }] : [];
    }
    if (r.kind === "batch") {
      return (g.batches[r.id]?.inputs ?? []).map((i) => ({
        ref: { kind: "lot" as const, id: i.lot },
        forward: false,
      }));
    }
    if (r.kind === "shipment") {
      return (g.shipments[r.id]?.lots ?? []).map((l) => ({
        ref: { kind: "lot" as const, id: l.lot },
        forward: false,
      }));
    }
    return customerShipments(r.id).map((s) => ({
      ref: { kind: "shipment" as const, id: s.shipmentNo },
      forward: false,
    }));
  });

  // Columns: a node sits one to the right of the furthest node that feeds it in the trace.
  const into = new Map<string, string[]>();
  for (const e of edges.values()) into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  const col = new Map<string, number>();
  const colOf = (k: string, path: Set<string>): number => {
    const known = col.get(k);
    if (known !== undefined) return known;
    path.add(k);
    const from = (into.get(k) ?? []).filter((f) => !path.has(f));
    const c = from.length ? Math.max(...from.map((f) => colOf(f, path))) + 1 : 0;
    path.delete(k);
    col.set(k, c);
    return c;
  };
  const nodes = [...seen].map((key) => ({ ...refOf(key), key, col: colOf(key, new Set()) }));
  nodes.sort((a, b) => a.col - b.col || a.id.localeCompare(b.id));
  const ids = (kind: NodeKind, pick: (id: string) => boolean = () => true) =>
    nodes.filter((n) => n.kind === kind && pick(n.id)).map((n) => n.id);
  return {
    start: startKey,
    nodes,
    edges: [...edges.values()],
    rawLots: ids("lot", (id) => !g.lots[id]?.producedBy),
    fgLots: ids("lot", (id) => Boolean(g.lots[id]?.producedBy)),
    batches: ids("batch"),
    shipments: ids("shipment"),
    customers: ids("customer"),
  };
}

// ------------------------------------------------------------------ search

export interface Hit extends NodeRef {
  label: string;
  detail: string;
  /** The plant the record is at; null for a lot with no plant on file. */
  facility: string | null;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "2026-10-12", "oct 12" and "oct 12 2026" for an ISO time, for date search. */
function dateWords(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = MONTHS[Number(iso.slice(5, 7)) - 1] ?? "";
  const d = Number(iso.slice(8, 10));
  return `${iso.slice(0, 10)} ${m} ${d} ${m} ${d} ${iso.slice(0, 4)}`;
}

/**
 * Lots, batches and shipments that match a lot id, material, supplier, batch, customer or date,
 * at one plant ("all" for every plant; a lot with no plant on file matches at any).
 */
export function search(g: Genealogy, query: string, limit = 40, plant = "all"): Hit[] {
  const q = query.trim().toLowerCase().replace(/,/g, "");
  if (!q) return [];
  const here = (facility: string | null) =>
    plant === "all" || facility === null || facility === plant;
  const words = q.split(/\s+/);
  const matches = (text: string) => {
    const t = text.toLowerCase();
    return words.every((w) => t.includes(w));
  };
  const hits: Hit[] = [];
  for (const b of Object.values(g.batches)) {
    const text = `${b.batchNo} ${b.product} ${b.productName} ${dateWords(b.completedAt)}`;
    if (here(b.facility) && matches(text)) {
      hits.push({
        kind: "batch",
        id: b.batchNo,
        label: b.batchNo,
        detail: `${b.productName} · ${b.inputs.length} lots in`,
        facility: b.facility,
      });
    }
  }
  for (const l of Object.values(g.lots)) {
    const text = [
      l.code,
      l.vendorLot,
      l.material,
      l.materialName,
      l.vendor,
      l.vendorName,
      l.po,
      dateWords(l.receivedAt),
    ].join(" ");
    if (here(l.facility) && matches(text)) {
      hits.push({
        kind: "lot",
        id: l.code,
        label: l.code,
        detail: `${l.materialName}${l.vendorName ? ` · ${l.vendorName}` : ""} · ${l.usedIn.length} batches`,
        facility: l.facility,
      });
    }
  }
  for (const s of Object.values(g.shipments)) {
    if (here(s.facility) && matches(`${s.shipmentNo} ${s.customer} ${dateWords(s.shippedAt)}`)) {
      hits.push({
        kind: "shipment",
        id: s.shipmentNo,
        label: s.shipmentNo,
        detail: s.customer,
        facility: s.facility,
      });
    }
  }
  // An exact id first, then lots and batches by id.
  const exact = (h: Hit) => (h.id.toLowerCase() === q ? 0 : 1);
  hits.sort((a, b) => exact(a) - exact(b) || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}

// ------------------------------------------------------------------ recall drill

/** The recorded run's lot (PO-1042). A drill never targets it. */
export const GOLDEN_LOT = "ASC-261116-01";
/** The material a mock supplier recall notice is about. */
export const DRILL_MATERIAL = "ASC";

/**
 * The drill's target: the bought-in ascorbic acid lot that went into the most batches, never the
 * recorded run's lot; ties go to the earlier lot.
 */
export function drillLot(g: Genealogy): GenealogyLot | null {
  const candidates = Object.values(g.lots).filter(
    (l) =>
      l.material === DRILL_MATERIAL &&
      l.code !== GOLDEN_LOT &&
      !l.producedBy &&
      l.vendorLot &&
      l.usedIn.length > 0,
  );
  candidates.sort((a, b) => b.usedIn.length - a.usedIn.length || a.code.localeCompare(b.code));
  return candidates[0] ?? null;
}

export interface DrillStep {
  text: string;
  /** Milliseconds from the start of the trace, measured. */
  ms: number;
}
export interface DrillReport {
  vendorLot: string;
  vendorName: string;
  lot: string;
  materialName: string;
  steps: DrillStep[];
  trace: Trace;
  plants: string[];
  /** Lots in the trace with stock still on hand: what "Place remaining stock on hold" holds. */
  hold: { lot: string; qtyBase: number; dimension: string; facility: string | null }[];
  unitsAffected: number;
  /** Materials in the affected batches and the stock on hold, at PO prices. */
  valueAtRiskUsdc: number;
  totalMs: number;
}

function lotValue(l: GenealogyLot | undefined, qtyBase: number) {
  if (!l?.price) return 0;
  return Math.round((qtyBase * l.price.unitPriceUsdc) / l.price.basePerUnit);
}
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Traces a supplier's lot reference through the index, timing each step with `now`. */
export function runDrill(
  g: Genealogy,
  vendorLot: string,
  plantName: (code: string) => string,
  now: () => number = () => performance.now(),
): DrillReport | null {
  const t0 = now();
  const steps: DrillStep[] = [];
  const step = (text: string) => steps.push({ text, ms: now() - t0 });

  const lot = Object.values(g.lots).find((l) => l.vendorLot === vendorLot);
  if (!lot) return null;
  step(`Matched supplier lot ${vendorLot} to our lot ${lot.code}`);

  const tr = trace(g, { kind: "lot", id: lot.code });
  const batches = tr.batches.map((b) => g.batches[b]).filter((b) => b !== undefined);
  const plants = [...new Set(batches.map((b) => b.facility))].sort();
  step(
    `Used in ${plural(batches.length, "batch", "batches")} across ${plural(plants.length, "plant")}`,
  );

  if (g.has.fgLots || g.has.shipments) {
    step(
      `${plural(tr.fgLots.length, "finished-goods lot")} → ${plural(tr.shipments.length, "shipment")} to ${plural(tr.customers.length, "customer")}`,
    );
  } else {
    step(
      "The records hold no finished-goods lots or shipments yet; the trace stops at the batches",
    );
  }

  const hold = [...tr.rawLots, ...tr.fgLots]
    .map((code) => g.lots[code])
    .filter(
      (l): l is GenealogyLot =>
        l !== undefined &&
        l.onHandBase > 0 &&
        !["consumed", "rejected", "wasted"].includes(l.state ?? ""),
    )
    .map((l) => ({
      lot: l.code,
      qtyBase: l.onHandBase,
      dimension: l.dimension,
      facility: l.facility,
    }));
  step(
    hold.length
      ? `${hold.map((h) => h.lot).join(", ")} still on hand, ready to place on hold`
      : `Nothing from ${lot.code} is left on hand`,
  );

  const unitsAffected = batches.reduce((sum, b) => sum + (b.units ?? 0), 0);
  const valueAtRiskUsdc =
    batches.reduce(
      (sum, b) => sum + b.inputs.reduce((s, i) => s + lotValue(g.lots[i.lot], i.qtyBase), 0),
      0,
    ) + hold.reduce((sum, h) => sum + lotValue(g.lots[h.lot], h.qtyBase), 0);

  return {
    vendorLot,
    vendorName: lot.vendorName ?? lot.vendor ?? "",
    lot: lot.code,
    materialName: lot.materialName,
    steps,
    trace: tr,
    plants: plants.map(plantName),
    hold,
    unitsAffected,
    valueAtRiskUsdc,
    totalMs: now() - t0,
  };
}

/**
 * The trace report as text, the same for every run of the drill on the same ledger (no times),
 * so its SHA-256 is what anchoring it would record.
 */
export function traceReport(r: DrillReport): string {
  return JSON.stringify({
    kind: "trace",
    notice: { supplier: r.vendorName, supplierLot: r.vendorLot },
    lot: r.lot,
    batches: r.trace.batches,
    finishedGoodsLots: r.trace.fgLots,
    shipments: r.trace.shipments,
    customers: r.trace.customers,
    hold: r.hold.map((h) => ({ lot: h.lot, qtyBase: h.qtyBase })),
    unitsAffected: r.unitsAffected,
    valueAtRiskUsdc: r.valueAtRiskUsdc,
  });
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/**
 * SHA-256 of a text as hex. Written out rather than taken from crypto.subtle, which a page served
 * over plain http (a LAN demo, the screenshot harness) does not have.
 */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const bits = data.length * 8;
  const padded = new Uint8Array((((data.length + 9 + 63) >> 6) << 6) >>> 0);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (next[i] ?? 0)) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}
