// The world generator (docs/UPGRADE_BRIEF.md §2.1): twelve months of one plant around its
// anchors. Stages run in order, each a pure function of the config, the seed and what came
// before: calendar → demand → plan → the legacy segment (BOM, inventory, purchasing, logistics,
// quality, AP) → cutover count → anchors → the simulated segment → validation → derived views.

import type { Anchors } from "./anchors.ts";
import { addDays, at, calendar, demand, productSpec } from "./calendar.ts";
import type { Incident, WorldConfig } from "./config.ts";
import { indexes, lookBack, monthly, snapshots } from "./derive.ts";
import { batchNo, type PlannedRun, prefixOf, schedule } from "./plan.ts";
import { base, type Ids, material, runSegment, type SimLot, stdDraws } from "./sim.ts";
import { anchorRecords, validateSplice } from "./splice.ts";
import type { Movement, WorldAdjustment, WorldLot } from "./types.ts";

/** Kevin-era PO numbers start here: PO-1041 to PO-1047 are the recorded run's and PO-1047's (USDC). */
const FIRST_KEVIN_PO = 1048;
/** RFQ numbers already used in November: RFQ-2611-01 (the recorded run), RFQ-2611-02 (the sealed round). */
const RFQS_USED = new Map([["2611", 2]]);

const numberOf = (no: string) => Number(no.split("-").at(-1));

export function generateWorld(config: WorldConfig, anchors: Anchors) {
  const { start, spliceIn, recordedEnd, end } = config.calendar;
  const plant = config.plant;
  const cal = calendar(config);
  const weeks = demand(config, plant, start, end);
  const anchor = anchorRecords(anchors);

  const ids: Ids = {
    po: 1,
    receipt: 1,
    payment: 1,
    rfq: new Map(RFQS_USED),
    invoice: new Map(),
    lots: new Set(anchors.lots.map((l) => l.lot)),
  };

  // Legacy batches are numbered down from each line's first anchored number, in date order.
  const legacyRuns = schedule(
    plant,
    weeks,
    cal,
    start,
    addDays(spliceIn, -1),
    addDays(spliceIn, -1),
  );
  const anchoredNumbers = [
    ...anchors.batches.map((b) => b.batchNo),
    ...anchors.plan.map((p) => p.batchNo),
  ];
  const runs: PlannedRun[] = [];
  for (const prefix of [...new Set(legacyRuns.map((r) => prefixOf(r.product, plant.facility)))]) {
    const mine = legacyRuns.filter((r) => prefixOf(r.product, plant.facility) === prefix);
    const first = Math.min(
      ...anchoredNumbers.filter((n) => n.startsWith(`${prefix}-`)).map(numberOf),
    );
    mine.forEach((r, i) => {
      runs.push({ ...r, batchNo: batchNo(prefix, first - mine.length + i) });
    });
  }
  runs.sort((a, b) =>
    a.plannedFor < b.plannedFor
      ? -1
      : a.plannedFor > b.plannedFor
        ? 1
        : a.batchNo < b.batchNo
          ? -1
          : 1,
  );

  // Opening stock on the first day: six weeks of draws plus the reorder point, as counted.
  const opening: SimLot[] = [];
  const openingLots: WorldLot[] = [];
  const openingMoves: Movement[] = [];
  const firstWeeks = runs.filter((r) => r.plannedFor < addDays(start, 42));
  const used = [
    ...new Set(
      runs.flatMap((r) => stdDraws(r.product, productSpec(r.product).batchTablets).map(([c]) => c)),
    ),
  ].sort();
  for (const code of used) {
    const m = material(code);
    const draws = firstWeeks.reduce(
      (s, r) =>
        s +
        (stdDraws(r.product, productSpec(r.product).batchTablets * 0.92).find(
          ([c]) => c === code,
        )?.[1] ?? 0),
      0,
    );
    const qty = Math.round(
      draws + base(code, m.reorderPoint) * (plant.legacy.reorderPointFactor[code] ?? 1),
    );
    const lot = `${code}-${start.slice(2).replaceAll("-", "")}-01`;
    ids.lots.add(lot);
    opening.push({
      lot,
      material: code,
      vendor: m.vendor,
      poNo: null,
      era: "legacy",
      onHand: qty,
      releasedOn: addDays(start, -1),
      rejected: false,
    });
    openingLots.push({
      lot,
      era: "legacy",
      material: code,
      vendor: m.vendor,
      poNo: null,
      receivedAt: at(start, "05:00"),
      qtyBase: qty,
      qc: null,
    });
    openingMoves.push([at(start, "05:00"), lot, "received", qty, `opening:${start}`]);
  }

  // The stock the anchors open with on the splice day: the seed's opening lots (no PO).
  const targets = new Map<string, number>();
  const anchorMaterial = new Map(anchors.lots.map((l) => [l.lot, l.material]));
  for (const e of anchors.events) {
    if (e.kind !== "received" || !e.at.startsWith(spliceIn) || e.ref !== "") continue;
    const code = anchorMaterial.get(e.lot) ?? "";
    targets.set(code, (targets.get(code) ?? 0) + e.qtyBase);
  }

  const legacy = runSegment({
    config,
    cal,
    mode: "legacy",
    from: start,
    to: addDays(spliceIn, -1),
    runs,
    lots: opening,
    ids,
    until: spliceIn,
    targets,
  });
  legacy.lots.unshift(...openingLots);
  legacy.movements.unshift(...openingMoves);

  // The cutover count: the paper stock still on the books the evening before Day One's records
  // open is counted out, so the anchored stock from the splice on is the plant's whole stock.
  const countAt = at(addDays(spliceIn, -1), "20:00");
  const left = legacy.stock
    .filter((l) => l.onHand > 0 && !l.rejected)
    .sort((a, b) => (a.lot < b.lot ? -1 : 1));
  const cutover: WorldAdjustment = {
    adjNo: `${plant.legacyPrefix}-ADJ-0001`,
    era: "legacy",
    at: countAt,
    reason: "count",
    label: "cutover count",
    lines: left.map((l) => ({ lot: l.lot, material: l.material, qtyBase: -l.onHand })),
    counted: [...new Set([...left.map((l) => l.material), ...targets.keys()])]
      .sort()
      .map((code) => ({
        material: code,
        bookBase: left.filter((l) => l.material === code).reduce((s, l) => s + l.onHand, 0),
        countedBase: targets.get(code) ?? 0,
      })),
  };
  for (const l of left) {
    legacy.movements.push([countAt, l.lot, "adjusted", -l.onHand, `adjustment:${cutover.adjNo}`]);
    l.onHand = 0;
  }

  // Kevin's era: the anchored plan first, then demand-driven batches after its last day.
  const planned = anchors.plan.filter((p) => p.plannedFor > recordedEnd);
  const lastPlanned = planned.reduce<string>(
    (d, p) => (p.plannedFor > d ? p.plannedFor : d),
    recordedEnd,
  );
  const extra = schedule(plant, weeks, cal, addDays(lastPlanned, 1), end);
  const next = new Map<string, number>();
  for (const no of anchoredNumbers) {
    const prefix = no.slice(0, no.lastIndexOf("-"));
    next.set(prefix, Math.max(next.get(prefix) ?? 0, numberOf(no) + 1));
  }
  const kevinRuns: PlannedRun[] = [
    ...planned.map((p) => ({
      batchNo: p.batchNo,
      product: p.product as PlannedRun["product"],
      plannedFor: p.plannedFor,
    })),
    ...extra.map((r) => {
      const prefix = prefixOf(r.product, plant.facility);
      const n = next.get(prefix) ?? 1;
      next.set(prefix, n + 1);
      return { ...r, batchNo: batchNo(prefix, n) };
    }),
  ];
  const lotInfo = new Map(anchors.lots.map((l) => [l.lot, l]));
  const stock: SimLot[] = anchors.balances
    .filter((b) => b.onHandBase > 0)
    .flatMap((b) => {
      const info = lotInfo.get(b.lot);
      if (!info || info.state === "rejected") return [];
      return [
        {
          lot: b.lot,
          material: info.material,
          vendor: info.vendor,
          poNo: null,
          era: "anchor" as const,
          onHand: b.onHandBase,
          releasedOn: info.state === "quarantine" ? null : recordedEnd,
          rejected: false,
        },
      ];
    });
  const kevinPos = anchor.pos.filter((p) => p.approval);
  const committedUsdc: Record<string, number> = {};
  for (const p of kevinPos)
    committedUsdc[p.orderedAt.slice(0, 7)] =
      (committedUsdc[p.orderedAt.slice(0, 7)] ?? 0) + p.totalUsdc;
  ids.po = FIRST_KEVIN_PO;
  ids.receipt = 1;
  ids.payment = 1;
  const simulated = runSegment({
    config,
    cal,
    mode: "kevin",
    from: addDays(recordedEnd, 1),
    to: end,
    runs: kevinRuns,
    lots: stock,
    ids,
    openPos: anchor.pos
      .filter((p) => p.status === "funded")
      .map((p) => ({ po: structuredClone(p), arrives: cal.onOrAfter(addDays(recordedEnd, 1)) })),
    committedUsdc,
    quarantined: stock.filter((l) => l.releasedOn === null).map((l) => l.lot),
  });

  validateSplice(config, { legacy, simulated, anchor });

  const pos = [...legacy.pos, ...anchor.pos, ...simulated.pos];
  const receipts = [...legacy.receipts, ...anchor.receipts, ...simulated.receipts];
  const lots = [...legacy.lots, ...anchor.lots, ...simulated.lots];
  const movements = [...legacy.movements, ...anchor.movements, ...simulated.movements].sort(
    (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const batches = [...legacy.batches, ...anchor.batches, ...simulated.batches].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.batchNo < b.batchNo ? -1 : 1,
  );
  const bills = [...legacy.bills, ...simulated.bills];
  const payments = [...legacy.payments, ...simulated.payments];
  const escrow = [...anchor.escrow, ...simulated.escrow];
  const derived = {
    config,
    pos,
    receipts,
    lots,
    movements,
    batches,
    bills,
    payments,
    escrow,
    demand: weeks,
  };

  return {
    meta: {
      seed: config.seed,
      facility: plant.facility,
      plant: plant.name,
      calendar: { start, spliceIn, t0: config.calendar.t0, recordedEnd, end },
      eras: {
        legacy: `${start} to ${addDays(spliceIn, -1)}: generated, before Day One`,
        anchor: `${spliceIn} to ${recordedEnd}: the seed and the recorded run, unchanged`,
        simulated: `${addDays(recordedEnd, 1)} to ${end}: Simulated`,
      },
    },
    incidents: config.incidents.map((i) => incidentView(i, legacy, simulated)),
    pos,
    receipts,
    lots,
    qc: [...legacy.qc, ...simulated.qc],
    movements,
    batches,
    bills,
    payments,
    adjustments: [cutover],
    rfqs: simulated.rfqs,
    simulatedChain: simulated.chain,
    escrow,
    shortages: [...legacy.shortages, ...simulated.shortages],
    demand: weeks,
    monthly: monthly(derived),
    snapshots: snapshots(derived),
    indexes: indexes(derived),
    lookBack: lookBack(derived),
  };
}

export type World = ReturnType<typeof generateWorld>;

/** An incident with the records it touched, found in the generated segments. */
function incidentView(
  inc: Incident,
  legacy: ReturnType<typeof runSegment>,
  simulated: ReturnType<typeof runSegment>,
) {
  const pos = [...legacy.pos, ...simulated.pos]
    .filter((p) => p.incidents.includes(inc.id))
    .map((p) => p.poNo);
  const affected: {
    pos: string[];
    batches: string[];
    bills: string[];
    materials: string[];
    suppliers: string[];
  } = {
    pos,
    batches: [],
    bills: [],
    materials: [],
    suppliers: [],
  };
  if (inc.type === "stockout") {
    affected.batches = [
      ...new Set(
        legacy.shortages.filter((s) => s.materials.includes(inc.material)).map((s) => s.batchNo),
      ),
    ];
    affected.materials = [inc.material];
    affected.suppliers = [inc.lateOrder.vendor];
  }
  if (inc.type === "duplicate_invoice") {
    affected.bills = legacy.duplicates.flat();
    affected.pos = legacy.bills
      .filter((b) => affected.bills.includes(b.billNo))
      .map((b) => b.poNo)
      .slice(0, 1);
    affected.suppliers = [inc.vendor];
  }
  const { reKeyedAs: _, ...data } = inc as Incident & { reKeyedAs?: unknown };
  return { ...data, endsAt: "endsAt" in inc ? inc.endsAt : inc.date, affected };
}
