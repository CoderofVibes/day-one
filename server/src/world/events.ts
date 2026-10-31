// The worlds as events for the sim clock (docs/UPGRADE_BRIEF.md §1.1, §2.1.10): batches,
// receipts, QC results, payments, shipments, Lakeview's packaging transfers and the named
// incidents of the three plants, in the shape web/src/engine.ts folds (SimEvent), one file a
// month so the browser loads only the months it shows. The clock already carries the seed's own
// history and the recorded run, so the anchor eras are left out, and so is everything inside the
// recorded run's window (T0 to its last day): that stretch replays exactly as recorded.

import { MATERIALS, VENDORS } from "../seed/reference.ts";
import type { World } from "./index.ts";

export type WorldEvent =
  | { kind: "batch"; at: number; id: string; facility: string; units: number }
  | { kind: "received"; at: number; id: string; usdc: number; facility: string }
  | { kind: "paid"; at: number; id: string; usdc: number; facility: string }
  | {
      kind: "qc";
      at: number;
      id: string;
      facility: string;
      lot: string;
      material: string;
      vendor: string;
      released: boolean;
    }
  | {
      kind: "shipment";
      at: number;
      id: string;
      facility: string;
      customer: string;
      units: number;
    }
  | {
      kind: "transfer";
      at: number;
      id: string;
      facility: string;
      to: string;
      lines: number;
    }
  | {
      kind: "incident";
      at: number;
      id: string;
      facility: string;
      type: string;
      title: string;
      records: string[];
    };

export interface WorldEventIndex {
  /** The first and last instant the worlds' events cover, ISO. */
  start: string;
  end: string;
  /** One file a month: its name, its month and how many events it holds. */
  months: { month: string; file: string; events: number }[];
  /** The named incidents, for the scrubber's markers. */
  incidents: { id: string; facility: string; at: string; title: string }[];
}

const ms = (iso: string) => Date.parse(iso);

/** Every world event outside the anchors and the recorded run, in time order. */
export function worldEvents(worlds: readonly World[]): WorldEvent[] {
  const out: WorldEvent[] = [];
  for (const w of worlds) {
    const facility = w.meta.facility;
    const { t0, recordedEnd } = w.meta.calendar;
    const keep = (iso: string) => {
      const d = iso.slice(0, 10);
      return d < t0 || d > recordedEnd;
    };
    const customers = new Map(w.customers.map((c) => [c.code, c.name]));
    const poOf = new Map(w.pos.map((p) => [p.poNo, p]));
    for (const b of w.batches) {
      if (b.era === "anchor" || !keep(b.date)) continue;
      const at = `${b.date}T18:00:00.000Z`;
      out.push({
        kind: "batch",
        at: ms(at),
        id: `batch:${b.batchNo}`,
        facility,
        units: b.actualUnits,
      });
    }
    const received = new Set<string>();
    for (const r of w.receipts) {
      // One event a PO, on its first delivery: the feed names the order, not each part.
      if (r.era === "anchor" || !keep(r.receivedAt) || received.has(r.poNo)) continue;
      received.add(r.poNo);
      const usdc = poOf.get(r.poNo)?.totalUsdc ?? 0;
      out.push({
        kind: "received",
        at: ms(r.receivedAt),
        id: `received:${r.poNo}`,
        usdc,
        facility,
      });
    }
    for (const l of w.lots) {
      if (l.era === "anchor" || !l.qc || l.transferNo || !keep(l.qc.at)) continue;
      out.push({
        kind: "qc",
        at: ms(l.qc.at),
        id: `qc:${l.lot}`,
        facility,
        lot: l.lot,
        material: MATERIALS.find((m) => m.code === l.material)?.name ?? l.material,
        vendor: VENDORS.find((v) => v.code === l.vendor)?.name ?? l.vendor,
        released: l.qc.result === "released",
      });
    }
    const billPo = new Map(w.bills.map((b) => [b.billNo, b.poNo]));
    const paid = new Set<string>();
    for (const p of w.payments) {
      const po = billPo.get(p.bills[0] ?? "") ?? "";
      if (!keep(p.paidAt) || paid.has(po)) continue;
      paid.add(po);
      out.push({ kind: "paid", at: ms(p.paidAt), id: `paid:${po}`, usdc: p.amountUsdc, facility });
    }
    for (const s of w.shipments) {
      if (!keep(s.shippedAt)) continue;
      out.push({
        kind: "shipment",
        at: ms(s.shippedAt),
        id: `shipment:${s.shipmentNo}`,
        facility,
        customer: customers.get(s.customer) ?? s.customer,
        units: s.lines.reduce((t, l) => t + l.units, 0),
      });
    }
    const transfers = new Map<string, { at: string; to: string; lines: number }>();
    for (const t of w.transfers) {
      const x = transfers.get(t.transferNo) ?? { at: t.at, to: t.to, lines: 0 };
      x.lines += 1;
      transfers.set(t.transferNo, x);
    }
    for (const [no, t] of transfers) {
      if (!keep(t.at)) continue;
      out.push({
        kind: "transfer",
        at: ms(t.at),
        id: `transfer:${no}`,
        facility,
        to: t.to,
        lines: t.lines,
      });
    }
    for (const i of w.incidents) {
      if (!keep(i.date)) continue;
      out.push({
        kind: "incident",
        at: ms(`${i.date}T12:00:00.000Z`),
        id: `incident:${i.id}:${facility}`,
        facility,
        type: i.type,
        title: i.title,
        records: [...i.affected.pos, ...i.affected.lots, ...i.affected.batches].slice(0, 6),
      });
    }
  }
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i)
    .map((x) => x.e);
}

/** The month files and the index, as [file name, body] for web/src/data/world/. */
export function worldEventFiles(worlds: readonly World[]): [string, unknown][] {
  const events = worldEvents(worlds);
  const byMonth = new Map<string, WorldEvent[]>();
  for (const e of events) {
    const month = new Date(e.at).toISOString().slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), e]);
  }
  const months = [...byMonth.keys()].sort();
  const index: WorldEventIndex = {
    start: new Date(events[0]?.at ?? 0).toISOString(),
    end: new Date(events.at(-1)?.at ?? 0).toISOString(),
    months: months.map((month) => ({
      month,
      file: `${month}.json`,
      events: byMonth.get(month)?.length ?? 0,
    })),
    incidents: worlds.flatMap((w) =>
      w.incidents.map((i) => ({
        id: i.id,
        facility: w.meta.facility,
        at: `${i.date}T12:00:00.000Z`,
        title: i.title,
      })),
    ),
  };
  return [
    ["index.json", index],
    ...months.map((m): [string, unknown] => [`${m}.json`, byMonth.get(m) ?? []]),
  ];
}
