// AR and shipments (docs/UPGRADE_BRIEF.md §2.1.3): every batch, anchored or generated, makes one
// finished-goods lot; customers order their share of each week's demand and the dock ships it
// first-in, first-out from released lots, short when the plant is; each shipment is invoiced and
// paid on its customer's terms. The seed has no sales records, so nothing here is anchored: before
// T0 it is legacy, from T0 simulated.

import { addDays, at, type Calendar, dates, type WeeklyDemand, weekday } from "./calendar.ts";
import { CUSTOMERS, SALES, type WorldConfig } from "./config.ts";
import { stream } from "./rng.ts";
import type { Era, ProductCode, WorldBatch } from "./types.ts";

export interface FgLot {
  fgLot: string;
  era: Era;
  product: ProductCode;
  batchNo: string | null;
  madeOn: string;
  units: number;
}

export interface Shipment {
  shipmentNo: string;
  era: Era;
  customer: string;
  shippedAt: string;
  lines: { product: ProductCode; units: number; fgLot: string }[];
  /** Units ordered and not shipped because the plant had none released. */
  shortUnits: number;
}

export interface Invoice {
  invoiceNo: string;
  era: Era;
  customer: string;
  shipmentNo: string;
  invoiceDate: string;
  dueDate: string;
  amountUsdc: number;
  paidAt: string | null;
}

/** [at, fgLot, units shipped (negative) or made (positive), ref] */
export type FgMovement = [at: string, fgLot: string, units: number, ref: string];

export function sales(
  config: WorldConfig,
  cal: Calendar,
  batches: readonly WorldBatch[],
  weeks: readonly WeeklyDemand[],
) {
  const { start, end, t0 } = config.calendar;
  const eraOf = (d: string): Era => (d < t0 ? "legacy" : "simulated");
  const products = config.plant.products.map((p) => p.product);
  const lots: (FgLot & { left: number; releasedOn: string })[] = [];
  const moves: FgMovement[] = [];
  for (const product of products) {
    const weekly = weeks.find(
      (w) => w.product === product && w.week <= start && addDays(w.week, 6) >= start,
    );
    const units = Math.round((weekly?.units ?? 0) * SALES.openingWeeks);
    const fgLot = `FG-${product.slice(2)}-OPENING`;
    lots.push({
      fgLot,
      era: "legacy",
      product,
      batchNo: null,
      madeOn: start,
      units,
      left: units,
      releasedOn: addDays(start, -1),
    });
    moves.push([at(start, "05:00"), fgLot, units, "opening"]);
  }
  for (const b of batches) {
    if (!products.includes(b.product)) continue;
    const fgLot = `FG-${b.batchNo}`;
    lots.push({
      fgLot,
      era: b.era,
      product: b.product,
      batchNo: b.batchNo,
      madeOn: b.date,
      units: b.actualUnits,
      left: b.actualUnits,
      releasedOn: cal.onOrAfter(addDays(b.date, SALES.fgReleaseDays)),
    });
    moves.push([at(b.date, "18:00"), fgLot, b.actualUnits, `batch:${b.batchNo}`]);
  }
  lots.sort((a, b) =>
    a.madeOn < b.madeOn ? -1 : a.madeOn > b.madeOn ? 1 : a.fgLot < b.fgLot ? -1 : 1,
  );

  const shipments: Shipment[] = [];
  const invoices: Invoice[] = [];
  let n = 1;
  for (const d of dates(start, end)) {
    if (weekday(d) !== SALES.shipWeekday) continue;
    const day = cal.onOrAfter(d);
    if (day > end) continue;
    const monday = addDays(d, -3);
    for (const c of CUSTOMERS) {
      const lines: Shipment["lines"] = [];
      let shortUnits = 0;
      let amount = 0;
      for (const product of products) {
        const share = c.share[product];
        if (!share) continue;
        const total = CUSTOMERS.reduce((s, x) => s + (x.share[product] ?? 0), 0);
        const week = weeks.find((w) => w.product === product && w.week === monday);
        const noise = stream(config.seed, "orders", c.code, product, monday).between(0.9, 1.1);
        let want = Math.round(((week?.units ?? 0) * (share / total) * noise) / 1_000) * 1_000;
        for (const lot of lots.filter(
          (l) => l.product === product && l.left > 0 && l.releasedOn < day,
        )) {
          if (want === 0) break;
          const take = Math.min(want, lot.left);
          lot.left -= take;
          want -= take;
          lines.push({ product, units: take, fgLot: lot.fgLot });
          amount += Math.round(take * (SALES.pricePerThousand[product] ?? 0) * 1_000);
        }
        shortUnits += want;
      }
      if (lines.length === 0) continue;
      const shipmentNo = `${config.plant.legacyPrefix}-SH-${String(n).padStart(5, "0")}`;
      const invoiceNo = `${config.plant.legacyPrefix}-INV-${String(n).padStart(5, "0")}`;
      n += 1;
      const shippedAt = at(day, "15:00");
      shipments.push({
        shipmentNo,
        era: eraOf(day),
        customer: c.code,
        shippedAt,
        lines,
        shortUnits,
      });
      for (const l of lines) moves.push([shippedAt, l.fgLot, -l.units, `shipment:${shipmentNo}`]);
      const dueDate = addDays(day, c.termsDays);
      const late = stream(config.seed, "cash", invoiceNo).int(
        SALES.payLateDays.lo,
        SALES.payLateDays.hi,
      );
      const paid = cal.onOrAfter(addDays(dueDate, c.termsDays === 0 ? 0 : late));
      invoices.push({
        invoiceNo,
        era: eraOf(day),
        customer: c.code,
        shipmentNo,
        invoiceDate: day,
        dueDate,
        amountUsdc: amount,
        paidAt: paid <= end ? at(paid, "12:00") : null,
      });
    }
  }
  const fgLots: FgLot[] = lots.map(({ left: _, releasedOn: __, ...l }) => l);
  return {
    customers: CUSTOMERS.map(({ code, name, termsDays }) => ({ code, name, termsDays })),
    fgLots,
    shipments,
    invoices,
    fgMovements: moves.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  };
}
