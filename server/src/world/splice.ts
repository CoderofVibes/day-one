// The anchor splice (docs/UPGRADE_BRIEF.md §2.1.8): the seed's and the recorded run's records in
// the world's shapes, and the checks that fail the build when a generated record collides with
// one or strays into the anchor window. Anchors win: they are converted, never regenerated.

import { HISTORY_POS } from "../seed/history.ts";
import { LOTS } from "../seed/lots.ts";
import { productionHistory } from "../seed/production.ts";
import { kg, PRODUCTS } from "../seed/reference.ts";
import type { Anchors } from "./anchors.ts";
import type { WorldConfig } from "./config.ts";
import type {
  Movement,
  MovementKind,
  ProductCode,
  WorldBatch,
  WorldLot,
  WorldPo,
  WorldReceipt,
} from "./types.ts";

const MOVES: Readonly<Record<string, MovementKind>> = {
  received: "received",
  consumed: "consumed",
  wasted: "wasted",
  transfer_in: "transfer_in",
  transfer_out: "transfer_out",
};

/** When each anchored PO was placed: the seed's order dates, the recorded run's submit_po. */
function orderDates(anchors: Anchors) {
  const dates = new Map<string, string>();
  for (const po of productionHistory(new Set(LOTS.map((l) => l.code))).pos) {
    dates.set(po.poNo, `${po.orderedAt}T10:00:00.000Z`);
  }
  for (const po of HISTORY_POS) dates.set(po.poNo, `${po.orderedAt}T10:00:00.000Z`);
  for (const tx of anchors.chain) {
    if (tx.poNo && tx.method === "submit_po" && !dates.has(tx.poNo)) dates.set(tx.poNo, tx.at);
  }
  return dates;
}

export interface AnchorRecords {
  pos: WorldPo[];
  receipts: WorldReceipt[];
  lots: WorldLot[];
  movements: Movement[];
  batches: WorldBatch[];
  /** Escrow funded and released on testnet, from the recorded transactions. */
  escrow: { at: string; poNo: string; deltaUsdc: number }[];
}

export function anchorRecords(anchors: Anchors): AnchorRecords {
  const ordered = orderDates(anchors);
  const pos: WorldPo[] = anchors.pos.map((po) => {
    const approval = anchors.approvals.find((a) => a.poNo === po.poNo);
    const orderedAt = ordered.get(po.poNo);
    if (!orderedAt) throw new Error(`world: no order date for anchor ${po.poNo}`);
    return {
      poNo: po.poNo,
      era: "anchor",
      vendor: po.vendor,
      category: po.category as WorldPo["category"],
      orderedAt,
      lines: po.lines,
      freightUsdc: po.freightUsdc,
      totalUsdc: po.totalUsdc,
      approval:
        po.createdBy === "kevin"
          ? approval
            ? {
                path: "director_text",
                approver: approval.approver,
                at: approval.respondedAt ?? approval.requestedAt,
                rule: "over Kevin's $2,500 per-PO limit",
              }
            : {
                path: "auto",
                approver: null,
                at: orderedAt,
                rule: "within Kevin's $2,500 per-PO limit",
              }
          : null,
      status: po.status,
      rfq:
        anchors.rfqs.find(
          (r) => po.lines.some((l) => l.material === r.material) && po.createdBy === "kevin",
        )?.rfqNo ?? null,
      rush: false,
      incidents: [],
    };
  });

  const movements: Movement[] = [];
  const firstIn = new Map<string, { at: string; qty: number; ref: string }>();
  for (const e of anchors.events) {
    if ((e.kind === "received" || e.kind === "transfer_in") && !firstIn.has(e.lot)) {
      firstIn.set(e.lot, { at: e.at, qty: e.qtyBase, ref: e.ref });
    }
    if (e.qtyBase === 0) continue;
    movements.push([e.at, e.lot, MOVES[e.kind] ?? "adjusted", e.qtyBase, e.ref]);
  }

  const lots: WorldLot[] = anchors.lots.map((l) => {
    const first = firstIn.get(l.lot);
    const qc = anchors.qc.filter((q) => q.lot === l.lot).at(-1);
    return {
      lot: l.lot,
      era: "anchor",
      material: l.material,
      vendor: l.vendor,
      poNo: first?.ref.startsWith("po:") ? first.ref.slice(3) : null,
      receivedAt: first?.at ?? "",
      qtyBase: first?.qty ?? 0,
      qc:
        qc && (qc.decision === "released" || qc.decision === "rejected")
          ? { result: qc.decision, at: qc.decidedAt }
          : null,
    };
  });

  const receipts: WorldReceipt[] = anchors.receipts.map((r) => ({
    receiptNo: `${r.poNo}/receipt`,
    era: "anchor",
    poNo: r.poNo,
    receivedAt: r.receivedAt,
    lines: anchors.events
      .filter((e) => e.kind === "received" && e.ref === `po:${r.poNo}`)
      .map((e) => ({
        material: anchors.lots.find((l) => l.lot === e.lot)?.material ?? "",
        qtyBase: e.qtyBase,
        lot: e.lot,
      })),
    daysLate: 0,
    partial: false,
  }));

  const batches: WorldBatch[] = anchors.batches
    .filter((b) => b.status === "confirmed")
    .map((b) => {
      const spec = PRODUCTS.find((p) => p.code === b.product);
      const std = new Map<string, number>(spec?.lines.map(([code, kgs]) => [code, kg(kgs)]) ?? []);
      return {
        batchNo: b.batchNo,
        era: "anchor",
        product: b.product as ProductCode,
        date: b.startedAt.slice(0, 10),
        plannedFor: null,
        theoreticalUnits: b.theoreticalTablets,
        actualUnits: b.actualTablets ?? 0,
        yieldBp: b.yieldBp ?? 0,
        wasteBase: b.wasteBase ?? 0,
        consumption: b.inputs.map((i) => ({
          lot: i.lot,
          material: i.material,
          stdBase: std.get(i.material) ?? i.actualBase,
          actualBase: i.actualBase,
        })),
        overIssued: [],
      };
    });

  const totals = new Map(anchors.pos.map((p) => [p.poNo, p.totalUsdc]));
  const escrow = anchors.chain
    .filter(
      (tx) =>
        tx.poNo &&
        tx.status === "success" &&
        (tx.method === "submit_po" || tx.method === "qc_release"),
    )
    .map((tx) => ({
      at: tx.at,
      poNo: tx.poNo as string,
      deltaUsdc: (tx.method === "submit_po" ? 1 : -1) * (totals.get(tx.poNo as string) ?? 0),
    }));

  return { pos, receipts, lots, movements, batches, escrow };
}

export interface Splice {
  legacy: {
    pos: WorldPo[];
    lots: WorldLot[];
    batches: WorldBatch[];
    receipts: WorldReceipt[];
    movements: Movement[];
  };
  simulated: {
    pos: WorldPo[];
    lots: WorldLot[];
    batches: WorldBatch[];
    receipts: WorldReceipt[];
    movements: Movement[];
  };
  anchor: AnchorRecords;
}

/** Fails on any collision or stray record. Every problem is listed, not only the first. */
export function validateSplice(config: WorldConfig, s: Splice) {
  const problems: string[] = [];
  const { spliceIn, recordedEnd } = config.calendar;
  const ids = new Map<string, string>();
  const claim = (kind: string, id: string, era: string) => {
    const key = `${kind}:${id}`;
    const owner = ids.get(key);
    if (owner) problems.push(`${kind} ${id} is both ${owner} and ${era}`);
    ids.set(key, era);
  };
  for (const [era, set] of [
    ["anchor", s.anchor],
    ["legacy", s.legacy],
    ["simulated", s.simulated],
  ] as const) {
    for (const po of set.pos) claim("po", po.poNo, era);
    for (const lot of set.lots) claim("lot", lot.lot, era);
    for (const b of set.batches) claim("batch", b.batchNo, era);
    for (const r of set.receipts) claim("receipt", r.receiptNo, era);
  }
  const day = (iso: string) => iso.slice(0, 10);
  for (const m of s.legacy.movements) {
    if (day(m[0]) >= spliceIn)
      problems.push(`legacy movement on ${m[1]} at ${m[0]} is inside the anchor window`);
  }
  for (const b of s.legacy.batches) {
    if (b.date >= spliceIn)
      problems.push(`legacy batch ${b.batchNo} on ${b.date} is inside the anchor window`);
  }
  for (const m of s.simulated.movements) {
    if (day(m[0]) <= recordedEnd)
      problems.push(`simulated movement on ${m[1]} at ${m[0]} is inside the recorded run`);
  }
  for (const po of s.simulated.pos) {
    if (day(po.orderedAt) <= recordedEnd)
      problems.push(`simulated ${po.poNo} is ordered inside the recorded run`);
  }
  // Generated stock never touches an anchor lot before the recorded run ends.
  const anchorLots = new Set(s.anchor.lots.map((l) => l.lot));
  for (const m of s.legacy.movements) {
    if (anchorLots.has(m[1])) problems.push(`legacy movement touches anchor lot ${m[1]}`);
  }
  if (problems.length > 0) throw new Error(`world: the splice failed:\n  ${problems.join("\n  ")}`);
}
