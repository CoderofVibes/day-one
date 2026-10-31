// What can be selected on the plant map and what the inspector says about it (docs/UPGRADE_BRIEF.md
// §4.7, §4.12): the plants, their departments, Acme HQ, the escrow, the suppliers and their quotes,
// each purchase order, each shipment and each lot, all read from the TwinState the map already
// draws and the run it came from. Pure, so the Objects list, the 3D clicks, ?inspect=<id> and the
// tests share one answer. Staff fields are plain language; transactions are only handed out for
// the curtain.

import type { RunData, Tone, Transaction } from "../run.ts";
import type { PageId } from "../shell.tsx";
import { AREAS, type AreaCode, BUILDING_NAMES } from "./layout.ts";
import { lotLook } from "./lotStates.ts";
import {
  DEPARTMENTS,
  type DeptCode,
  type DeptStatus,
  type FacilityId,
  type Flow,
  formatCents,
  type NodeRef,
  type TwinState,
} from "./model.ts";
import type { Pallet } from "./pallets.ts";

export type TwinObjectKind =
  | "plant"
  | "department"
  | "hq"
  | "escrow"
  | "suppliers"
  | "supplier"
  | "po"
  | "shipment"
  | "lot";

/** What the camera frames for an object (scene.ts objectShot). */
export type Focus =
  | { kind: "plant"; facility: FacilityId }
  | { kind: "dept"; facility: FacilityId; dept: DeptCode }
  | { kind: "pad"; pad: "escrow" | "hq" | "suppliers" }
  | { kind: "depot"; index: number }
  | { kind: "lot"; facility: FacilityId; area: AreaCode }
  | { kind: "flow"; from: NodeRef; to: NodeRef };

export interface TwinObject {
  /** Stable across steps; what ?inspect= takes: "PO-1042", "ASC-261116-01", "escrow", "dept-B-qc_lab". */
  id: string;
  kind: TwinObjectKind;
  /** "Purchase order", "Lot", "Department". */
  type: string;
  /** "PO-1042", "QC Lab". */
  name: string;
  plant?: FacilityId;
  state: { label: string; tone: Tone };
  focus: Focus;
}

export interface InspectorField {
  label: string;
  value: string;
}

export interface InspectorStage {
  label: string;
  state: "done" | "now" | "todo" | "failed";
}

/** Everything the inspector shows; built here for the map, and by any page for its own records. */
export interface InspectorData {
  id: string;
  type: string;
  name: string;
  /** The plant's name, when the object belongs to one. */
  plant?: string;
  state: { label: string; tone: Tone };
  /** One sentence on what this is, in staff words. */
  summary: string;
  fields: InspectorField[];
  /** The object's lifecycle; empty when it has none. */
  timeline: InspectorStage[];
  page?: { id: PageId; label: string };
  /** The recorded transactions that touched it, for the curtain only. */
  chain: Transaction[];
}

const PLANT_NAMES: Record<FacilityId, string> = {
  A: "Acme Riverside",
  B: "Hollow Pine Tablet Co.",
  C: "Acme Lakeview",
};

const PO_RE = /\b(PO-[A-Z0-9-]*\d)\b/;

const DEPT_STATE: Record<DeptStatus, { label: string; tone: Tone }> = {
  online: { label: "on Day One", tone: "paid" },
  onboarding: { label: "coming onto Day One", tone: "waiting" },
  offline: { label: "not on Day One yet", tone: "neutral" },
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function poOf(flow: Flow): string | undefined {
  return PO_RE.exec(flow.label)?.[1];
}

export function supplierObjectId(supplier: string): string {
  return `supplier-${slug(supplier)}`;
}

/** The object a flow belongs to on the map: a coin to its PO, a truck to its shipment. */
export function flowObjectId(flow: Flow): string {
  return flow.kind === "money" ? (poOf(flow) ?? flow.id) : flow.id;
}

/** A PO's money as one state: the newest of its coins decides. */
function poState(flows: Flow[]): { label: string; tone: Tone } {
  if (flows.some((f) => f.id.startsWith("paid-"))) return { label: "paid", tone: "paid" };
  if (flows.some((f) => f.id.startsWith("refund-"))) return { label: "refunded", tone: "refused" };
  if (flows.some((f) => f.status === "held")) return { label: "held in escrow", tone: "held" };
  if (flows.some((f) => f.status === "refused"))
    return { label: "refused, needs approval", tone: "refused" };
  return { label: "open", tone: "neutral" };
}

/** A coin's line in a PO's fields, by what happened to it. */
function moneyLabel(flow: Flow): string {
  if (flow.id.startsWith("paid-")) return "Paid";
  if (flow.id.startsWith("refund-")) return "Refunded";
  return flow.status === "refused" ? "Refused" : "Held";
}

function shipmentState(flow: Flow): { label: string; tone: Tone } {
  if (flow.status === "disputed") return { label: "disputed", tone: "refused" };
  if (flow.status === "arrived") return { label: "delivered", tone: "paid" };
  return { label: "on the road", tone: "waiting" };
}

/** Every object on the map at this state, in the Objects list's order. */
export function twinObjects(state: TwinState, pallets: Pallet[] = []): TwinObject[] {
  const out: TwinObject[] = [];
  for (const f of ["B", "A", "C"] as FacilityId[]) {
    const facility = state.facilities.find((x) => x.id === f);
    if (!facility) continue;
    out.push({
      id: `plant-${f}`,
      kind: "plant",
      type: "Plant",
      name: facility.name,
      plant: f,
      state:
        f === "B"
          ? {
              label: `${facility.online} of ${facility.departments.length} online`,
              tone: facility.online === facility.departments.length ? "paid" : "waiting",
            }
          : { label: "on Acme's systems", tone: "paid" },
      focus: { kind: "plant", facility: f },
    });
    for (const d of facility.departments)
      out.push({
        id: `dept-${f}-${d.code}`,
        kind: "department",
        type: "Department",
        name: d.label,
        plant: f,
        state: f === "B" ? DEPT_STATE[d.status] : { label: "on Acme's systems", tone: "paid" },
        focus: { kind: "dept", facility: f, dept: d.code },
      });
  }
  out.push({
    id: "hq",
    kind: "hq",
    type: "Acme HQ",
    name: "Acme HQ",
    state: { label: "sets the budget", tone: "neutral" },
    focus: { kind: "pad", pad: "hq" },
  });
  out.push({
    id: "escrow",
    kind: "escrow",
    type: "Escrow",
    name: "Escrow",
    state:
      state.escrowHeldCents > 0
        ? { label: `${formatCents(state.escrowHeldCents)} held`, tone: "held" }
        : { label: "nothing held", tone: "neutral" },
    focus: { kind: "pad", pad: "escrow" },
  });
  out.push({
    id: "suppliers",
    kind: "suppliers",
    type: "Suppliers",
    name: "Suppliers",
    state: {
      label: state.quotes.length ? `${state.quotes.length} quotes` : "no quotes yet",
      tone: "neutral",
    },
    focus: { kind: "pad", pad: "suppliers" },
  });
  state.quotes.forEach((q, index) => {
    out.push({
      id: supplierObjectId(q.supplier),
      kind: "supplier",
      type: "Supplier",
      name: q.supplier,
      state:
        q.standing === "selected"
          ? { label: "selected", tone: "paid" }
          : q.standing === "excluded"
            ? { label: "excluded", tone: "refused" }
            : { label: "runner-up", tone: "neutral" },
      focus: { kind: "depot", index },
    });
  });
  const pos = new Map<string, Flow[]>();
  for (const flow of state.flows) {
    const po = poOf(flow);
    if (flow.kind !== "money" || !po) continue;
    pos.set(po, [...(pos.get(po) ?? []), flow]);
  }
  for (const [po, flows] of pos) {
    const last = flows.at(-1) as Flow;
    out.push({
      id: po,
      kind: "po",
      type: "Purchase order",
      name: po,
      plant: last.share?.plant ?? "B",
      state: poState(flows),
      focus: { kind: "flow", from: last.from, to: last.to },
    });
  }
  for (const flow of state.flows) {
    if (flow.kind !== "material") continue;
    out.push({
      id: flow.id,
      kind: "shipment",
      type: flow.from.kind === "suppliers" ? "Delivery" : "Transfer",
      name: flow.short,
      ...(flow.to.kind === "dept" ? { plant: flow.to.facility } : {}),
      state: shipmentState(flow),
      focus: { kind: "flow", from: flow.from, to: flow.to },
    });
  }
  for (const lot of state.lots)
    out.push({
      id: lot.code,
      kind: "lot",
      type: "Lot",
      name: lot.code,
      plant: lot.facility,
      state: lotLook(lot.state),
      focus: { kind: "lot", facility: lot.facility, area: "quarantine" },
    });
  for (const p of pallets) {
    if (p.run) continue;
    out.push({
      id: p.code,
      kind: "lot",
      type: "Lot",
      name: p.code,
      plant: p.facility,
      state: lotLook(p.state),
      focus: { kind: "lot", facility: p.facility, area: p.area },
    });
  }
  return out;
}

export function findObject(
  state: TwinState,
  id: string,
  pallets: Pallet[] = [],
): TwinObject | undefined {
  return twinObjects(state, pallets).find((o) => o.id === id);
}

/** True when an object matches a search: its name, type, id, plant or state, any case. */
export function matchesQuery(o: TwinObject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const plant = o.plant ? PLANT_NAMES[o.plant] : "";
  return [o.name, o.type, o.id, plant, o.state.label].some((s) => s.toLowerCase().includes(q));
}

/**
 * The recorded transactions up to step `upTo` whose chain line, step text, signer or method
 * matches: the same transactions Curtain.tsx lists, filtered to one object.
 */
export function chainFor(run: RunData, upTo: number, match: (text: string) => boolean) {
  const byHash = new Map(run.transactions.map((t) => [t.tx, t]));
  const out: Transaction[] = [];
  for (const step of run.steps.slice(0, upTo + 1)) {
    for (const c of step.chain) {
      const tx = c.tx ? byHash.get(c.tx) : undefined;
      if (!tx || out.includes(tx)) continue;
      if (match(`${c.line} ${step.staff.join(" ")} ${tx.signer} ${tx.method}`)) out.push(tx);
    }
  }
  return out;
}

/** The chain words that mark a department's work, for its transactions behind the curtain. */
const DEPT_CHAIN: Partial<Record<DeptCode, RegExp>> = {
  receiving: /confirm_receipt/,
  qc_lab: /qc_release|qc_reject/,
  purchasing: /submit_po|approve_po|anchor quote/,
  weigh_dispense: /anchor_batch/,
  blending: /anchor_batch/,
  compression: /anchor_batch/,
  accounting: /anchored receipt/,
};

function stages(labels: string[], now: number, failed = false): InspectorStage[] {
  return labels.map((label, i) => ({
    label,
    state: i < now ? "done" : i === now ? (failed ? "failed" : "now") : "todo",
  }));
}

function nodeName(ref: NodeRef): string {
  if (ref.kind === "dept") {
    const dept = DEPARTMENTS.find((d) => d.code === ref.dept)?.label ?? ref.dept;
    return `${dept}, ${PLANT_NAMES[ref.facility]}`;
  }
  return ref.kind === "hq" ? "Acme HQ" : ref.kind === "escrow" ? "Escrow" : "Suppliers";
}

/** The inspector's view of one object at step `upTo` of `run`, or undefined if it is not on the map. */
export function inspectObject(
  state: TwinState,
  run: RunData,
  upTo: number,
  id: string,
  pallets: Pallet[] = [],
): InspectorData | undefined {
  const o = findObject(state, id, pallets);
  if (!o) return undefined;
  const base = {
    id: o.id,
    type: o.type,
    name: o.name,
    ...(o.plant ? { plant: PLANT_NAMES[o.plant] } : {}),
    state: o.state,
  };
  const chain = (re: RegExp) => chainFor(run, upTo, (t) => re.test(t));
  switch (o.kind) {
    case "plant": {
      const f = state.facilities.find((x) => x.id === o.plant);
      const b = o.plant === "B";
      const online = f?.online ?? 0;
      const all = f?.departments.length ?? 0;
      return {
        ...base,
        summary: b
          ? "The plant Acme just bought. Its departments come onto Day One one by one as Kevin first handles their records."
          : "An Acme plant that was on Acme's systems before day one.",
        fields: [
          { label: "Town", value: f?.town ?? "" },
          {
            label: "Departments",
            value: b ? `${online} of ${all} on Day One` : `${all}, all on Acme's systems`,
          },
          ...(f?.alerts.length
            ? [{ label: "Waiting on a person", value: f.alerts.join(" ") }]
            : []),
        ],
        timeline: b
          ? stages(
              ["Acquired", "Departments coming on", "Fully on Day One"],
              online === all ? 3 : 1,
            )
          : [],
        page: { id: "plants", label: "Three plants" },
        chain: chain(new RegExp(`plant-${(o.plant ?? "b").toLowerCase()}\\b`)),
      };
    }
    case "department": {
      const facility = o.plant as FacilityId;
      const code = (o.focus as { dept: DeptCode }).dept;
      const status =
        state.facilities.find((x) => x.id === facility)?.departments.find((d) => d.code === code)
          ?.status ?? "offline";
      const areas = Object.values(AREAS).filter((a) => a.dept === code);
      const buildings = [...new Set(areas.map((a) => BUILDING_NAMES[a.building]))];
      const re = DEPT_CHAIN[code];
      const plantTag = `plant-${facility.toLowerCase()}`;
      return {
        ...base,
        summary:
          facility === "B"
            ? status === "online"
              ? "Kevin handles this department's records."
              : status === "onboarding"
                ? "Kevin has started on this department's records; a person still closes them."
                : "Still on paper; it comes onto Day One the first time Kevin handles its records."
            : "On Acme's systems before day one.",
        fields: [
          { label: "Building", value: buildings.join(", ") },
          { label: "Areas", value: areas.map((a) => a.label).join(", ") },
        ],
        timeline:
          facility === "B"
            ? stages(
                ["Not on Day One", "Coming on", "On Day One"],
                status === "online" ? 3 : status === "onboarding" ? 1 : 0,
              )
            : [],
        page: { id: "map", label: "Plant map" },
        chain: re
          ? chainFor(
              run,
              upTo,
              (t) =>
                re.test(t) &&
                (t.includes(plantTag) || (facility === "B" && !/plant-[ac]\b/.test(t))),
            )
          : [],
      };
    }
    case "hq": {
      const money = state.flows.filter((f) => f.kind === "money");
      const funded = new Set(money.filter((f) => f.status !== "refused").map(poOf)).size;
      const refused = new Set(money.filter((f) => f.status === "refused").map(poOf)).size;
      return {
        ...base,
        summary:
          "Acme HQ sets the budget and Kevin's limits once; a purchase order over a limit is refused until a director approves it.",
        fields: [
          { label: "Orders funded", value: String(funded) },
          { label: "Waiting on approval", value: String(refused) },
        ],
        timeline: [],
        page: { id: "hq", label: "Spending limits" },
        chain: chain(/submit_po|approve_po/),
      };
    }
    case "escrow": {
      const held = state.flows.filter((f) => f.kind === "money" && f.status === "held");
      return {
        ...base,
        summary:
          "Money for an approved purchase order waits here until QC passes the delivery, then goes to the supplier.",
        fields: [
          { label: "Held now", value: formatCents(state.escrowHeldCents) },
          ...(held.length ? [{ label: "For", value: held.map((f) => f.label).join("; ") }] : []),
        ],
        timeline: [],
        page: { id: "purchasing", label: "Purchasing" },
        chain: chain(/escrow|qc_release|qc_reject/),
      };
    }
    case "suppliers":
      return {
        ...base,
        summary: "Where the suppliers' quotes come from and deliveries leave.",
        fields: state.quotes.map((q) => ({
          label: q.supplier,
          value: `${q.price}${q.leadTime ? ` · ${q.leadTime}` : ""} · ${q.standing}`,
        })),
        timeline: [],
        page: { id: "suppliers", label: "Suppliers" },
        chain: chain(/anchor quote/),
      };
    case "supplier": {
      const q = state.quotes.find((x) => x.supplier === o.name);
      const account = q?.chainTx?.signer;
      return {
        ...base,
        summary:
          q?.standing === "excluded"
            ? `Kevin left this quote out: ${q.reason ?? "not qualified"}.`
            : q?.standing === "selected"
              ? "Kevin chose this quote: best price from a qualified supplier."
              : "A qualified quote Kevin kept as the runner-up.",
        fields: [
          { label: "Price", value: q?.price ?? "" },
          ...(q?.leadTime ? [{ label: "Lead time", value: q.leadTime }] : []),
          { label: "Standing", value: q?.standing ?? "" },
          ...(q?.reason ? [{ label: "Why", value: q.reason }] : []),
        ],
        timeline: stages(
          ["Quoted", q?.standing === "excluded" ? "Excluded" : "Compared"],
          q?.standing === "excluded" ? 1 : 2,
          q?.standing === "excluded",
        ),
        page: { id: "suppliers", label: "Suppliers" },
        chain: account ? chainFor(run, upTo, (t) => t.includes(account)) : [],
      };
    }
    case "po": {
      const po = o.id;
      const flows = state.flows.filter((f) => poOf(f) === po);
      const ship = flows.find((f) => f.kind === "material" && f.id === `ship-${po}`);
      const money = flows.filter((f) => f.kind === "money");
      const paid = money.some((f) => f.id.startsWith("paid-") || f.id.startsWith("refund-"));
      const refused = money.length > 0 && money.every((f) => f.status === "refused");
      const now = paid
        ? 6
        : ship?.status === "arrived"
          ? 4
          : ship
            ? 3
            : money.some((f) => f.status === "held")
              ? 2
              : 1;
      return {
        ...base,
        summary: refused
          ? "Over Kevin's limit, so the spending policy refused it; it waits for a director's approval."
          : "A purchase order Kevin placed within the limits HQ set.",
        fields: [
          ...money.map((f) => ({ label: moneyLabel(f), value: f.label.replace(`${po} · `, "") })),
          ...(ship ? [{ label: "Delivery", value: ship.label }] : []),
        ],
        timeline: stages(
          [
            "Submitted",
            refused ? "Needs approval" : "Approved",
            "Held in escrow",
            "Shipped",
            "Received",
            "Paid",
          ],
          refused ? 1 : now,
          refused,
        ),
        page: { id: "purchasing", label: "Purchasing" },
        chain: chain(new RegExp(`\\b${po}\\b`)),
      };
    }
    case "shipment": {
      const flow = state.flows.find((f) => f.id === o.id) as Flow;
      const po = poOf(flow);
      return {
        ...base,
        summary: `${nodeName(flow.from)} to ${nodeName(flow.to)}.`,
        fields: [
          { label: "What", value: flow.label },
          { label: "From", value: nodeName(flow.from) },
          { label: "To", value: nodeName(flow.to) },
        ],
        timeline: stages(
          ["Shipped", flow.status === "disputed" ? "Disputed" : "Delivered"],
          flow.status === "moving" ? 1 : 2,
          flow.status === "disputed",
        ),
        page: { id: "inventory", label: "Inventory & forecast" },
        chain: po
          ? chainFor(run, upTo, (t) => /mark_shipped|confirm_receipt/.test(t) && t.includes(po))
          : [],
      };
    }
    case "lot": {
      const lot = state.lots.find((l) => l.code === o.id);
      const pallet = pallets.find((p) => p.code === o.id);
      const about = pallet
        ? [
            { label: "Material", value: pallet.name },
            ...(pallet.vendor ? [{ label: "Supplier", value: pallet.vendor }] : []),
            ...(pallet.qty ? [{ label: "On hand", value: pallet.qty }] : []),
          ]
        : [];
      if (!lot && pallet) {
        const where = AREAS[pallet.area];
        const stage =
          pallet.state === "quarantine" || pallet.state === "received"
            ? 1
            : pallet.state === "rejected"
              ? 2
              : 3;
        return {
          ...base,
          summary:
            stage === 1
              ? "Received and waiting in quarantine until QC decides."
              : stage === 2
                ? "QC rejected it; it waits to go back to the supplier."
                : "Released by QC and in stock.",
          fields: [
            ...about,
            {
              label: "Where",
              value: `${where.label}, ${BUILDING_NAMES[where.building].toLowerCase()}`,
            },
          ],
          timeline: stages(
            ["Received", "Quarantine", pallet.state === "rejected" ? "Rejected" : "Released"],
            stage,
            stage === 2,
          ),
          page: { id: "inventory", label: "Inventory & forecast" },
          chain: chain(new RegExp(`\\b${o.id}\\b`)),
        };
      }
      const decided = lot?.state !== "quarantine";
      return {
        ...base,
        summary:
          lot?.state === "quarantine"
            ? "Delivered and waiting in the quarantine cage until QC decides."
            : lot?.state === "released"
              ? "QC released it; it can be used, and the supplier has been paid."
              : "QC rejected it; the money went back to the budget.",
        fields: [
          ...about,
          { label: "Where", value: "Quarantine cage, warehouse" },
          { label: "QC", value: o.state.label },
        ],
        timeline: stages(
          ["Received", "Quarantine", lot?.state === "rejected" ? "Rejected" : "Released"],
          lot?.state === "released" ? 3 : decided ? 2 : 1,
          lot?.state === "rejected",
        ),
        page: { id: "inventory", label: "Inventory & forecast" },
        chain: chain(new RegExp(`\\b${o.id}\\b`)),
      };
    }
  }
}
