// What each of a plant's twenty areas holds and did (docs/VISION.md §6.5.1, §6.5.3): the sheet the
// plant map opens when an area is clicked. Lot events carry no area, so each event is placed by
// what it is: receipts at receiving, QC holds and decisions in quarantine and the lab, issues to a
// batch in the dispensary and the weigh cells, packaging components on the line that uses them,
// transfers out at shipping. Pure reads of the ledger at the run's clock, in staff words.

import { asc, eq } from "drizzle-orm";
import { EQUIPMENT } from "../seed/equipment.ts";
import type { LedgerDb } from "./events.ts";
import {
  batchRecords,
  DEPARTMENTS,
  facilities,
  lotEvents,
  lots,
  materials,
  productionPlan,
  products,
} from "./schema.ts";
import { batchRecordViews, type LotView, lotViews, purchaseOrderViews } from "./views.ts";

export type AreaCode = (typeof DEPARTMENTS)[number];

export interface AreaEvent {
  at: string;
  text: string;
}
export interface AreaView {
  area: AreaCode;
  /** One plain line: what is in the area or what it last did. */
  sentence: string;
  lots: LotView[];
  /** The five latest things that happened there, newest first. */
  events: AreaEvent[];
  /** The batch last made or packed there, or the next one planned (planning). */
  batch: { batchNo: string; product: string; at: string } | null;
  equipment: {
    id: string;
    name: string;
    status: "running" | "idle" | "attention";
    batch: string | null;
  }[];
}

const DAY = 86_400_000;

/** The line a packaging component is used on, by what it is. */
function packagingArea(name: string): AreaCode {
  const n = name.toLowerCase();
  if (n.includes("label")) return "labeling";
  if (n.includes("carton")) return "cartoning";
  if (n.includes("shipper")) return "palletizing";
  if (n.includes("canister") || n.includes("scoop")) return "powder_fill";
  return "bottling";
}

function qty(base: number, dimension: string) {
  if (dimension !== "mass") return Math.abs(base).toLocaleString("en-US");
  const kg = Math.abs(base) / 1_000_000;
  return `${kg.toLocaleString("en-US", { maximumFractionDigits: kg >= 100 ? 0 : 1 })} kg`;
}
function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const WORD: Record<string, string> = {
  ordered: "ordered",
  shipped: "shipped by the supplier",
  received: "received",
  quarantined: "held for QC",
  released: "released by QC",
  rejected: "rejected by QC",
  issued: "issued to",
  returned: "returned from",
  consumed: "used in",
  wasted: "written off as waste in",
  transfer_out: "sent to another plant",
  transfer_in: "received from another plant",
  count_adjust: "count adjusted",
};

/** Every area of a plant at `now`. */
export function areaViews(db: LedgerDb, facility: string, now: string): Record<AreaCode, AreaView> {
  const plant = db.select().from(facilities).where(eq(facilities.code, facility)).get();
  if (!plant) throw new Error(`no plant ${facility}`);
  const events = new Map<AreaCode, AreaEvent[]>();
  const add = (area: AreaCode, e: AreaEvent) => events.set(area, [...(events.get(area) ?? []), e]);
  const rows = db
    .select({
      kind: lotEvents.kind,
      at: lotEvents.occurredAt,
      delta: lotEvents.qtyDeltaBase,
      reason: lotEvents.reason,
      refType: lotEvents.refType,
      refId: lotEvents.refId,
      lot: lots.lotCode,
      name: materials.name,
      category: materials.category,
      dimension: materials.dimension,
    })
    .from(lotEvents)
    .innerJoin(lots, eq(lots.id, lotEvents.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(eq(lotEvents.facilityId, plant.id))
    .orderBy(asc(lotEvents.seq))
    .all();
  const batchNos = new Map(
    db
      .select({ id: batchRecords.id, batchNo: batchRecords.batchNo })
      .from(batchRecords)
      .all()
      .map((b) => [b.id, b.batchNo]),
  );
  for (const r of rows) {
    if (r.at > now) continue;
    // The batch: the event's reference, or "Packaging run for BR-B-1040" in its reason.
    const batch =
      (r.refType === "batch" && r.refId !== null ? batchNos.get(r.refId) : undefined) ??
      /\b(B[RCP]-[ABC]-\d+)/.exec(r.reason ?? "")?.[1] ??
      "";
    const amount = r.delta ? ` (${r.delta > 0 ? "+" : "−"}${qty(r.delta, r.dimension)})` : "";
    // A name reads mid-sentence ("magnesium stearate"); codes in it keep their capitals.
    const name = r.name.charAt(0).toLowerCase() + r.name.slice(1);
    const text = `${day(r.at)}: ${r.lot}, ${name}, ${WORD[r.kind] ?? r.kind}${
      ["issued", "returned", "consumed", "wasted"].includes(r.kind)
        ? ` ${batch || "production"}`
        : ""
    }${amount}.`;
    const e = { at: r.at, text };
    const pack = r.category === "packaging";
    switch (r.kind) {
      case "ordered":
        add("purchasing", e);
        break;
      case "received":
      case "transfer_in":
      case "shipped":
        add("receiving", e);
        break;
      case "quarantined":
        add("quarantine", e);
        break;
      case "released":
      case "rejected":
        add("quarantine", e);
        add("qc_lab", e);
        break;
      case "issued":
        if (pack) add(packagingArea(r.name), e);
        else {
          add("rm_staging", e);
          add("weigh_cells", e);
        }
        break;
      case "consumed":
        if (pack) add(packagingArea(r.name), e);
        else add("formulation", e);
        break;
      case "returned":
      case "count_adjust":
        add(pack ? "pkg_storage" : "rm_storage", e);
        break;
      case "wasted":
        add("bulk_hold", e);
        break;
      case "transfer_out":
        add("shipping", e);
        break;
    }
  }

  const live = lotViews(db, facility, now);
  const stock = (pack: boolean) =>
    live.filter(
      (l) => ["released", "in_use"].includes(l.state) && (l.category === "packaging") === pack,
    );
  const held = live.filter((l) => l.state === "quarantine");
  const expected = live.filter((l) => ["on_order", "en_route", "received"].includes(l.state));
  const batches = batchRecordViews(db, facility);
  const latest = (prefix?: string) => batches.find((b) => !prefix || b.batchNo.startsWith(prefix));
  const asBatch = (b: ReturnType<typeof latest>) =>
    b ? { batchNo: b.batchNo, product: b.productName, at: b.completedAt ?? "" } : null;
  const next = db
    .select({
      batchNo: productionPlan.batchNo,
      product: products.name,
      at: productionPlan.plannedFor,
    })
    .from(productionPlan)
    .innerJoin(products, eq(products.id, productionPlan.productId))
    .where(eq(productionPlan.facilityId, plant.id))
    .orderBy(asc(productionPlan.plannedFor))
    .all()
    .find((p) => p.at >= now.slice(0, 10));
  const orders = purchaseOrderViews(db, facility);
  const open = orders.filter((o) => !["paid", "cancelled", "rejected"].includes(o.status));

  const out = {} as Record<AreaCode, AreaView>;
  for (const area of DEPARTMENTS) {
    const ev = (events.get(area) ?? []).slice(-5).reverse();
    let areaLots: LotView[] = [];
    let batch: AreaView["batch"] = null;
    let sentence = "";
    switch (area) {
      case "receiving":
        areaLots = expected;
        sentence = expected.length
          ? `${expected.length} lot${expected.length === 1 ? "" : "s"} expected or at the dock.`
          : "Nothing waiting at the dock.";
        break;
      case "quarantine":
      case "qc_lab": {
        areaLots = held;
        const oldest = Math.max(0, ...held.map((l) => l.daysInState));
        sentence = held.length
          ? `${held.length} lot${held.length === 1 ? "" : "s"} waiting on QC, the oldest ${oldest} day${oldest === 1 ? "" : "s"}.`
          : "Nothing waiting on QC.";
        break;
      }
      case "rm_storage":
      case "pkg_storage": {
        areaLots = stock(area === "pkg_storage");
        sentence = `${areaLots.length} lots on the racks.`;
        break;
      }
      case "fg_storage":
      case "shipping":
        sentence = ev.length ? "Finished pallets go out from here." : "No pallets moved recently.";
        break;
      case "rm_staging":
      case "weigh_cells":
      case "formulation":
      case "bulk_hold":
        batch = asBatch(latest());
        break;
      case "tableting":
        batch = asBatch(batches.find((b) => !b.batchNo.startsWith("BP-")));
        break;
      case "powder_fill":
        batch = asBatch(latest("BP-"));
        break;
      case "planning":
        batch = next ? { batchNo: next.batchNo, product: next.product, at: next.at } : null;
        sentence = next
          ? `Next on the schedule: ${next.batchNo}, ${next.product}, ${day(next.at)}.`
          : "Nothing planned.";
        break;
      case "purchasing":
        sentence = `${open.length} purchase order${open.length === 1 ? "" : "s"} open.`;
        break;
      case "accounting":
        sentence = `${orders.filter((o) => o.status === "paid").length} purchase orders settled.`;
        break;
    }
    if (!sentence && batch)
      sentence = `Last batch ${batch.batchNo}, ${batch.product}, ${day(batch.at)}.`;
    if (!sentence) sentence = ev[0] ? `Last: ${ev[0].text}` : "Nothing recorded here yet.";
    // Running when the area did something in the last day; attention when a lot waits on QC.
    const recent = ev.some((e) => Date.parse(now) - Date.parse(e.at) < DAY);
    const attention = (area === "quarantine" || area === "qc_lab") && held.length > 0;
    out[area] = {
      area,
      sentence,
      lots: areaLots.slice(0, 8),
      events: ev,
      batch,
      equipment: EQUIPMENT[area].map((q, i) => ({
        ...q,
        status: attention ? "attention" : recent && i === 0 ? "running" : "idle",
        batch: recent && i === 0 && batch && area !== "planning" ? batch.batchNo : null,
      })),
    };
  }
  return out;
}
