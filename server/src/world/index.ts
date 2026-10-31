// The world generator (docs/UPGRADE_BRIEF.md §2.1): twelve months of one plant around its
// anchors. Stages run in order, each a pure function of the config, the seed and what came
// before: calendar → demand → plan → the legacy segment (BOM, inventory, purchasing, logistics,
// quality, AP) → cutover count → anchors → the simulated segment → validation → derived views.

import { ROUTES } from "../seed/production.ts";
import type { Anchors } from "./anchors.ts";
import { sales } from "./ar.ts";
import { addDays, at, calendar, demand, month, productSpec } from "./calendar.ts";
import type { Incident, WorldConfig } from "./config.ts";
import { indexes, lookBack, monthly, snapshots } from "./derive.ts";
import { batchNo, type PlannedRun, prefixOf, schedule } from "./plan.ts";
import {
  base,
  type Ids,
  type Incoming,
  material,
  type Pull,
  runSegment,
  type SimLot,
  stdDraws,
} from "./sim.ts";
import { anchorRecords, validateSplice } from "./splice.ts";
import type { Movement, WorldAdjustment, WorldLot } from "./types.ts";

/** RFQ numbers already used in November: RFQ-2611-01 (the recorded run), RFQ-2611-02 (the sealed round). */
const RFQS_USED: readonly [string, number][] = [["2611", 2]];
/** The seed's opening lots arrive over its first days at a plant (Lakeview's from Sep 5 to 8). */
const OPENING_DAYS = 7;

const numberOf = (no: string) => Number(no.split("-").at(-1));

/** What one plant's world takes from the plants generated before it. */
export interface WorldContext {
  /** Lot codes and supplier invoice numbers are shared by every plant: none repeats. */
  lots?: Set<string>;
  invoice?: Map<string, number>;
  /** Packaging this plant stages for the others (Lakeview). */
  pulls?: readonly Pull[];
  /** Lots a sister plant sent over. */
  incoming?: readonly Incoming[];
}

export function generateWorld(config: WorldConfig, anchors: Anchors, ctx: WorldContext = {}) {
  const { start, spliceIn, recordedEnd, end } = config.calendar;
  const plant = config.plant;
  const cal = calendar(config);
  const weeks = demand(config, plant, start, end);
  const anchor = anchorRecords(anchors);
  const lotCodes = ctx.lots ?? new Set<string>();
  for (const l of anchors.lots) lotCodes.add(l.lot);
  const pulls = ctx.pulls ?? [];
  const incoming = ctx.incoming ?? [];
  const inLegacy = (at: string) => at.slice(0, 10) < spliceIn;
  const inSimulated = (at: string) => at.slice(0, 10) > recordedEnd;

  const ids: Ids = {
    po: 1,
    receipt: 1,
    payment: 1,
    rfq: new Map(plant.facility === "B" ? RFQS_USED : []),
    invoice: ctx.invoice ?? new Map(),
    lots: lotCodes,
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
    const anchored = anchoredNumbers.filter((n) => n.startsWith(`${prefix}-`)).map(numberOf);
    const first = anchored.length > 0 ? Math.min(...anchored) : mine.length + 1;
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
    ...new Set([
      ...runs.flatMap((r) =>
        stdDraws(r.product, productSpec(r.product).batchTablets).map(([c]) => c),
      ),
      ...pulls.map((p) => p.material),
    ]),
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
    const pulled = pulls
      .filter((p) => p.material === code && p.date < addDays(start, 42))
      .reduce((s, p) => s + p.qtyBase, 0);
    const qty = Math.round(
      draws + pulled + base(code, m.reorderPoint) * (plant.legacy.reorderPointFactor[code] ?? 1),
    );
    if (qty === 0) continue;
    let lot = "";
    for (let seq = 1; !lot || ids.lots.has(lot); seq++)
      lot = `${code}-${start.slice(2).replaceAll("-", "")}-${String(seq).padStart(2, "0")}`;
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

  // The stock the anchors open with from the splice day: the seed's opening lots (no PO).
  const targets = new Map<string, number>();
  const anchorMaterial = new Map(anchors.lots.map((l) => [l.lot, l.material]));
  const openingEnd = addDays(spliceIn, OPENING_DAYS - 1);
  for (const e of anchors.events) {
    const d = e.at.slice(0, 10);
    if (e.kind !== "received" || d < spliceIn || d > openingEnd || e.ref !== "") continue;
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
    pulls: pulls.filter((p) => inLegacy(p.date)),
    incoming: incoming.filter((i) => inLegacy(i.at)),
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
    label: plant.legacy.countLabel,
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
  ids.po = plant.kevin.firstPo;
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
    pulls: pulls.filter((p) => inSimulated(p.date)),
    incoming: incoming.filter((i) => inSimulated(i.at)),
  });

  validateSplice(config, { legacy, simulated, anchor });

  // Lots a sister plant sent over: listed here as they arrived, with where they came from.
  const arrived: WorldLot[] = incoming
    .filter((i) => inLegacy(i.at) || inSimulated(i.at))
    .map((i) => ({
      lot: i.lot,
      era: inLegacy(i.at) ? "legacy" : "simulated",
      material: i.material,
      vendor: i.vendor,
      poNo: i.poNo,
      receivedAt: i.at,
      qtyBase: i.qtyBase,
      qc: null,
      transferNo: i.transferNo,
    }));
  const pos = [...legacy.pos, ...anchor.pos, ...simulated.pos];
  const receipts = [...legacy.receipts, ...anchor.receipts, ...simulated.receipts];
  const lots = [...legacy.lots, ...arrived, ...anchor.lots, ...simulated.lots];
  const movements = [...legacy.movements, ...anchor.movements, ...simulated.movements].sort(
    (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const batches = [...legacy.batches, ...anchor.batches, ...simulated.batches].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.batchNo < b.batchNo ? -1 : 1,
  );
  const bills = [...legacy.bills, ...simulated.bills];
  const payments = [...legacy.payments, ...simulated.payments];
  const escrow = [...anchor.escrow, ...simulated.escrow];
  const ar = sales(config, cal, batches, weeks);
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
    incidents: config.incidents.map((i) =>
      incidentView(i, legacy, simulated, plant.facility, arrived),
    ),
    transfers: [...legacy.transfers, ...simulated.transfers],
    pullShort: [...legacy.pullShort, ...simulated.pullShort],
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
    monthly: monthly(derived).map((m) => {
      const shipped = ar.shipments.filter((x) => month(x.shippedAt) === m.month);
      const invoiced = ar.invoices.filter((x) => month(x.invoiceDate) === m.month);
      return {
        ...m,
        shipments: shipped.length,
        revenueUsdc: invoiced.reduce((t, x) => t + x.amountUsdc, 0),
      };
    }),
    snapshots: snapshots(derived),
    customers: ar.customers,
    fgLots: ar.fgLots,
    shipments: ar.shipments,
    invoices: ar.invoices,
    fgMovements: ar.fgMovements,
    indexes: { ...indexes(derived), ...genealogy(ar) },
    lookBack: lookBack(derived),
  };
}

export type World = ReturnType<typeof generateWorld>;

/** Lot genealogy past the batch (§2.3): batch → finished-goods lot → shipments. */
function genealogy(ar: ReturnType<typeof sales>) {
  const batchToFgLot: Record<string, string> = {};
  for (const l of ar.fgLots) if (l.batchNo) batchToFgLot[l.batchNo] = l.fgLot;
  const fgLotToShipments: Record<string, string[]> = {};
  for (const sh of ar.shipments) {
    for (const line of sh.lines) {
      const list = fgLotToShipments[line.fgLot] ?? [];
      if (!list.includes(sh.shipmentNo)) list.push(sh.shipmentNo);
      fgLotToShipments[line.fgLot] = list;
    }
  }
  return { batchToFgLot, fgLotToShipments };
}

/** An incident with the records it touched, found in the generated segments. */
function incidentView(
  inc: Incident,
  legacy: ReturnType<typeof runSegment>,
  simulated: ReturnType<typeof runSegment>,
  facility: string,
  arrived: readonly WorldLot[],
) {
  const tagged = [...legacy.tagged, ...simulated.tagged].filter((t) => t.incident === inc.id);
  const pos = [
    ...new Set([
      ...[...legacy.pos, ...simulated.pos]
        .filter((p) => p.incidents.includes(inc.id))
        .map((p) => p.poNo),
      ...tagged.filter((t) => t.kind === "po").map((t) => t.id),
    ]),
  ];
  const affected: {
    pos: string[];
    batches: string[];
    bills: string[];
    lots: string[];
    materials: string[];
    suppliers: string[];
    plants: string[];
  } = {
    pos,
    batches: [],
    bills: [],
    lots: [...new Set(tagged.filter((t) => t.kind === "lot").map((t) => t.id))],
    materials: [],
    suppliers: [],
    plants: [facility],
  };
  const batchesUsing = (lots: string[]) =>
    [...legacy.batches, ...simulated.batches]
      .filter((b) => b.consumption.some((c) => lots.includes(c.lot)))
      .map((b) => b.batchNo);
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
  if (inc.type === "late_delivery" || inc.type === "qc_reject" || inc.type === "supplier_trial") {
    affected.materials = [inc.material];
    affected.suppliers = [inc.vendor];
  }
  if (inc.type === "late_delivery") {
    // The late lots, and the batches that waited for anything on the late PO.
    const receipts = legacy.receipts.filter((r) => affected.pos.includes(r.poNo));
    const lines = receipts.flatMap((r) => r.lines);
    affected.lots = lines.filter((l) => l.material === inc.material).map((l) => l.lot);
    const onPo = new Set(lines.map((l) => l.material));
    affected.batches = [
      ...new Set(
        legacy.shortages
          .filter(
            (s) =>
              s.materials.some((m) => onPo.has(m)) &&
              s.date >= inc.date &&
              s.date <= addDays(inc.orderedBy, 30),
          )
          .map((s) => s.batchNo),
      ),
    ];
  }
  if (inc.type === "price_change") {
    affected.materials = [inc.material];
    affected.suppliers = [...inc.vendors];
    affected.pos = inc.evidence.filter((id) => id.startsWith("PO-"));
  }
  if (inc.type === "mass_balance") {
    affected.batches = [...inc.batches];
  }
  if (inc.type === "recall_candidate") {
    // The lot as it is known at this plant: bought here, or sent over on the transfer.
    const sent = [...legacy.transfers, ...simulated.transfers].filter(
      (t) => t.transferNo === inc.transfer.transferNo,
    );
    if (affected.lots.length === 0)
      affected.lots = [
        ...new Set([
          ...sent.map((t) => t.lot),
          ...arrived.filter((l) => l.transferNo === inc.transfer.transferNo).map((l) => l.lot),
        ]),
      ];
    affected.materials = [inc.material];
    affected.suppliers = [inc.vendor];
    affected.plants = [inc.transfer.from, inc.transfer.to];
  }
  if (affected.lots.length > 0 && affected.batches.length === 0)
    affected.batches = batchesUsing(affected.lots);
  const { reKeyedAs: _, ...data } = inc as Incident & { reKeyedAs?: unknown };
  return { ...data, endsAt: "endsAt" in inc ? inc.endsAt : inc.date, affected };
}

/** The working day `n` working days before a date. */
function workingDaysBefore(cal: ReturnType<typeof calendar>, date: string, n: number) {
  let d = date;
  for (let i = 0; i < n; i++) {
    d = addDays(d, -1);
    while (!cal.isWorkingDay(d)) d = addDays(d, -1);
  }
  return d;
}

/**
 * The packaging a plant stages for the others (config `packs`): for every batch of a product it
 * serves, the bottles, caps, desiccants, labels and shippers for the units the batch made, sent
 * `leadDays` working days before the batch, one transfer per plant and day.
 */
export function packagingPulls(config: WorldConfig, worlds: readonly World[]): Pull[] {
  const packs = config.plant.packs;
  if (!packs) return [];
  const cal = calendar(config);
  const out = new Map<string, Pull>();
  for (const w of worlds) {
    for (const b of w.batches) {
      const serves = packs.serves[b.product];
      const route = ROUTES[b.product];
      if (!serves || !route) continue;
      const date = workingDaysBefore(cal, b.date, packs.leadDays);
      if (date < config.calendar.start) continue;
      const transferNo = `TR-${config.plant.facility}-${w.meta.facility}-${date.slice(2).replaceAll("-", "")}`;
      const packsMade = Math.floor(b.actualUnits / route.perPack);
      for (const code of serves) {
        const qtyBase = code === "SHC" ? Math.ceil(packsMade / route.perCase) : packsMade;
        const key = `${transferNo}|${code}`;
        const p = out.get(key);
        if (p) p.qtyBase += qtyBase;
        else out.set(key, { date, to: w.meta.facility, transferNo, material: code, qtyBase });
      }
    }
  }
  return [...out.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.transferNo < b.transferNo ? -1 : 1,
  );
}

/**
 * The three plants' worlds, each from its frozen anchors, in config order: Hollow Pine first,
 * Riverside with what Hollow Pine sent it, then Lakeview staging packaging for both. Lot codes and
 * supplier invoice numbers are shared, so none repeats across plants.
 */
export function generateWorlds(
  configs: readonly WorldConfig[],
  anchorsByFacility: Readonly<Record<string, Anchors>>,
): Record<string, World> {
  const lots = new Set<string>();
  for (const a of Object.values(anchorsByFacility)) for (const l of a.lots) lots.add(l.lot);
  const invoice = new Map<string, number>();
  const out: Record<string, World> = {};
  for (const config of configs) {
    const facility = config.plant.facility;
    const anchors = anchorsByFacility[facility];
    if (!anchors) throw new Error(`world: no anchors for ${facility}`);
    const before = Object.values(out);
    const incoming: Incoming[] = before.flatMap((w) =>
      w.transfers.filter((t) => t.to === facility).map(({ from: _, to: __, ...t }) => t),
    );
    out[facility] = generateWorld(config, anchors, {
      lots,
      invoice,
      incoming,
      pulls: packagingPulls(config, before),
    });
  }
  return out;
}
