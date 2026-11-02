// Kevin's desk (the top of the Overview): what he has already handled, and the one decision that
// needs a person now, answered in three plain lines: why you, what you decide, what happens after.
// A pure view of what the screens already hold: the run's recorded staff lines (ids, amounts and
// wording kept), the morning review, the scan folder and the ledger's stock. Nothing is invented:
// a fact the lines do not carry yet is left out, never guessed.

import type { InboxState, NextAction, PlantInventory, ReviewProposal, ReviewState } from "./api.ts";
import type { GroupBuyData } from "./groupBuy.ts";
import type { PoView } from "./reads.ts";
import { longDate, senderOf, staffWords } from "./review.ts";
import type { RunData, Step } from "./run.ts";

// ------------------------------------------------------------------ whose turn it is

/** Who the run waits on next, and for what. */
export type Turn =
  | { kind: "upload"; who: string }
  | { kind: "confirm"; who: string; subject: string | null }
  | { kind: "approve"; who: string }
  | { kind: "receive"; who: string }
  | { kind: "qc"; who: string; subject: string | null }
  | { kind: "supplier"; who: string }
  | { kind: "kevin"; doing: string }
  | { kind: "done" };

/** What Kevin does at each of his own steps, in the words a person on the floor would use. */
const KEVIN_DOING: Record<string, string> = {
  Discrepancy: "checking the stock he just posted against the other plants",
  Forecast: "working out what the next batches will need",
  Quotes: "asking qualified suppliers for quotes",
  "Small PO": "placing the orders that fit inside his limits",
  "Big PO": "placing the orders that fit inside his limits",
  "Kevin retries": "sending the approved order to the supplier",
  Paid: "matching the invoice to the order and the receipt",
  "Load seed": "setting up the plant's records",
};

/** The turn the recorded step at `i` hands to someone; past the last step, the run is done. */
export function turnFromStep(steps: Pick<Step, "title" | "staff">[], i: number): Turn {
  const step = steps[i];
  if (!step || step.title === "Summary" || step.title === "Stopped") return { kind: "done" };
  const t = step.title;
  if (t.startsWith("Upload ")) return { kind: "upload", who: "Ray Delgado" };
  if (t.endsWith(" confirms")) {
    const upload = steps
      .slice(0, i)
      .reverse()
      .find((s) => s.title.startsWith("Upload "));
    return {
      kind: "confirm",
      who: "Ray Delgado",
      subject: upload ? upload.title.replace("Upload ", "") : null,
    };
  }
  if (t.endsWith(" texts")) return { kind: "approve", who: "Linda Park" };
  if (t === "Delivery") return { kind: "receive", who: "Tommy Reyes" };
  if (t === "QC release" || t === "QC reject") {
    const lot = lotOf(steps.slice(0, i));
    return { kind: "qc", who: "Priya Natarajan", subject: lot };
  }
  if (t === "Supplier ships") return { kind: "supplier", who: "the supplier" };
  return { kind: "kevin", doing: KEVIN_DOING[t] ?? t.toLowerCase() };
}

/** The same turn read from the live API's `next`. */
export function turnFromLive(next: NextAction): Turn {
  const who = next.who ?? "";
  switch (next.phase) {
    case "upload":
      return { kind: "upload", who: who || "Ray Delgado" };
    case "confirm":
      return { kind: "confirm", who: who || "Ray Delgado", subject: next.subject };
    case "reply":
      return { kind: "approve", who: who || "Linda Park" };
    case "receive":
      return { kind: "receive", who: who || "Tommy Reyes" };
    case "qc":
      return { kind: "qc", who: who || "Priya Natarajan", subject: next.subject };
    case "done":
    case "finish":
      return { kind: "done" };
    default:
      return { kind: "kevin", doing: next.action.replace(/^Kevin (is )?/i, "").replace(/\.$/, "") };
  }
}

// ------------------------------------------------------------------ facts from the lines

/** What the recorded lines say about the run's purchase, read once; every field may be absent. */
export interface RunFacts {
  material?: string;
  /** Plant B's stock of the material before and after the batch, and its reorder point. */
  stock?: { before: string; after: string; reorder: string };
  forecast?: { needKg: string; shortKg: string; orderKg: string };
  quotes?: { count: number; supplier: string; price: string; days: string; excluded?: string };
  small?: { po: string; supplier: string; amount: string };
  big?: { po: string; supplier: string; amount: string; limit: string };
  approval?: { by: string; answer: "approved" | "declined" };
  funded?: { po: string };
  shipped?: boolean;
  delivery?: { po: string; qty: string; supplierLot: string; lot: string };
  qc?: { lot: string; released: boolean };
  paid?: { po: string; amount: string };
  /** The approval text Kevin sent, as the phone shows it. */
  request?: string;
}

const text = (s: Pick<Step, "staff">) => s.staff.join(" ");

function lotOf(steps: Pick<Step, "title" | "staff">[]): string | null {
  for (const s of [...steps].reverse()) {
    const m = /Lot ([A-Z]{3}-\d{6}-\d{2}) is in quarantine/.exec(text(s));
    if (m) return m[1] ?? null;
  }
  return null;
}

/** The facts the steps up to and including `at` state. */
export function runFacts(run: Pick<RunData, "steps" | "approvals">, at: number): RunFacts {
  const f: RunFacts = {};
  for (const s of run.steps.slice(0, at + 1)) {
    const line = text(s);
    let m: RegExpExecArray | null;
    if (s.title.endsWith(" confirms")) {
      m =
        /([A-Z][a-z]+(?: [a-z]+)*) at Plant [A-Z]: ([\d.,]+ kg) → ([\d.,]+ kg) \(reorder point ([\d.,]+ kg)\)/.exec(
          line,
        );
      if (m) {
        f.material = m[1] as string;
        f.stock = { before: m[2] as string, after: m[3] as string, reorder: m[4] as string };
      }
    } else if (s.title === "Forecast") {
      m = /need about ([\d,]+ kg)\. Short about ([\d,]+ kg)\. Recommend ordering ([\d,]+ kg)/.exec(
        line,
      );
      if (m)
        f.forecast = { needKg: m[1] as string, shortKg: m[2] as string, orderKg: m[3] as string };
    } else if (s.title === "Quotes") {
      const count = Number(/(\d+) quotes/.exec(line)?.[1] ?? 0);
      m = /([A-Z][\w ]*?) \$([\d.]+)\/kg, (\d+) days — selected/.exec(line);
      const excluded = /([A-Z][\w ]*?) \$[\d.]+\/kg excluded/.exec(line)?.[1];
      if (m)
        f.quotes = {
          count,
          supplier: m[1] as string,
          price: `$${m[2]}`,
          days: m[3] as string,
          ...(excluded ? { excluded } : {}),
        };
    } else if (s.title === "Small PO" || s.title === "Big PO") {
      m = /(PO-\d+) to ([^,]+), (\$[\d,]+\.\d\d) is over Kevin's (\$[\d,]+\.\d\d) limit/.exec(line);
      if (m)
        f.big = {
          po: m[1] as string,
          supplier: m[2] as string,
          amount: m[3] as string,
          limit: m[4] as string,
        };
      else {
        m = /(PO-\d+) to ([^,]+), (\$[\d,]+\.\d\d) — approved automatically/.exec(line);
        if (m) f.small = { po: m[1] as string, supplier: m[2] as string, amount: m[3] as string };
      }
    } else if (s.title.endsWith(" texts")) {
      m = /(Approved|Declined) by ([A-Z][a-z]+ [A-Z][a-z]+)/.exec(line);
      if (m)
        f.approval = { by: m[2] as string, answer: m[1] === "Approved" ? "approved" : "declined" };
    } else if (s.title === "Kevin retries") {
      m = /(PO-\d+) sent to .+?Funds held/.exec(line);
      if (m) f.funded = { po: m[1] as string };
    } else if (s.title === "Supplier ships") {
      f.shipped = true;
    } else if (s.title === "Delivery") {
      m =
        /Matches (PO-\d+): ([\d,]+ kg [a-z ]+?), supplier lot ([\w-]+)\. Lot ([A-Z]{3}-\d{6}-\d{2}) is in quarantine/.exec(
          line,
        );
      if (m)
        f.delivery = {
          po: m[1] as string,
          qty: m[2] as string,
          supplierLot: m[3] as string,
          lot: m[4] as string,
        };
    } else if (s.title === "QC release" || s.title === "QC reject") {
      m = /(released|rejected) lot ([A-Z]{3}-\d{6}-\d{2})/.exec(line);
      if (m) f.qc = { lot: m[2] as string, released: m[1] === "released" };
    } else if (s.title === "Paid") {
      m = /(PO-\d+) — paid (\$[\d,]+\.\d\d)/.exec(line);
      if (m) f.paid = { po: m[1] as string, amount: m[2] as string };
    }
  }
  const request = run.approvals[0]?.request;
  if (request && f.big) f.request = request;
  return f;
}

/** The freight in the big order: its total less the quoted price times the kilograms ordered,
 *  so "$5,150.00" for 700 kg at $7.10/kg reads "$180.00"; null when the figures do not give it. */
export function freightOf(f: RunFacts): string | null {
  const num = (s: string | undefined) => Number((s ?? "").replace(/[^\d.]/g, ""));
  const total = num(f.big?.amount);
  const goods = num(f.quotes?.price) * num(f.forecast?.orderKg);
  const cents = Math.round((total - goods) * 100);
  if (!total || !goods || cents <= 0) return null;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/** "700 kg ascorbic acid", from the approval text when the forecast's line does not name it. */
function orderLine(f: RunFacts): string | null {
  const fromRequest = f.request ? /for ([\d,]+ kg [a-z ]+?)\./.exec(f.request)?.[1] : undefined;
  if (fromRequest) return fromRequest;
  if (f.forecast && f.material) return `${f.forecast.orderKg} ${f.material.toLowerCase()}`;
  return null;
}

// ------------------------------------------------------------------ the purchase's track

export type StageState = "done" | "now" | "next" | "stopped";
export interface TrackStage {
  key: "drafted" | "limit" | "funded" | "shipped" | "received" | "qc" | "paid";
  label: string;
  state: StageState;
  /** One short line under the label once the stage has happened. */
  note?: string;
}
export interface PoTrack {
  po: string;
  supplier: string;
  amount: string;
  stages: TrackStage[];
  /** The payment's remaining condition while money is held; met once paid. */
  condition: { text: string; met: boolean } | null;
}

/** What is known about an order, stage by stage, from whichever source holds it. */
interface TrackInput {
  po: string;
  supplier: string;
  amount: string;
  /** The approval stage: over the limit and waiting, approved, declined, or inside the limits. */
  limit: { label: string; note: string; done: boolean; stopped: boolean };
  funded: boolean;
  shipped: boolean;
  received: boolean;
  /** QC's decision: released, rejected (the order stops there), or not yet. */
  qc: "released" | "rejected" | null;
  paid: boolean;
  paidAmount?: string;
  lot?: string;
  /** The payment's condition holds from approval or funding on. */
  conditional: boolean;
}

function buildTrack(t: TrackInput): PoTrack {
  const halted = (t.limit.stopped && t.limit.done) || t.qc === "rejected";
  const raw: [TrackStage["key"], string, boolean, string | undefined, boolean][] = [
    ["drafted", "Drafted", true, t.amount, false],
    ["limit", t.limit.label, t.limit.done, t.limit.note, t.limit.stopped],
    ["funded", "Money set aside", t.funded, t.funded ? "not paid yet" : undefined, false],
    ["shipped", "Shipped", t.shipped, undefined, false],
    ["received", "Received", t.received, t.received && !t.qc ? "in quarantine" : undefined, false],
    [
      "qc",
      t.qc === "rejected" ? "QC rejected" : "QC release",
      t.qc !== null,
      t.qc ? t.lot : undefined,
      t.qc === "rejected",
    ],
    ["paid", "Paid", t.paid, t.paid ? (t.paidAmount ?? t.amount) : undefined, false],
  ];
  let nowSet = false;
  const stages: TrackStage[] = raw.map(([key, label, happened, note, stops]) => {
    let state: StageState;
    if (happened) state = stops ? "stopped" : "done";
    else if (!nowSet && !halted) {
      state = key === "limit" ? "stopped" : "now";
      nowSet = true;
    } else state = "next";
    return { key, label, state, ...(note && (happened || key === "limit") ? { note } : {}) };
  });
  // The payment's condition is set the moment the order is approved, and met when it is paid.
  const condition = t.paid
    ? {
        text: `QC released ${t.lot ?? "the lot"}, so ${t.supplier} was paid ${t.paidAmount ?? t.amount}.`,
        met: true,
      }
    : t.conditional && !halted
      ? {
          text: `Pays ${t.supplier} only, and only when QC releases ${t.lot ? `lot ${t.lot}` : "the delivered lot"}.`,
          met: false,
        }
      : null;
  return { po: t.po, supplier: t.supplier, amount: t.amount, stages, condition };
}

/** The big order's way from draft to paid, as far as the lines go. */
export function poTrack(f: RunFacts): PoTrack | null {
  if (!f.big) return null;
  const { po, supplier, amount, limit } = f.big;
  const approved = f.approval?.answer === "approved";
  const declined = f.approval?.answer === "declined";
  const lot = f.qc?.lot ?? f.delivery?.lot;
  return buildTrack({
    po,
    supplier,
    amount,
    limit: {
      label: approved ? "Approved" : declined ? "Declined" : "Over the limit",
      note: approved ? `by ${f.approval?.by.split(" ")[0]}` : `limit ${limit.replace(".00", "")}`,
      done: approved || declined,
      stopped: declined,
    },
    funded: Boolean(f.funded),
    shipped: Boolean(f.shipped),
    received: Boolean(f.delivery),
    qc: f.qc ? (f.qc.released ? "released" : "rejected") : null,
    paid: Boolean(f.paid),
    ...(f.paid ? { paidAmount: f.paid.amount } : {}),
    ...(lot ? { lot } : {}),
    conditional: approved || Boolean(f.funded),
  });
}

/** The order Kevin placed inside his limits in the run: funded at once, nobody asked. */
export function smallTrack(f: RunFacts): PoTrack | null {
  if (!f.small) return null;
  const { po, supplier, amount } = f.small;
  return buildTrack({
    po,
    supplier,
    amount,
    limit: { label: "Inside limits", note: "no one needed", done: true, stopped: false },
    funded: true,
    shipped: false,
    received: false,
    qc: null,
    paid: false,
    conditional: true,
  });
}

const FUNDED = new Set([
  "authorized",
  "approved",
  "funded",
  "shipped",
  "received",
  "released",
  "paid",
]);

/** Any order from the ledger, as its record stands. */
export function trackFromPo(o: PoView): PoTrack {
  const approved = o.approval?.state === "approved";
  const declined = o.approval?.state === "declined" || o.status === "cancelled";
  const waiting = o.approval !== null && !approved && !declined;
  const first = o.approval?.approver.split(" ")[0] ?? "";
  return buildTrack({
    po: o.poNo,
    supplier: o.vendorName,
    amount: usd(o.totalUsdc),
    limit: o.approval
      ? {
          label: approved ? "Approved" : declined ? "Declined" : "Over the limit",
          note: waiting ? "waits on a director" : `by ${first}`,
          done: !waiting,
          stopped: declined,
        }
      : { label: "Inside limits", note: "no one needed", done: true, stopped: false },
    funded: FUNDED.has(o.status),
    shipped: ["shipped", "received", "released", "paid"].includes(o.status) || o.receipt !== null,
    received: o.receipt !== null,
    qc: o.qc ? (o.qc.decision === "released" ? "released" : "rejected") : null,
    paid: o.status === "paid",
    ...(o.qc?.lot ? { lot: o.qc.lot } : {}),
    conditional: FUNDED.has(o.status) || approved,
  });
}

// ------------------------------------------------------------------ the order desk

/** One order in Purchasing's queue: where it stands, what happens next, and its track. */
export interface OrderRow {
  po: string;
  supplier: string;
  amount: string;
  /** "700 kg ascorbic acid at $7.10/kg", when the ledger has the lines. */
  what: string | null;
  group: "decide" | "flight" | "closed";
  pill: { label: string; tone: "wait" | "held" | "ok" | "stop" };
  /** What happens next, in a line; for a closed order, how it closed. */
  next: string;
  track: PoTrack;
  /** An order of the recorded run, which the twin draws. */
  inRun: boolean;
}

/** Where an order stands, read off its track: its group, pill and next line. */
function standing(t: PoTrack, approver: string): Pick<OrderRow, "group" | "pill" | "next"> {
  const waiting = t.stages.find(
    (s) => s.key === "limit" && s.state === "stopped" && !s.note?.startsWith("by "),
  );
  const ended = t.stages.find((s) => s.state === "stopped" && s !== waiting);
  if (ended)
    return {
      group: "closed",
      pill: { label: ended.key === "qc" ? "rejected" : "declined", tone: "stop" },
      next:
        ended.key === "qc"
          ? "Closed. QC rejected the lot, and the money went back to the plant's budget."
          : `Closed. ${approver} declined it, and nothing was ordered.`,
    };
  if (waiting)
    return {
      group: "flight",
      pill: { label: `needs ${approver}`, tone: "wait" },
      next: `${approver} decides: it is over Kevin's limit.`,
    };
  const now = t.stages.find((s) => s.state === "now");
  switch (now?.key) {
    case undefined:
      return {
        group: "closed",
        pill: { label: "paid", tone: "ok" },
        next: "Paid when QC released the lot. Nothing waits on anyone.",
      };
    case "funded":
      return {
        group: "flight",
        pill: { label: "approved", tone: "held" },
        next: `Kevin sends it to ${t.supplier} and sets the money aside.`,
      };
    case "shipped":
      return {
        group: "flight",
        pill: { label: "money set aside", tone: "held" },
        next: `${t.supplier} ships it. Nothing needs anyone at the plant until the truck arrives.`,
      };
    case "received":
      return {
        group: "flight",
        pill: { label: "on its way", tone: "held" },
        next: "Receiving checks it in at the dock against the packing slip.",
      };
    case "qc":
      return {
        group: "flight",
        pill: { label: "in quarantine", tone: "wait" },
        next: `QC releases or rejects the lot; ${t.supplier} is paid only on release.`,
      };
    default:
      return {
        group: "flight",
        pill: { label: "QC released", tone: "held" },
        next: "Kevin matches the invoice to the order and the receipt, and pays.",
      };
  }
}

/**
 * Purchasing's queue: the run's orders from its recorded lines, then the ledger's other orders up
 * to the clock's day, newest first. An order a person decides on now leads; a few closed ones end
 * the list.
 */
export function orderRows(
  run: Pick<RunData, "steps" | "approvals">,
  at: number,
  orders: PoView[],
  end: string,
  need: Need | null,
  closedShown = 6,
): OrderRow[] {
  const f = runFacts(run, at);
  // Every order the run names: the ledger's copy is the run's end, so it never stands in for them.
  const runPos = new Set(run.steps.flatMap((s) => ids(text(s)).filter((x) => x.startsWith("PO-"))));
  const whatOf = (po: string) => {
    const o = orders.find((x) => x.poNo === po);
    const l = o?.lines[0];
    if (!o || !l) return null;
    const more = o.lines.length > 1 ? `, and ${o.lines.length - 1} more` : "";
    if (l.dimension === "count")
      return `${l.qtyBase.toLocaleString("en-US")} × ${l.name} at ${usd(l.unitPriceUsdc)} each${more}`;
    // "ascorbic acid" in a sentence, but "HPLC" and "4 L" keep their capitals.
    const name = /[A-Z]/.test(l.name.slice(1)) ? l.name : l.name.toLowerCase();
    const qty = (l.qtyBase / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${qty} ${l.unit} ${name} at ${usd(l.unitPriceUsdc)}/${l.unit}${more}`;
  };
  const rows: OrderRow[] = [];
  const add = (track: PoTrack | null, inRun: boolean, approver: string) => {
    if (!track) return;
    const st = standing(track, approver);
    // An order a person decides on now names them, whatever stage it is at.
    if (need?.records.includes(track.po))
      st.pill = { label: `needs ${need.who.split(" ")[0]}`, tone: "wait" };
    rows.push({
      po: track.po,
      supplier: track.supplier,
      amount: track.amount,
      what: whatOf(track.po),
      ...st,
      group: need?.records.includes(track.po) ? "decide" : st.group,
      track,
      inRun,
    });
  };
  add(poTrack(f), true, f.approval?.by.split(" ")[0] ?? "Linda");
  add(smallTrack(f), true, "Linda");
  const history = orders
    .filter((o) => !runPos.has(o.poNo) && o.date && o.date.slice(0, 10) <= end)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  for (const o of history)
    add(trackFromPo(o), false, o.approval?.approver.split(" ")[0] ?? "the director");
  const rank = { decide: 0, flight: 1, closed: 2 };
  let closed = 0;
  return rows
    .sort((a, b) => rank[a.group] - rank[b.group])
    .filter((r) => r.group !== "closed" || closed++ < closedShown);
}

// ------------------------------------------------------------------ what needs a person

/** The three questions a person asks before acting, answered together. */
/**
 * A place on the plant twin: an object id, a department to fall back to when that object is not
 * drawn yet, and the other places the work touches, which the camera frames with it.
 */
export interface Place {
  label: string;
  focus: string;
  fallback: string;
  also?: string[];
}

export interface Need {
  id: string;
  who: string;
  role: string;
  /** How the ask reaches them. */
  channel: "screen" | "phone";
  title: string;
  subtitle: string | null;
  why: string;
  deciding: string;
  after: string;
  /** Where on the plant this happens, and what else the decision touches. */
  where: Place;
  records: string[];
}

const ROLES: Record<string, string> = {
  "Ray Delgado": "Purchaser",
  "Linda Park": "Ops director",
  "Tommy Reyes": "Receiving",
  "Priya Natarajan": "QC",
};

/** A batch record's place: the presses, framed with the line that feeds them. */
const PRESSES: Place = {
  label: "Presses, Hollow Pine",
  focus: "dept-B-compression",
  fallback: "plant-B",
  also: ["dept-B-weigh_dispense", "dept-B-blending"],
};

/** The decision the turn asks for, or null when nobody on the floor is needed. */
export function needOf(
  turn: Turn,
  f: RunFacts,
  run: Pick<RunData, "steps">,
  at: number,
  inbox: InboxState | null = null,
): Need | null {
  const role = (who: string) => ROLES[who] ?? "";
  const scans = inbox?.items.filter((i) => i.status === "waiting" && i.batchNo) ?? [];
  switch (turn.kind) {
    case "upload":
      // Scans already in the folder: Kevin has read them, so the ask is to check what he read.
      if (scans.length > 0) {
        const asks = scans.filter((i) => i.questions > 0);
        return {
          id: "scans",
          who: turn.who,
          role: role(turn.who),
          channel: "screen",
          title: `Check the ${scans.length} batch ${scans.length === 1 ? "record" : "records"} Kevin read`,
          subtitle: "From the scan folder, read overnight",
          why: "Kevin read the scans, but stock changes only when someone who knows the batches says he read them right.",
          deciding: `${scans
            .map(
              (i) =>
                `${i.batchNo}: ${i.questions > 0 ? `${i.questions} ${i.questions === 1 ? "question" : "questions"}` : "ready to confirm"}`,
            )
            .join(
              "; ",
            )}.${asks.length ? " Kevin could not read every line, so he asks rather than guesses." : ""}`,
          after:
            "Each one posts when you confirm it: what the batch used comes off stock, and Kevin checks what needs ordering.",
          where: PRESSES,
          records: scans.map((i) => i.batchNo as string),
        };
      }
      return {
        id: "upload",
        who: turn.who,
        role: role(turn.who),
        channel: "screen",
        title: "Hand Kevin this week's batch record",
        subtitle: "The scan from the binder, or a photo of it",
        why: "Batch records are still on paper at Hollow Pine. Kevin can read a scan, but someone has to give it to him.",
        deciding: "Nothing yet. Drop the scan in the folder or upload a photo.",
        after:
          "Kevin reads every line against the recipe and shows you what he found. Nothing posts until you confirm it.",
        where: PRESSES,
        records: [],
      };
    case "confirm": {
      const batch = turn.subject ?? "the batch record";
      const read = run.steps
        .slice(0, at + 1)
        .reverse()
        .find((s) => s.title === `Upload ${batch}`);
      const found = read ? text(read).replace(/^Kevin read [^.]*?\)\.\s*/, "") : "";
      return {
        id: `confirm-${batch}`,
        who: turn.who,
        role: role(turn.who),
        channel: "screen",
        title: `Confirm batch record ${batch}`,
        subtitle: read ? (/\(([^)]+)\)/.exec(text(read))?.[1] ?? null) : null,
        why: "Kevin read the scan, but stock changes only when someone who knows the batch says he read it right.",
        deciding: found
          ? `Whether Kevin read ${batch} right. ${found}`
          : `Whether Kevin read ${batch} right.`,
        after:
          "Kevin posts the batch. What it used comes off stock, and he checks whether anything needs ordering.",
        where: PRESSES,
        records: [batch],
      };
    }
    case "approve": {
      const big = f.big;
      if (!big) return null;
      const what = orderLine(f);
      const q = f.quotes;
      return {
        id: `approve-${big.po}`,
        who: turn.who,
        role: role(turn.who),
        channel: "phone",
        title: `Approve ${big.po}`,
        subtitle: [what, `from ${big.supplier}`, big.amount].filter(Boolean).join(" · "),
        why: `${big.po} is ${big.amount}, over the ${big.limit.replace(".00", "")} Kevin may spend on one order. The spending rules send it to you, and Kevin cannot go around them.`,
        deciding: q
          ? `Whether to spend ${big.amount} with ${big.supplier} at ${q.price}/kg${freightOf(f) ? ` plus ${freightOf(f)} freight` : ""}, delivered in ${q.days} days. Kevin compared ${q.count} quotes and checked the other plants first.`
          : `Whether to spend ${big.amount} with ${big.supplier}.`,
        after: `Approve, and the money is set aside, not paid: ${big.supplier} is paid only after the delivery passes QC. Decline, and nothing is ordered.`,
        where: {
          label: "Purchasing office, Hollow Pine",
          focus: "dept-B-purchasing",
          fallback: "plant-B",
          also: ["escrow"],
        },
        records: [big.po],
      };
    }
    case "receive": {
      const big = f.big;
      const po = f.funded?.po ?? big?.po;
      const what = orderLine(f);
      return {
        id: `receive-${po ?? "delivery"}`,
        who: turn.who,
        role: role(turn.who),
        channel: "screen",
        title: po ? `Receive ${po} at the dock` : "Receive the delivery at the dock",
        subtitle: [what, big ? `from ${big.supplier}` : null].filter(Boolean).join(" · ") || null,
        why: "Someone has to see the pallets come off the truck. Kevin checks your photo of the packing slip against the order.",
        deciding: `Whether what arrived matches ${po ?? "the order"}${what ? `: ${what}` : ""}.`,
        after: "The lot goes into quarantine until QC tests it. The money stays set aside.",
        where: {
          label: "Receiving dock, Hollow Pine",
          focus: "dept-B-receiving",
          fallback: "plant-B",
          also: ["dept-B-warehouse"],
        },
        records: po ? [po] : [],
      };
    }
    case "qc": {
      const lot = turn.subject ?? f.delivery?.lot ?? null;
      const supplier = f.big?.supplier ?? "the supplier";
      const amount = f.big?.amount;
      return {
        id: `qc-${lot ?? "lot"}`,
        who: turn.who,
        role: role(turn.who),
        channel: "screen",
        title: lot ? `Release or reject lot ${lot}` : "Release or reject the lot",
        subtitle: [f.delivery?.qty, f.delivery?.po].filter(Boolean).join(" · ") || null,
        why: `Only QC can release a lot for use, and ${supplier}'s payment waits on your decision.`,
        deciding: `Whether lot ${lot ?? "the lot"} passes its tests.`,
        after: `Release: ${supplier} is paid${amount ? ` ${amount}` : ""} from the money set aside, and the lot can be used. Reject: the money goes back to the plant's budget.`,
        where: {
          label: "Quarantine, Hollow Pine",
          focus: lot ?? "dept-B-qc_lab",
          fallback: "dept-B-qc_lab",
          also: ["dept-B-qc_lab", "escrow"],
        },
        records: [lot, f.delivery?.po].filter((x): x is string => Boolean(x)),
      };
    }
    default:
      return null;
  }
}

/** The primary button's words for the turn, in the person's terms. */
export function primaryLabel(turn: Turn, f: RunFacts): string {
  switch (turn.kind) {
    case "upload":
      return "Upload the batch record";
    case "confirm":
      return `Confirm ${turn.subject ?? "the batch record"}`;
    case "approve":
      return `Approve ${f.big?.po ?? "the order"}`;
    case "receive":
      return "Photograph the packing slip";
    case "qc":
      return `Release lot ${turn.subject ?? f.delivery?.lot ?? ""}`.trim();
    case "supplier":
      return "Next: the supplier ships";
    case "kevin":
      return "Next: Kevin's turn";
    case "done":
      return "Replay from the start";
  }
}

/** The replay's button on Kevin's own steps and the supplier's, in plain words. */
const NEXT_WORDS: Record<string, string> = {
  Discrepancy: "Next: Kevin checks the stock",
  Forecast: "Next: Kevin forecasts the batches",
  Quotes: "Next: Kevin asks for quotes",
  "Small PO": "Next: Kevin places the orders",
  "Big PO": "Next: Kevin places the orders",
  "Kevin retries": "Next: Kevin sends the order",
  "Supplier ships": "Next: the supplier ships",
  Paid: "Next: Kevin pays the invoice",
  Summary: "See the run's summary",
};
export function nextWords(title: string | undefined): string {
  return (title && NEXT_WORDS[title]) ?? "Next step";
}

/** The way out of a decision, where there is one: decline, reject. */
export function secondaryLabel(turn: Turn, f: RunFacts): string | null {
  if (turn.kind === "approve") return `Decline ${f.big?.po ?? ""}`.trim();
  if (turn.kind === "qc") return "Reject the lot";
  return null;
}

/** A live action's words as the desk shows them: a reply to the text reads as the decision. */
export function friendlyAction(label: string): string {
  const yes = /^YES (\d+)$/i.exec(label.trim());
  if (yes) return `Approve PO-${yes[1]}`;
  const no = /^NO (\d+)$/i.exec(label.trim());
  if (no) return `Decline PO-${no[1]}`;
  return label;
}

// ------------------------------------------------------------------ what Kevin handled

/** Done: finished, nothing waits. Decision: a person decided, Kevin carried it out. Draft:
 * prepared, waits on a signature. Suggestion: a recommendation, nothing done yet. Guard: a
 * request Kevin refused to act on. */
export type HandledKind = "done" | "decision" | "draft" | "suggestion" | "guard";
export interface Handled {
  id: string;
  kind: HandledKind;
  /** The outcome, in a line. */
  title: string;
  /** The recorded words behind it. */
  detail: string[];
  records: string[];
  /** The recorded step it comes from; absent for the mailbox and the scan folder. */
  step?: number;
  /** Who decided, for a decision. */
  who?: string;
  /** Named as "From Northgate", not "Decided by", when they are not on the plant's staff. */
  from?: boolean;
  /** What became of a draft or a suggestion later in the run. */
  outcome?: string;
  where?: Place;
}

const RECORD =
  /\b(?:B[RPC]-[A-Z]-\d{3,}|PO-[A-Z0-9]+(?:-\d+)?|RFQ-[A-Z0-9-]*\d|[A-Z]{3}-\d{6}-\d{2}|TR-[A-Z]-[A-Z]-\d+)\b/g;
const ids = (s: string) => [...new Set(s.match(RECORD) ?? [])];

const PLANT_WORDS: Record<string, string> = { A: "Riverside", B: "Hollow Pine", C: "Lakeview" };

/** One entry per recorded step that changed something for the plant, newest first. */
export function handledFromRun(run: Pick<RunData, "steps" | "approvals">, at: number): Handled[] {
  const f = runFacts(run, at);
  const out: Handled[] = [];
  run.steps.slice(0, at + 1).forEach((s, i) => {
    const line = text(s);
    const base = { id: `step-${i}`, step: i, detail: s.staff, records: ids(line) };
    const t = s.title;
    if (t.startsWith("Upload ")) {
      const batch = t.replace("Upload ", "");
      out.push({
        ...base,
        kind: "done",
        title: `Read batch record ${batch} from the scan`,
        where: PRESSES,
      });
    } else if (t.endsWith(" confirms")) {
      const turn = turnFromStep(run.steps, i);
      const batch = turn.kind === "confirm" ? turn.subject : null;
      out.push({
        ...base,
        kind: "decision",
        who: "Ray Delgado",
        title: `Ray confirmed ${batch ?? "the batch record"}; Kevin posted it to stock`,
        records: [...(batch ? [batch] : []), ...base.records],
      });
    } else if (t === "Discrepancy") {
      const m = /Plant ([A-Z]) still shows ([\d.,]+ kg) of lot ([\w-]+)/.exec(line);
      out.push({
        ...base,
        kind: "draft",
        title: m
          ? `Caught ${m[2]} on ${PLANT_WORDS[m[1] as string] ?? `Plant ${m[1]}`}'s books that left with a transfer; drafted the correction`
          : "Caught a stock difference between plants; drafted the correction",
        outcome: m
          ? `waits on ${PLANT_WORDS[m[1] as string] ?? `Plant ${m[1]}`} to review`
          : "waits on review",
        where: {
          label: "Raw material storage, Hollow Pine",
          focus: "dept-B-warehouse",
          fallback: "plant-B",
        },
      });
    } else if (t === "Forecast") {
      out.push({
        ...base,
        kind: "suggestion",
        title: f.forecast
          ? `${f.material ?? "Stock"} runs short by about ${f.forecast.shortKg} in the next 10 days; order ${f.forecast.orderKg}`
          : "Forecast the next batches' materials",
        ...(f.big ? { outcome: `became ${f.big.po}` } : {}),
      });
    } else if (t === "Quotes") {
      out.push({
        ...base,
        kind: "done",
        title: f.quotes
          ? `Compared ${f.quotes.count} quotes and picked ${f.quotes.supplier} at ${f.quotes.price}/kg${f.quotes.excluded ? `; left out ${f.quotes.excluded}, not qualified` : ""}`
          : "Compared the quotes",
      });
    } else if (t === "Small PO" || t === "Big PO") {
      const over = /is over Kevin's/.exec(line);
      const m = /(PO-\d+) to ([^,]+), (\$[\d,]+\.\d\d)/.exec(line);
      if (!m) return;
      if (over) {
        out.push({
          ...base,
          kind: "draft",
          title: `Prepared ${m[1]} to ${m[2]}, ${m[3]}: over his limit, so he asked Linda`,
          ...(f.approval
            ? {
                outcome:
                  f.approval.answer === "approved"
                    ? `approved by ${f.approval.by.split(" ")[0]}`
                    : `declined by ${f.approval.by.split(" ")[0]}`,
              }
            : { outcome: "waits on Linda" }),
          where: {
            label: "Purchasing office, Hollow Pine",
            focus: "dept-B-purchasing",
            fallback: "plant-B",
            also: ["escrow"],
          },
        });
      } else {
        out.push({
          ...base,
          kind: "done",
          title: `Placed ${m[1]} with ${m[2]}, ${m[3]}: inside his limits, nobody needed`,
        });
      }
    } else if (t.endsWith(" texts")) {
      const ok = /Approved by/.test(line);
      const no = /Declined by/.test(line);
      out.push({
        ...base,
        kind: "decision",
        who: "Linda Park",
        title: ok
          ? `Linda approved ${f.big?.po ?? "the order"} by text`
          : no
            ? `Linda declined ${f.big?.po ?? "the order"} by text`
            : "Linda's reply could not be read; Kevin asked again",
      });
    } else if (t === "Kevin retries") {
      const funded = /Funds held/.test(line);
      out.push({
        ...base,
        kind: "done",
        title: funded
          ? `Sent ${f.big?.po ?? "the order"} to ${f.big?.supplier ?? "the supplier"}; ${f.big?.amount ?? "the money"} set aside until QC releases the lot`
          : `Could not send ${f.big?.po ?? "the order"}`,
        where: {
          label: "Escrow, Acme",
          focus: "escrow",
          fallback: "hq",
          also: ["dept-B-purchasing"],
        },
      });
    } else if (t === "Supplier ships") {
      out.push({
        ...base,
        kind: "decision",
        who: f.big?.supplier ?? "The supplier",
        from: true,
        title: `${f.big?.supplier ?? "The supplier"} accepted and shipped ${f.big?.po ?? "the order"}`,
        detail: [],
        records: f.big ? [f.big.po] : [],
      });
    } else if (t === "Delivery") {
      out.push({
        ...base,
        kind: "done",
        title: f.delivery
          ? `Matched Tommy's packing slip to ${f.delivery.po}; lot ${f.delivery.lot} into quarantine`
          : "Checked the packing slip against the order",
        where: {
          label: "Receiving dock, Hollow Pine",
          focus: "dept-B-receiving",
          fallback: "plant-B",
          also: ["dept-B-warehouse"],
        },
      });
    } else if (t === "QC release" || t === "QC reject") {
      const released = t === "QC release";
      out.push({
        ...base,
        kind: "decision",
        who: "Priya Natarajan",
        title: `Priya ${released ? "released" : "rejected"} lot ${f.qc?.lot ?? ""}`.trim(),
        where: {
          label: "QC lab, Hollow Pine",
          focus: "dept-B-qc_lab",
          fallback: "plant-B",
          also: [f.qc?.lot, released ? "escrow" : null].filter((x): x is string => Boolean(x)),
        },
      });
    } else if (t === "Paid") {
      out.push({
        ...base,
        kind: "done",
        title: f.paid
          ? `Matched the invoice to ${f.paid.po} and its receipt; ${f.big?.supplier ?? "the supplier"} paid ${f.paid.amount}`
          : "Matched the invoice and paid",
        where: {
          label: "Accounting, Hollow Pine",
          focus: "dept-B-accounting",
          fallback: "plant-B",
          also: ["escrow"],
        },
      });
    }
  });
  return out.reverse();
}

/** The morning review's work: what needed nothing, what Kevin held, what he drafted. */
export function handledFromReview(review: ReviewState | null): Handled[] {
  if (!review) return [];
  const out: Handled[] = [];
  const quiet = review.proposals.filter((p) => p.decision === "none");
  out.push({
    id: "mail-read",
    kind: "done",
    title: `Read ${review.proposals.length} messages since Friday; ${quiet.length} needed nothing from anyone`,
    detail: quiet.map((p) => `${p.subject} (${senderOf(p.from)})`),
    records: [],
  });
  for (const p of review.proposals.filter((x) => x.decision === "refused")) {
    out.push({
      id: `mail-${p.messageId}`,
      kind: "guard",
      title: `Held an email asking to pay ${senderOf(p.from)} at a new account; changed nothing`,
      // Staff words: an account the email named stays behind the curtain.
      detail: [staffWords(p.kevin, false)],
      records: [],
    });
  }
  for (const p of review.proposals.filter((x) => x.decision === "sign")) {
    const drafted = draftTitle(p);
    out.push({
      id: `mail-${p.messageId}`,
      kind: p.signed ? "decision" : "draft",
      ...(p.signed
        ? { who: p.signed.by }
        : { outcome: `waits on ${review.for.split(" ")[0]}'s signature` }),
      title: p.signed ? `${p.signed.by.split(" ")[0]} signed: ${p.signed.outcome}` : drafted,
      detail: [staffWords(p.kevin, false)],
      records: ids(drafted),
    });
  }
  return out;
}

/** What a draft from the mail would change, as an outcome. */
function draftTitle(p: ReviewProposal): string {
  const who = senderOf(p.from);
  const a = p.action;
  if (!a) return `Drafted a reply to ${who}`;
  switch (a.type) {
    case "move_batch":
      return `Drafted moving ${a.batchNo} to ${longDate(a.plannedFor)}, as ${who.split(" ")[0]} asked; every material is on hand`;
    case "resize_batch":
      return `Drafted ${a.batchNo} at ${a.batchTablets.toLocaleString("en-US")} tablets, from the ${who.replace(/ \(.*\)$/, "").toLowerCase()}`;
    case "vendor_note":
      return `Drafted a note on ${who.endsWith("s") ? `${who}'` : `${who}'s`} card: ${a.note.replace(/^\d{4}-\d\d-\d\d:\s*/, "").replace(/\s*\(.*\)\.?$/, "")}`;
  }
}

/** The scan folder: what Kevin read and what he set aside, in the live run. */
export function handledFromInbox(inbox: InboxState | null): Handled[] {
  if (!inbox) return [];
  return inbox.items
    .filter((i) => i.status === "set_aside")
    .map((i) => ({
      id: `scan-${i.file}`,
      kind: "guard" as const,
      title: `Set aside ${i.file.replace(/^.*[/\\]/, "")}: not a batch record, kept out of the ledger`,
      detail: [i.summary],
      records: [],
    }));
}

/** Smaller asks that wait beside the main one: drafts to sign, scans to confirm, reviews elsewhere. */
export interface Waiting {
  id: string;
  who: string;
  text: string;
}
export function waitingBeside(
  review: ReviewState | null,
  inbox: InboxState | null,
  inventory: PlantInventory | null,
  turn: Turn,
): Waiting[] {
  const out: Waiting[] = [];
  const unsigned = review?.proposals.filter((p) => p.decision === "sign" && !p.signed).length ?? 0;
  if (unsigned > 0)
    out.push({
      id: "drafts",
      who: review?.for ?? "Ray Delgado",
      text: `${unsigned} ${unsigned === 1 ? "draft" : "drafts"} from the mail to sign`,
    });
  const scans = inbox?.items.filter((i) => i.status === "waiting").length ?? 0;
  if (scans > 0 && turn.kind !== "upload")
    out.push({
      id: "scans",
      who: "Ray Delgado",
      text: `${scans} scanned ${scans === 1 ? "record" : "records"} to confirm`,
    });
  for (const d of inventory?.discrepancies ?? []) {
    if (d.status !== "proposed_adjustment" && d.status !== "open") continue;
    out.push({
      id: `disc-${d.id}`,
      who: PLANT_WORDS[d.facility] ?? `Plant ${d.facility}`,
      text: `review the ${d.lotCode ?? "stock"} correction Kevin drafted`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ before we buy

export interface SourcingOption {
  key: "transfer" | "alone" | "together";
  label: string;
  verdict: "no" | "yes" | "worth asking";
  reason: string;
  /** Plant by plant, for the transfer: why each one can or cannot spare stock. */
  plants?: { plant: string; line: string }[];
}
export interface SourcingCheck {
  material: string;
  question: string;
  options: SourcingOption[];
}

const KG = 1_000_000;
const kg = (base: number) =>
  `${(Math.round((base / KG) * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
const usd = (micro: number) =>
  `$${(micro / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * "Before we buy it, do we already own it somewhere else?" for the run's purchase: each other
 * plant's stock of the material against its own reorder point (and any correction pending on
 * it), the order Kevin placed, and what pooling with a plant that is short too got Acme in the
 * recorded group purchase. Null until the run has a material and a forecast.
 */
export function sourcingCheck(
  f: RunFacts,
  inventory: PlantInventory | null,
  group: Pick<GroupBuyData, "pool" | "po"> | null,
  plant = "B",
): SourcingCheck | null {
  if (!f.material || !f.forecast || !inventory) return null;
  const name = f.material;
  const stock = inventory.materials.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!stock) return null;
  const names = new Map(inventory.facilities.map((x) => [x.code, PLANT_WORDS[x.code] ?? x.name]));
  const reorder = stock.reorderPointBase ?? 0;
  const lines: { plant: string; line: string; spare: number }[] = [];
  for (const fac of inventory.facilities) {
    if (fac.code === plant) continue;
    const held = stock.byPlant[fac.code];
    const who = names.get(fac.code) ?? fac.code;
    if (!held || held.onHandBase === 0) {
      lines.push({ plant: who, line: `${who} does not stock ${name.toLowerCase()}.`, spare: 0 });
      continue;
    }
    const pending = inventory.discrepancies.find(
      (d) =>
        d.facility === fac.code &&
        d.material === stock.code &&
        (d.status === "proposed_adjustment" || d.status === "open") &&
        d.proposed &&
        d.proposed.qtyDeltaBase < 0,
    );
    if (pending?.proposed && -pending.proposed.qtyDeltaBase >= held.usableBase) {
      lines.push({
        plant: who,
        line: `${who}'s ${kg(held.usableBase)} is on the books only: it left with transfer ${pending.transferNo ?? ""} and Hollow Pine already weighed it in. Kevin drafted that correction.`.replace(
          "transfer  and",
          "a transfer and",
        ),
        spare: 0,
      });
      continue;
    }
    const spare = held.usableBase - reorder;
    lines.push({
      plant: who,
      line:
        spare > 0
          ? `${who} holds ${kg(held.usableBase)}, ${kg(spare)} above its reorder point of ${kg(reorder)}.`
          : `${who} holds ${kg(held.usableBase)}, below its own reorder point of ${kg(reorder)}: it needs what it has.`,
      spare: Math.max(0, spare),
    });
  }
  const short = Number(f.forecast.shortKg.replace(/[^\d.]/g, "")) * KG;
  const spare = lines.reduce((s, l) => s + l.spare, 0);
  const transfer: SourcingOption = {
    key: "transfer",
    label: "Move it from another plant",
    verdict: spare >= short && short > 0 ? "yes" : "no",
    reason:
      spare >= short && short > 0
        ? `Another plant can spare ${kg(spare)}, enough to cover the ${f.forecast.shortKg} short.`
        : spare > 0
          ? `The other plants can spare ${kg(spare)}, less than the ${f.forecast.shortKg} short.`
          : `No plant has ${name.toLowerCase()} to spare above its own reorder point.`,
    plants: lines.map(({ plant: p, line }) => ({ plant: p, line })),
  };
  const q = f.quotes;
  const alone: SourcingOption = {
    key: "alone",
    label: "Buy it for Hollow Pine",
    verdict: "yes",
    reason: q
      ? `${q.supplier}, ${f.forecast.orderKg} at ${q.price}/kg${f.big ? `, ${f.big.amount} with freight` : ""}, in ${q.days} days: the cheapest qualified quote of ${q.count}.`
      : `Order ${f.forecast.orderKg}.`,
  };
  const options = [transfer, alone];
  const alsoShort = inventory.facilities
    .filter((x) => x.code !== plant && stock.byPlant[x.code]?.low)
    .map((x) => names.get(x.code) ?? x.code);
  if (group?.po && group.pool.material === stock.code && alsoShort.length > 0 && q) {
    const pooled = group.pool.shares.length;
    options.push({
      key: "together",
      label: `Buy together with ${alsoShort.join(" and ")}`,
      verdict: "worth asking",
      reason: `${alsoShort.join(" and ")} ${alsoShort.length === 1 ? "is" : "are"} below the reorder point too. When ${pooled} plants pooled ${kg(group.pool.qtyBase)} in Acme's recorded group purchase (${group.po.poNo}), ${group.po.vendor} quoted ${usd(group.po.unitPriceUsdc)}/kg instead of ${q.price}: ${usd(group.po.savingsUsdc)} less across the plants. A pooled order needs each plant's director to approve its share.`,
    });
  }
  return {
    material: name,
    question: `Before buying ${name.toLowerCase()}: does Acme already own it?`,
    options,
  };
}
