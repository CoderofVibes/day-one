// One segment of a plant's life, day by day (docs/UPGRADE_BRIEF.md §2.1.3): BOM explosion,
// inventory by lot, purchasing, logistics, quality and accounts payable. A segment is either
// the legacy past (Ray's Monday reviews, paper POs, bills paid by the ERP's mock ACH) or the
// simulated present (Kevin's daily review, RFQs, the spend policy, escrow releases). Pure: the
// same inputs give the same records, and every draw is from a stream named after its entity.

import { type MatchPo, threeWayMatch } from "@day-one/erp/match";
import { QC_SAMPLE_MG } from "../seed/history.ts";
import { ROUTES } from "../seed/production.ts";
import { kg, LIST_PRICE, MATERIALS, VENDORS } from "../seed/reference.ts";
import { addDays, at, type Calendar, daysBetween, month, productSpec } from "./calendar.ts";
import { AP, PRICES, PRODUCTION, RUSH, type WorldConfig } from "./config.ts";
import type { PlannedRun } from "./plan.ts";
import { stream } from "./rng.ts";
import type {
  Era,
  Movement,
  SimulatedChainEvent,
  WorldBatch,
  WorldBill,
  WorldLot,
  WorldPayment,
  WorldPo,
  WorldReceipt,
  WorldRfq,
} from "./types.ts";

export function material(code: string): (typeof MATERIALS)[number] {
  const m = MATERIALS.find((x) => x.code === code);
  if (!m) throw new Error(`world: no material ${code}`);
  return m;
}

/** Inventory units to base units: kg to mg, each to each. */
export const base = (code: string, qty: number) => (material(code).uom === "kg" ? kg(qty) : qty);

/** Round a base quantity up to how the material is bought (production.ts packUp). */
export function packUp(code: string, qtyBase: number) {
  const m = material(code);
  if (m.uom === "ea") return Math.ceil(qtyBase / 1_000) * 1_000;
  const kgs = qtyBase / 1_000_000;
  return kg(kgs >= 200 ? Math.ceil(kgs / 25) * 25 : Math.ceil(kgs));
}

/** Extended price of a line: quantity in inventory units times the unit price. */
export const extended = (code: string, qtyBase: number, unitPriceUsdc: number) =>
  Math.round(
    material(code).uom === "kg" ? (qtyBase * unitPriceUsdc) / 1_000_000 : qtyBase * unitPriceUsdc,
  );

const usdc = (dollars: number) => Math.round(dollars * 1_000_000);

export interface SimLot {
  lot: string;
  material: string;
  vendor: string;
  poNo: string | null;
  era: Era;
  onHand: number;
  /** Usable by a batch on any day after this one; null while in quarantine or rejected. */
  releasedOn: string | null;
  rejected: boolean;
}

/** Counters shared by every segment so numbers never repeat. */
export interface Ids {
  po: number;
  receipt: number;
  payment: number;
  rfq: Map<string, number>;
  invoice: Map<string, number>;
  lots: Set<string>;
}

export interface SegmentInput {
  config: WorldConfig;
  cal: Calendar;
  mode: "legacy" | "kevin";
  from: string;
  to: string;
  runs: readonly PlannedRun[];
  lots: SimLot[];
  ids: Ids;
  /** Legacy: the day the anchors take over; nothing arrives after it. */
  until?: string;
  /** Legacy: the stock to hand over at `until`, per material (the anchored opening lots). */
  targets?: ReadonlyMap<string, number>;
  /** Kevin: POs already open at the start (funded on testnet in the recorded run). */
  openPos?: readonly { po: WorldPo; arrives: string }[];
  /** Kevin: what he had already committed in the start month. */
  committedUsdc?: Readonly<Record<string, number>>;
  /** Kevin: anchor lots still in quarantine at the start, released on the first working day. */
  quarantined?: readonly string[];
  /** Lakeview: packaging staged for the other plants' batches, sent out on the day. */
  pulls?: readonly Pull[];
  /** Lots sent over from a sister plant, usable the day after they arrive. */
  incoming?: readonly Incoming[];
}

export interface Pull {
  date: string;
  to: string;
  transferNo: string;
  material: string;
  qtyBase: number;
}

export interface Incoming {
  transferNo: string;
  at: string;
  lot: string;
  material: string;
  vendor: string;
  poNo: string | null;
  qtyBase: number;
}

/** One lot's part of a transfer out of the plant. */
export interface TransferOut extends Incoming {
  from: string;
  to: string;
}

export interface QcRecord {
  lot: string;
  era: Era;
  result: "released" | "rejected";
  at: string;
}

export interface SegmentOutput {
  pos: WorldPo[];
  receipts: WorldReceipt[];
  lots: WorldLot[];
  qc: QcRecord[];
  movements: Movement[];
  batches: WorldBatch[];
  bills: WorldBill[];
  payments: WorldPayment[];
  rfqs: WorldRfq[];
  chain: SimulatedChainEvent[];
  /** Escrow funded (+) and released (-), Kevin's era only. */
  escrow: { at: string; poNo: string; deltaUsdc: number }[];
  /** Batches that found a material short, with the materials. */
  shortages: { batchNo: string; date: string; materials: string[] }[];
  /** Bills keyed in twice: [the original, the copy]. */
  duplicates: [string, string][];
  /** Stock sent to the sister plants, lot by lot. */
  transfers: TransferOut[];
  /** Packaging the plant could not stage in full: what was short, per transfer. */
  pullShort: { transferNo: string; material: string; shortBase: number }[];
  /** Records an incident shaped, by incident id. */
  tagged: { incident: string; kind: "po" | "lot"; id: string }[];
  /** Lots left at the end, for the next segment or the cutover count. */
  stock: SimLot[];
}

interface Shipment {
  poNo: string;
  arrives: string;
  promised: string;
  lines: { material: string; qtyBase: number }[];
  partial: boolean;
  rush: boolean;
  /** A replacement for a rejected lot: billed with the rest of the PO. */
  replacement: boolean;
  received?: boolean;
}

/** Every material a product draws per batch: formula lines, components and packaging. */
export function stdDraws(product: WorldBatch["product"], units: number) {
  const p = productSpec(product);
  const route = ROUTES[product];
  if (!route) throw new Error(`world: no route for ${product}`);
  const draws: [string, number][] = p.lines.map(([code, kgPerBatch]) => [code, kg(kgPerBatch)]);
  for (const [code, per] of route.components ?? [])
    draws.push([code, Math.round(p.batchTablets * per)]);
  if (route.pack.length > 0) {
    const packs = Math.floor(units / route.perPack);
    for (const code of route.pack) draws.push([code, packs]);
    draws.push(["SHC", Math.ceil(packs / route.perCase)]);
  }
  return draws;
}

const pad = (n: number) => String(n).padStart(4, "0");

export function runSegment(input: SegmentInput): SegmentOutput {
  const { config, cal, mode, from, to, ids } = input;
  const plant = config.plant;
  const era: Era = mode === "legacy" ? "legacy" : "simulated";
  const out: SegmentOutput = {
    pos: [],
    receipts: [],
    lots: [],
    qc: [],
    movements: [],
    batches: [],
    bills: [],
    payments: [],
    rfqs: [],
    chain: [],
    escrow: [],
    shortages: [],
    duplicates: [],
    transfers: [],
    pullShort: [],
    tagged: [],
    stock: input.lots,
  };
  const lots = input.lots;
  const shipments: Shipment[] = [];
  const pending: { run: PlannedRun; date: string; slipped: boolean }[] = input.runs.map((run) => ({
    run,
    date: run.plannedFor,
    slipped: false,
  }));
  const posByNo = new Map<string, WorldPo>();
  const billedFreight = new Set<string>();
  const committed = new Map<string, number>(Object.entries(input.committedUsdc ?? {}));
  const pulls = input.pulls ?? [];
  const materialsInUse = [
    ...new Set([
      ...input.runs.flatMap((r) =>
        stdDraws(r.product, productSpec(r.product).batchTablets).map(([c]) => c),
      ),
      ...pulls.map((p) => p.material),
    ]),
  ].sort();
  const lateApplied = new Set<string>();
  const rejectApplied = new Set<string>();
  const cancelled = new Set<string>();
  let duplicateApplied = false;
  const surcharge = config.incidents.find((i) => i.type === "freight_surcharge");
  const stockout = config.incidents.find((i) => i.type === "stockout");
  const duplicate = config.incidents.find((i) => i.type === "duplicate_invoice");
  const lateDeliveries = config.incidents.filter((i) => i.type === "late_delivery");
  const qcRejects = config.incidents.filter((i) => i.type === "qc_reject");
  const trials = config.incidents.filter((i) => i.type === "supplier_trial");
  const bulk = config.incidents.filter(
    (i) => i.type === "recall_candidate" && i.transfer.from === plant.facility,
  );
  /** POs placed for an incident: the incident id, by PO number. */
  const incidentPo = new Map<string, string>();
  const tag = (incident: string, kind: "po" | "lot", id: string) =>
    out.tagged.push({ incident, kind, id });

  const priceOf = (code: string, vendor: string, date: string) => {
    if (mode === "kevin") return LIST_PRICE[code] ?? 0;
    const list = LIST_PRICE[code] ?? 0;
    let price =
      PRICES.legacyOverride[code] ??
      list * (1 - (PRICES.annualDrift * daysBetween(date, config.calendar.spliceIn)) / 365);
    for (const step of PRICES.legacySteps) {
      if (step.material === code && step.vendor === vendor && date >= step.from)
        price *= step.factor;
    }
    // Prices are quoted to a hundredth of a cent.
    return Math.round(price * 10_000) / 10_000;
  };

  const newLot = (code: string, date: string) => {
    const yymmdd = date.slice(2).replaceAll("-", "");
    for (let seq = 1; ; seq++) {
      const lot = `${code}-${yymmdd}-${String(seq).padStart(2, "0")}`;
      if (!ids.lots.has(lot)) {
        ids.lots.add(lot);
        return lot;
      }
    }
  };

  const nextInvoice = (vendor: string) => {
    const params = config.suppliers[vendor];
    if (!params) throw new Error(`world: no supplier params for ${vendor}`);
    const n = ids.invoice.get(vendor) ?? params.invoiceStart;
    ids.invoice.set(vendor, n + 1);
    return `${params.invoicePrefix}${n}`;
  };

  const usable = (code: string, date: string) =>
    lots
      .filter(
        (l) =>
          l.material === code &&
          !l.rejected &&
          l.onHand > 0 &&
          l.releasedOn !== null &&
          l.releasedOn < date,
      )
      .sort((a, b) => (a.lot < b.lot ? -1 : 1));

  /** Places a PO and its shipments. */
  const placePo = (
    date: string,
    vendor: string,
    lines: { material: string; qtyBase: number; unitPriceUsdc?: number }[],
    opts: { rush?: boolean; rfq?: string | null; freightUsdc?: number } = {},
  ) => {
    const params = config.suppliers[vendor];
    if (!params) throw new Error(`world: no supplier params for ${vendor}`);
    const poNo =
      mode === "legacy"
        ? `${plant.legacyPrefix}-PO-${pad(ids.po++)}`
        : `${plant.kevin.poPrefix}${ids.po++}`;
    const category = lines.every((l) => material(l.material).category === "packaging")
      ? "packaging"
      : "raw_material";
    const incidents: string[] = [];
    let freightUsdc = opts.freightUsdc ?? usdc(opts.rush ? RUSH.freightUsd : params.freightUsd);
    if (
      mode === "legacy" &&
      surcharge?.type === "freight_surcharge" &&
      category === surcharge.category &&
      date >= surcharge.date &&
      date <= surcharge.endsAt
    ) {
      freightUsdc += usdc(surcharge.surchargeUsd);
      incidents.push(surcharge.id);
    }
    if (
      opts.rush &&
      mode === "legacy" &&
      stockout?.type === "stockout" &&
      lines.some((l) => l.material === stockout.material)
    ) {
      incidents.push(stockout.id);
    }
    const poLines = lines.map((l) => {
      const unitPriceUsdc = l.unitPriceUsdc ?? usdc(priceOf(l.material, vendor, date));
      return {
        material: l.material,
        qtyBase: l.qtyBase,
        unitPriceUsdc,
        extendedUsdc: extended(l.material, l.qtyBase, unitPriceUsdc),
      };
    });
    const totalUsdc = poLines.reduce((s, l) => s + l.extendedUsdc, 0) + freightUsdc;
    const orderedAt = at(date, opts.rush ? "07:00" : mode === "legacy" ? "10:00" : "09:00");
    let approval: WorldPo["approval"];
    if (mode === "legacy") {
      approval = {
        path: "legacy_paper",
        approver: plant.legacy.approver,
        at: orderedAt,
        rule: plant.legacy.rule,
      };
    } else {
      const conditional = VENDORS.find((v) => v.code === vendor)?.qualification === "conditional";
      const over = totalUsdc > usdc(plant.kevin.perPoLimitUsd);
      approval =
        over || conditional
          ? {
              path: "director_text",
              approver: plant.kevin.approver,
              at: at(date, "09:20"),
              rule: conditional
                ? "conditional supplier: director approval"
                : `over Kevin's $${plant.kevin.perPoLimitUsd.toLocaleString("en-US")} per-PO limit`,
            }
          : {
              path: "auto",
              approver: null,
              at: orderedAt,
              rule: `within Kevin's $${plant.kevin.perPoLimitUsd.toLocaleString("en-US")} per-PO limit`,
            };
    }
    const po: WorldPo = {
      poNo,
      era,
      vendor,
      category,
      orderedAt,
      lines: poLines,
      freightUsdc,
      totalUsdc,
      approval,
      status: mode === "legacy" ? "ordered" : "funded",
      rfq: opts.rfq ?? null,
      rush: opts.rush ?? false,
      incidents,
    };
    out.pos.push(po);
    posByNo.set(poNo, po);
    if (mode === "kevin" && approval) {
      const m = month(date);
      committed.set(m, (committed.get(m) ?? 0) + totalUsdc);
      if (approval.path === "director_text") out.chain.push(sim(approval.at, "approve_po", poNo));
      out.chain.push(sim(approval.at, "submit_po", poNo));
      out.escrow.push({ at: approval.at, poNo, deltaUsdc: totalUsdc });
    }
    // Logistics: lead time, lateness and partial deliveries, from the PO's own stream.
    const r = stream(config.seed, "logistics", vendor, poNo);
    const lead = opts.rush
      ? RUSH.leadDays
      : Math.max(2, Math.round(r.normal(params.leadDays.mean, params.leadDays.sd)));
    let late = !opts.rush && !r.chance(params.onTimeRate) ? r.int(2, 6) : 0;
    if (
      mode === "legacy" &&
      stockout?.type === "stockout" &&
      vendor === stockout.lateOrder.vendor &&
      lines.some((l) => l.material === stockout.material) &&
      date >= stockout.lateOrder.from &&
      date <= stockout.lateOrder.to &&
      !lateApplied.has(stockout.id)
    ) {
      lateApplied.add(stockout.id);
      late = stockout.lateOrder.extraDays;
      po.incidents.push(stockout.id);
    }
    for (const inc of lateDeliveries) {
      if (
        inc.type !== "late_delivery" ||
        mode !== "legacy" ||
        lateApplied.has(inc.id) ||
        vendor !== inc.vendor ||
        !lines.some((l) => l.material === inc.material) ||
        date < inc.date ||
        date > inc.orderedBy
      )
        continue;
      lateApplied.add(inc.id);
      late = inc.extraDays;
      po.incidents.push(inc.id);
    }
    const promised = cal.onOrAfter(addDays(date, lead));
    let arrives = late > 0 ? cal.onOrAfter(addDays(promised, late)) : promised;
    let partial = !opts.rush && r.chance(params.partialRate);
    // The legacy books close at the splice: a delivery that would land after it lands whole and
    // on time (the anchored seed opens with the plant's stock already counted).
    if (input.until && arrives >= input.until) arrives = promised;
    // Still past the splice (a rush on the last day): it lands the day it was ordered.
    if (input.until && arrives >= input.until) arrives = date;
    if (input.until && partial && cal.onOrAfter(addDays(arrives, 4)) >= input.until)
      partial = false;
    const qtys = lines.map((l) => ({ material: l.material, qtyBase: l.qtyBase }));
    if (partial) {
      const first = qtys.map((l) => ({
        ...l,
        qtyBase: Math.floor((l.qtyBase * 0.7) / 1_000) * 1_000,
      }));
      const rest = qtys.map((l, i) => ({ ...l, qtyBase: l.qtyBase - (first[i]?.qtyBase ?? 0) }));
      shipments.push({
        poNo,
        arrives,
        promised,
        lines: first,
        partial: true,
        rush: false,
        replacement: false,
      });
      shipments.push({
        poNo,
        arrives: cal.onOrAfter(addDays(arrives, 4)),
        promised,
        lines: rest.filter((l) => l.qtyBase > 0),
        partial: true,
        rush: false,
        replacement: false,
      });
    } else {
      shipments.push({
        poNo,
        arrives,
        promised,
        lines: qtys,
        partial: false,
        rush: opts.rush ?? false,
        replacement: false,
      });
    }
    return po;
  };

  const sim = (
    when: string,
    method: SimulatedChainEvent["method"],
    ref: string,
  ): SimulatedChainEvent => ({
    at: when,
    method,
    ref,
    label: "Simulated · would anchor",
  });

  /**
   * The supplier bills a PO once, for the whole order and its freight, when the last of it has
   * been received and accepted (the ERP matches one bill to its PO: erp/src/match.ts).
   */
  const accepted = new Map<string, Map<string, number>>();
  const billReceipt = (
    receipt: WorldReceipt,
    passed: { material: string; qtyBase: number }[],
    paidOn: string,
  ) => {
    const po = posByNo.get(receipt.poNo);
    if (!po) return;
    const got = accepted.get(po.poNo) ?? new Map<string, number>();
    for (const a of passed) got.set(a.material, (got.get(a.material) ?? 0) + a.qtyBase);
    accepted.set(po.poNo, got);
    if (billedFreight.has(po.poNo) || po.lines.some((l) => (got.get(l.material) ?? 0) < l.qtyBase))
      return;
    const lines = po.lines.map((l) => ({
      material: l.material,
      qtyBase: l.qtyBase,
      rateUsdc: l.unitPriceUsdc,
      amountUsdc: l.extendedUsdc,
    }));
    const freightUsdc = po.freightUsdc;
    billedFreight.add(po.poNo);
    const amountUsdc = lines.reduce((s, l) => s + l.amountUsdc, 0) + freightUsdc;
    const day = receipt.receivedAt.slice(0, 10);
    const lag = stream(config.seed, "ap", po.vendor, receipt.receiptNo);
    const billDate =
      mode === "legacy" ? addDays(day, lag.int(AP.billLagDays.lo, AP.billLagDays.hi)) : day;
    const bill: WorldBill = {
      billNo: nextInvoice(po.vendor),
      era,
      vendor: po.vendor,
      poNo: po.poNo,
      receiptNo: receipt.receiptNo,
      billDate,
      dueDate: addDays(billDate, AP.termsDays),
      lines,
      freightUsdc,
      amountUsdc,
      match: mode === "legacy" ? "matched" : matchOf(po, lines, freightUsdc, amountUsdc),
      status: "open",
    };
    out.bills.push(bill);
    const pay = (b: WorldBill, when: string) => {
      if (when.slice(0, 10) > config.calendar.end) return;
      b.status = "paid";
      out.payments.push({
        paymentNo:
          mode === "legacy"
            ? `${plant.legacyPrefix}-PAY-${pad(ids.payment++)}`
            : `PAY-S-${plant.kevin.docTag}${pad(ids.payment++)}`,
        era,
        bills: [b.billNo],
        amountUsdc: b.amountUsdc,
        paidAt: when,
        rail: mode === "legacy" ? "erp_ach_mock" : "escrow_release",
        chain: mode === "legacy" ? null : "Simulated · would anchor",
      });
      if (mode === "kevin") out.escrow.push({ at: when, poNo: po.poNo, deltaUsdc: -b.amountUsdc });
    };
    if (mode === "legacy") {
      pay(bill, at(cal.onOrAfter(bill.dueDate), "10:00"));
      if (
        duplicate?.type === "duplicate_invoice" &&
        !duplicateApplied &&
        po.vendor === duplicate.vendor &&
        billDate >= duplicate.date
      ) {
        duplicateApplied = true;
        const copyDate = addDays(billDate, 3);
        const copy: WorldBill = {
          ...bill,
          billNo: duplicate.reKeyedAs(bill.billNo),
          billDate: copyDate,
          dueDate: addDays(copyDate, AP.termsDays),
          status: "open",
        };
        out.bills.push(copy);
        out.duplicates.push([bill.billNo, copy.billNo]);
        pay(copy, at(cal.onOrAfter(copy.dueDate), "10:00"));
      }
    } else {
      pay(bill, paidOn);
    }
  };

  const matchOf = (
    po: WorldPo,
    lines: WorldBill["lines"],
    freightUsdc: number,
    amountUsdc: number,
  ): WorldBill["match"] => {
    const received = new Map<string, number>();
    for (const r of out.receipts.filter((x) => x.poNo === po.poNo)) {
      for (const l of r.lines) {
        if (!lots.find((x) => x.lot === l.lot)?.rejected)
          received.set(l.material, (received.get(l.material) ?? 0) + l.qtyBase);
      }
    }
    const billed = new Map<string, number>();
    for (const b of out.bills.filter((x) => x.poNo === po.poNo)) {
      for (const l of b.lines) billed.set(l.material, (billed.get(l.material) ?? 0) + l.qtyBase);
    }
    const matchPo: MatchPo = {
      tranId: po.poNo,
      vendorId: 1,
      status: "pendingBilling",
      freightUsdc: po.freightUsdc,
      totalUsdc: po.totalUsdc,
      lines: po.lines.map((l, i) => ({
        line: i + 1,
        itemId: i + 1,
        itemCode: l.material,
        quantityBase: l.qtyBase,
        rateUsdc: l.unitPriceUsdc,
        amountUsdc: l.extendedUsdc,
        receivedBase: received.get(l.material) ?? 0,
        billedBase: billed.get(l.material) ?? 0,
      })),
    };
    const result = threeWayMatch(
      {
        vendorId: 1,
        freightUsdc,
        totalUsdc: amountUsdc,
        lines: lines.map((l, i) => ({
          line: i + 1,
          itemId: po.lines.findIndex((p) => p.material === l.material) + 1,
          itemCode: l.material,
          quantityBase: l.qtyBase,
          rateUsdc: l.rateUsdc,
          amountUsdc: l.amountUsdc,
          poLine: po.lines.findIndex((p) => p.material === l.material) + 1,
        })),
      },
      matchPo,
      AP.tolerances,
      { qty: (n) => String(n), usd: (n) => String(n) },
    );
    if (result.status === "matched") return "matched";
    const code = result.exceptions[0]?.code ?? "";
    return code.startsWith("QTY")
      ? "qty_variance"
      : code.includes("RATE") || code.startsWith("AMT")
        ? "price_variance"
        : "unmatched";
  };

  const receive = (s: Shipment, day: string) => {
    s.received = true;
    const receiptNo =
      mode === "legacy"
        ? `${plant.legacyPrefix}-IR-${pad(ids.receipt++)}`
        : `IR-S-${plant.kevin.docTag}${pad(ids.receipt++)}`;
    const po = posByNo.get(s.poNo);
    if (!po) throw new Error(`world: shipment for unknown ${s.poNo}`);
    const receipt: WorldReceipt = {
      receiptNo,
      era,
      poNo: s.poNo,
      receivedAt: at(day, s.rush ? "08:00" : "14:00"),
      lines: [],
      daysLate: Math.max(0, daysBetween(s.promised, day)),
      partial: s.partial,
    };
    const accepted: { material: string; qtyBase: number }[] = [];
    let releaseAt = "";
    for (const line of s.lines) {
      const code = newLot(line.material, day);
      receipt.lines.push({ material: line.material, qtyBase: line.qtyBase, lot: code });
      const params = config.suppliers[po.vendor];
      const forced = qcRejects.find(
        (i) =>
          i.type === "qc_reject" &&
          mode === "legacy" &&
          !rejectApplied.has(i.id) &&
          i.vendor === po.vendor &&
          i.material === line.material &&
          day >= i.date,
      );
      if (forced) {
        rejectApplied.add(forced.id);
        tag(forced.id, "lot", code);
        tag(forced.id, "po", po.poNo);
        po.incidents.push(forced.id);
      }
      const owner = incidentPo.get(po.poNo);
      if (owner) tag(owner, "lot", code);
      const isTrial = owner !== undefined && trials.some((i) => i.id === owner);
      const pass =
        !forced &&
        !isTrial &&
        (s.rush || stream(config.seed, "quality", po.vendor, code).chance(params?.qcPassRate ?? 1));
      const releasedOn = s.rush ? day : cal.onOrAfter(addDays(day, PRODUCTION.releaseDays));
      const decidedAt = pass
        ? at(releasedOn, s.rush ? "12:00" : "16:00")
        : at(addDays(day, 1), "10:00");
      const lot: SimLot = {
        lot: code,
        material: line.material,
        vendor: po.vendor,
        poNo: po.poNo,
        era,
        onHand: line.qtyBase,
        releasedOn: pass ? releasedOn : null,
        rejected: !pass,
      };
      lots.push(lot);
      out.lots.push({
        lot: code,
        era,
        material: line.material,
        vendor: po.vendor,
        poNo: po.poNo,
        receivedAt: receipt.receivedAt,
        qtyBase: line.qtyBase,
        qc: { result: pass ? "released" : "rejected", at: decidedAt },
      });
      out.qc.push({ lot: code, era, result: pass ? "released" : "rejected", at: decidedAt });
      out.movements.push([
        receipt.receivedAt,
        code,
        "received",
        line.qtyBase,
        `receipt:${receiptNo}`,
      ]);
      if (pass) {
        accepted.push({ material: line.material, qtyBase: line.qtyBase });
        releaseAt = decidedAt > releaseAt ? decidedAt : releaseAt;
      } else {
        // Rejected: returned to the supplier, and a replacement follows on the same PO.
        // Returned within the days the world covers.
        const due = addDays(day, 1 + PRODUCTION.returnDays);
        const back =
          due <= config.calendar.end ? at(due, "11:00") : at(config.calendar.end, "17:00");
        out.movements.push([back, code, "wasted", -line.qtyBase, `return:${receiptNo}`]);
        lot.onHand = 0;
        if (isTrial) {
          cancelled.add(po.poNo);
          continue;
        }
        let arrives = cal.onOrAfter(addDays(day, PRODUCTION.replacementDays));
        // The legacy books close at the splice: a replacement comes sooner, or not at all.
        if (input.until && arrives >= input.until) {
          arrives = cal.after(day);
          if (arrives >= input.until) continue;
        }
        shipments.push({
          poNo: po.poNo,
          arrives,
          promised: arrives,
          lines: [line],
          partial: s.partial,
          rush: false,
          replacement: true,
        });
      }
    }
    out.receipts.push(receipt);
    if (mode === "kevin") {
      out.chain.push(sim(receipt.receivedAt, "confirm_receipt", po.poNo));
      if (releaseAt) out.chain.push(sim(releaseAt, "qc_release", po.poNo));
    }
    billReceipt(receipt, accepted, releaseAt);
  };

  /** Standard draws of every batch not yet run, by date. */
  const plannedDraws = (code: string, fromDay: string, toDay: string) =>
    pending
      .filter((p) => p.date >= fromDay && p.date <= toDay)
      .reduce((s, p) => {
        const units = productSpec(p.run.product).batchTablets;
        const draw = stdDraws(p.run.product, units * 0.92).find(([c]) => c === code);
        return s + (draw?.[1] ?? 0);
      }, 0) +
    pulls
      .filter((p) => p.material === code && p.date >= fromDay && p.date <= toDay)
      .reduce((s, p) => s + p.qtyBase, 0);
  // Stock on its way counts: deliveries, and what a sister plant is sending over.
  const onOrder = (code: string, afterDay: string) =>
    shipments
      .filter((s) => s.arrives >= afterDay)
      .reduce(
        (sum, s) =>
          sum + s.lines.filter((l) => l.material === code).reduce((a, l) => a + l.qtyBase, 0),
        0,
      ) +
    (input.incoming ?? [])
      .filter((i) => i.material === code && i.at.slice(0, 10) >= afterDay)
      .reduce((sum, i) => sum + i.qtyBase, 0);
  const onHandAll = (code: string) =>
    lots.filter((l) => l.material === code && !l.rejected).reduce((s, l) => s + l.onHand, 0);

  const review = (d: string) => {
    const orders: {
      material: string;
      vendor: string;
      qtyBase: number;
      unitPriceUsdc?: number;
      rfq?: string;
    }[] = [];
    for (const code of materialsInUse) {
      const m = material(code);
      const params = config.suppliers[m.vendor];
      if (!params) continue;
      const reviewGap = mode === "legacy" ? 7 : 1;
      // The paper sheet looked only a review week ahead for some materials (INC-01's gap).
      const weekOnly =
        mode === "legacy" &&
        plant.legacy.weekAheadOnly.materials.includes(code) &&
        plant.legacy.weekAheadOnly.months.includes(Number(d.slice(5, 7)));
      const lookAhead = weekOnly
        ? reviewGap
        : params.leadDays.mean + reviewGap + PRODUCTION.releaseDays + 1;
      const horizon = addDays(d, Math.ceil(lookAhead));
      const factor = mode === "legacy" ? (plant.legacy.reorderPointFactor[code] ?? 1) : 1;
      const rop = base(code, m.reorderPoint) * factor;
      let end = horizon;
      let floor = rop;
      if (input.until) {
        // Hand over at the splice what the anchors open with: the reorder point gives way to
        // that stock over the last six weeks, and nothing is ordered that would arrive after.
        const target = input.targets?.get(code) ?? 0;
        const left = daysBetween(d, input.until);
        const fade = Math.max(0, Math.min(1, (left - 14) / 42));
        floor = rop * fade + target * (1 - fade);
        if (end >= input.until) end = addDays(input.until, -1);
        if (cal.onOrAfter(addDays(d, Math.round(params.leadDays.mean + 1))) >= input.until)
          continue;
      }
      const position = onHandAll(code) + onOrder(code, d) - plannedDraws(code, d, end);
      if (position >= floor) continue;
      let qty: number;
      if (mode === "legacy") {
        qty =
          Math.max(base(code, m.reorderQty), floor + base(code, m.reorderQty) - position) *
          plant.legacy.overOrderFactor;
      } else {
        // Kevin buys to the forecast: the reorder point plus what the plan draws before the
        // next delivery could land, never the whole reorder quantity by habit.
        qty = floor - position;
      }
      if (input.until) {
        const target = input.targets?.get(code) ?? 0;
        const need =
          plannedDraws(code, d, addDays(input.until, -1)) +
          Math.max(target, floor) -
          onHandAll(code) -
          onOrder(code, d);
        qty = Math.min(qty, Math.max(need, 0));
      }
      if (qty <= 0) continue;
      const override = plant.legacy.vendorOverride?.find(
        (o) => mode === "legacy" && o.material === code && d >= o.from && d <= o.to,
      );
      orders.push({
        material: code,
        vendor: override?.vendor ?? m.vendor,
        qtyBase: packUp(code, qty),
      });
    }
    if (mode === "kevin") {
      for (const o of orders) {
        const rfq = quote(d, o.material, o.qtyBase);
        o.vendor = rfq.winner;
        o.rfq = rfq.rfqNo;
        o.unitPriceUsdc = rfq.quotes.find((q) => q.vendor === rfq.winner)?.unitPriceUsdc ?? 0;
      }
    }
    const byVendor = new Map<string, typeof orders>();
    for (const o of orders) byVendor.set(o.vendor, [...(byVendor.get(o.vendor) ?? []), o]);
    for (const [vendor, lines] of [...byVendor.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (mode === "kevin") {
        // The monthly limit is the contract's: a PO that would cross it waits for the next month.
        const freight = usdc(config.suppliers[vendor]?.freightUsd ?? 0);
        const total =
          lines.reduce((s, l) => s + extended(l.material, l.qtyBase, l.unitPriceUsdc ?? 0), 0) +
          freight;
        if ((committed.get(month(d)) ?? 0) + total > usdc(plant.kevin.monthlyLimitUsd)) continue;
        for (const l of lines) {
          const rfq = out.rfqs.find((r) => r.rfqNo === l.rfq);
          const q = rfq?.quotes.find((x) => x.vendor === vendor);
          if (q) q.status = "accepted";
        }
        placePo(d, vendor, lines, { rfq: lines[0]?.rfq ?? null });
      } else {
        placePo(d, vendor, lines);
      }
    }
  };

  /** Kevin's RFQ: every supplier on file for the material quotes; the unqualified are excluded. */
  const quote = (d: string, code: string, qtyBase: number): WorldRfq => {
    const yymm = `${d.slice(2, 4)}${d.slice(5, 7)}`;
    const n = (ids.rfq.get(yymm) ?? 0) + 1;
    ids.rfq.set(yymm, n);
    const rfqNo = `${plant.kevin.rfqPrefix}${yymm}-${String(n).padStart(2, "0")}`;
    const r = stream(config.seed, "quotes", rfqNo);
    const quotes: WorldRfq["quotes"] = VENDORS.filter((v) => v.supplies.includes(code)).map((v) => {
      const params = config.suppliers[v.code];
      const excluded = v.qualification === "unqualified" || v.qualification === "suspended";
      const recorded = code === "ASC" ? PRICES.recordedQuote[v.code] : undefined;
      const list = LIST_PRICE[code] ?? 0;
      const price =
        recorded ?? list * (1 + r.between(PRICES.quoteSpread.lo, PRICES.quoteSpread.hi));
      return {
        vendor: v.code,
        unitPriceUsdc: usdc(Math.round(price * 10_000) / 10_000),
        freightUsdc: usdc(params?.freightUsd ?? 0),
        leadDays: Math.round(params?.leadDays.mean ?? 7),
        status: excluded ? "excluded" : "declined",
        reason: excluded ? "vendor not qualified" : null,
      };
    });
    const landed = (q: WorldRfq["quotes"][number]) =>
      extended(code, qtyBase, q.unitPriceUsdc) + q.freightUsdc;
    const open = quotes
      .filter((q) => q.status !== "excluded")
      .sort((a, b) => landed(a) - landed(b) || (a.vendor < b.vendor ? -1 : 1));
    const winner = open[0]?.vendor;
    if (!winner) throw new Error(`world: no qualified supplier quotes ${code}`);
    const rfq: WorldRfq = { rfqNo, material: code, qtyBase, at: at(d, "08:30"), quotes, winner };
    out.rfqs.push(rfq);
    return rfq;
  };

  /** Runs a batch if every draw is there; otherwise returns the short materials. */
  const runBatch = (p: (typeof pending)[number], d: string): string[] => {
    const spec = productSpec(p.run.product);
    const route = ROUTES[p.run.product];
    if (!route) throw new Error(`world: no route for ${p.run.product}`);
    const r = stream(config.seed, "batch", p.run.batchNo);
    const [low, span] = route.yieldBp;
    const yieldBp = low + r.int(0, span);
    const actualUnits = Math.round((spec.batchTablets * yieldBp) / 10_000 / 100) * 100;
    const overLine = r.chance(PRODUCTION.overConsumptionRate)
      ? r.int(0, spec.lines.length - 1)
      : -1;
    const overBy = r.between(PRODUCTION.overConsumption.lo, PRODUCTION.overConsumption.hi);
    const formula = new Set<string>(spec.lines.map(([c]) => c));
    const draws = stdDraws(p.run.product, actualUnits).map(([code, std], i) => {
      if (!formula.has(code)) return { code, std, actual: std };
      const noise = r.normal(0, PRODUCTION.weighNoiseSd) + (i === overLine ? overBy : 0);
      return { code, std, actual: Math.round((std * (1 + noise)) / 1_000) * 1_000 };
    });
    const short = draws
      .filter((x) => usable(x.code, d).reduce((s, l) => s + l.onHand, 0) < x.actual)
      .map((x) => x.code);
    if (short.length > 0) return short;
    const consumption: WorldBatch["consumption"] = [];
    for (const x of draws) {
      let left = x.actual;
      const hhmm = formula.has(x.code) ? "06:30" : "11:00";
      for (const lot of usable(x.code, d)) {
        if (left === 0) break;
        const take = Math.min(left, lot.onHand);
        lot.onHand -= take;
        left -= take;
        out.movements.push([at(d, hhmm), lot.lot, "consumed", -take, `batch:${p.run.batchNo}`]);
        consumption.push({ lot: lot.lot, material: x.code, stdBase: x.std, actualBase: take });
      }
    }
    const issuedMg = draws.filter((x) => formula.has(x.code)).reduce((s, x) => s + x.actual, 0);
    out.batches.push({
      batchNo: p.run.batchNo,
      era,
      product: p.run.product,
      date: d,
      plannedFor: p.date === p.run.plannedFor && !p.slipped ? null : p.run.plannedFor,
      theoreticalUnits: spec.batchTablets,
      actualUnits,
      yieldBp: Math.round((actualUnits * 10_000) / spec.batchTablets),
      wasteBase: issuedMg - actualUnits * spec.tabletWeightMg - QC_SAMPLE_MG,
      consumption,
      overIssued: overLine >= 0 ? [spec.lines[overLine]?.[0] ?? ""] : [],
    });
    if (mode === "kevin") out.chain.push(sim(at(d, "18:00"), "anchor_batch", p.run.batchNo));
    return [];
  };

  /** Stages one transfer's packaging for a sister plant, first lot first; short when it must be. */
  const sendPull = (p: Pull, d: string) => {
    let left = p.qtyBase;
    const when = at(d, "07:00");
    for (const lot of usable(p.material, d)) {
      if (left === 0) break;
      const take = Math.min(left, lot.onHand);
      lot.onHand -= take;
      left -= take;
      out.movements.push([when, lot.lot, "transfer_out", -take, `transfer:${p.transferNo}`]);
      out.transfers.push({
        transferNo: p.transferNo,
        at: when,
        lot: lot.lot,
        material: p.material,
        vendor: lot.vendor,
        poNo: lot.poNo,
        qtyBase: take,
        from: plant.facility,
        to: p.to,
      });
    }
    if (left > 0)
      out.pullShort.push({ transferNo: p.transferNo, material: p.material, shortBase: left });
  };

  /** The legacy incidents placed by date: trial orders, and the bulk lot and its transfer. */
  const incidentOrders = (d: string) => {
    for (const inc of trials) {
      if (inc.type !== "supplier_trial") continue;
      for (const o of inc.orders) {
        if (o.date !== d) continue;
        const po = placePo(d, inc.vendor, [
          { material: inc.material, qtyBase: kg(o.kg), unitPriceUsdc: usdc(inc.priceUsd) },
        ]);
        po.incidents.push(inc.id);
        incidentPo.set(po.poNo, inc.id);
        tag(inc.id, "po", po.poNo);
      }
    }
    for (const inc of bulk) {
      if (inc.type !== "recall_candidate") continue;
      if (inc.date === d) {
        const po = placePo(d, inc.vendor, [{ material: inc.material, qtyBase: kg(inc.kg) }]);
        po.incidents.push(inc.id);
        incidentPo.set(po.poNo, inc.id);
        tag(inc.id, "po", po.poNo);
      }
      if (inc.transfer.date !== d) continue;
      const poNo = out.tagged.find((t) => t.incident === inc.id && t.kind === "po")?.id;
      const lot = lots.find((l) => l.poNo === poNo && !l.rejected && l.onHand > 0);
      if (!lot) throw new Error(`world: ${inc.id} has no lot to send on ${d}`);
      const take = Math.min(lot.onHand, kg(inc.transfer.kg));
      lot.onHand -= take;
      const when = at(d, "07:00");
      const ref = `transfer:${inc.transfer.transferNo}`;
      out.movements.push([when, lot.lot, "transfer_out", -take, ref]);
      out.transfers.push({
        transferNo: inc.transfer.transferNo,
        at: when,
        lot: lot.lot,
        material: lot.material,
        vendor: lot.vendor,
        poNo: lot.poNo,
        qtyBase: take,
        from: plant.facility,
        to: inc.transfer.to,
      });
    }
  };

  // Kevin's era opens with what the recorded run left: quarantined lots and open POs.
  for (const code of input.quarantined ?? []) {
    const lot = lots.find((l) => l.lot === code);
    const day = cal.onOrAfter(from);
    if (lot) {
      lot.releasedOn = day;
      out.qc.push({ lot: code, era, result: "released", at: at(day, "16:00") });
    }
  }
  for (const open of input.openPos ?? []) {
    posByNo.set(open.po.poNo, open.po);
    shipments.push({
      poNo: open.po.poNo,
      arrives: open.arrives,
      promised: open.arrives,
      lines: open.po.lines.map((l) => ({ material: l.material, qtyBase: l.qtyBase })),
      partial: false,
      rush: false,
      replacement: false,
    });
  }

  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!cal.isWorkingDay(d)) continue;
    for (const s of shipments.filter((x) => x.arrives === d && !x.received)) receive(s, d);
    for (const inc of input.incoming ?? []) {
      if (inc.at.slice(0, 10) !== d) continue;
      lots.push({
        lot: inc.lot,
        material: inc.material,
        vendor: inc.vendor,
        poNo: inc.poNo,
        era,
        onHand: inc.qtyBase,
        releasedOn: d,
        rejected: false,
      });
      const ref = `transfer:${inc.transferNo}`;
      out.movements.push([inc.at, inc.lot, "transfer_in", inc.qtyBase, ref]);
    }
    for (const p of pulls) if (p.date === d) sendPull(p, d);
    if (mode === "legacy") incidentOrders(d);
    for (const p of pending.filter((x) => x.date === d)) {
      const short = runBatch(p, d);
      if (short.length === 0) continue;
      out.shortages.push({ batchNo: p.run.batchNo, date: d, materials: short });
      if (!p.slipped) {
        // Rush the shortfall from the alternate source, tested on arrival.
        for (const code of short) {
          const vendor = RUSH.alternate[code] ?? material(code).vendor;
          const need =
            stdDraws(p.run.product, productSpec(p.run.product).batchTablets).find(
              ([c]) => c === code,
            )?.[1] ?? 0;
          const have = usable(code, d).reduce((s, l) => s + l.onHand, 0);
          const qtyBase = packUp(code, need * 1.05 - have);
          if (mode === "kevin") {
            const total =
              extended(code, qtyBase, usdc(LIST_PRICE[code] ?? 0)) + usdc(RUSH.freightUsd);
            if ((committed.get(month(d)) ?? 0) + total > usdc(plant.kevin.monthlyLimitUsd))
              continue;
          }
          placePo(d, vendor, [{ material: code, qtyBase }], { rush: true });
        }
      }
      p.slipped = true;
      p.date = cal.after(d);
      // A legacy batch that cannot run before the books close is not run.
      if (p.date > to && mode !== "legacy")
        throw new Error(`world: ${p.run.batchNo} slipped past ${to}`);
    }
    // What landed today after the morning (a rush ordered on the last day) is received tonight.
    for (const s of shipments.filter((x) => x.arrives === d && !x.received)) receive(s, d);
    if (
      mode === "kevin" ||
      new Date(`${d}T00:00:00.000Z`).getUTCDay() === plant.legacy.reviewWeekday
    )
      review(d);
  }
  if (shipments.some((s) => s.arrives > to && mode === "legacy")) {
    const after = shipments.filter((s) => s.arrives > to).map((s) => `${s.poNo} on ${s.arrives}`);
    throw new Error(`world: a legacy delivery at ${plant.name} arrives after the splice: ${after}`);
  }
  for (const po of out.pos) {
    const bills = out.bills.filter((b) => b.poNo === po.poNo);
    const ordered = po.lines.reduce((s, l) => s + l.extendedUsdc, 0) + po.freightUsdc;
    const paid = bills
      .filter((b) => b.status === "paid" && b.match !== "duplicate")
      .reduce((s, b) => s + b.amountUsdc, 0);
    po.status = cancelled.has(po.poNo)
      ? "cancelled"
      : paid >= ordered
        ? "paid"
        : bills.length > 0
          ? "billed"
          : out.receipts.some((r) => r.poNo === po.poNo)
            ? "received"
            : po.status;
  }
  for (const open of input.openPos ?? []) {
    const paid = out.payments.filter((p) =>
      out.bills.some((b) => b.poNo === open.po.poNo && p.bills.includes(b.billNo)),
    );
    if (paid.length > 0) open.po.status = "paid";
  }
  return out;
}
