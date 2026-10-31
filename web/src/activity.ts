// Kevin's activity feed (docs/UPGRADE_BRIEF.md §1.2): what Kevin is doing, in plain plant
// language, as a pure view of the sim clock's event stream (engine.ts). Nothing here is a second
// data source: the seed's batches and settled POs come from their events, the recorded run's
// steps from the recorded staff lines (ids, amounts and wording kept), and the event kinds the
// stream does not carry yet produce no items. First person, numbers with units, no chain words;
// a step's chain lines ride along for the Chain filter behind the curtain.

import { MINUTE_MS, PLANT_UTC_OFFSET_MIN, type SimEvent, simDay } from "./engine.ts";
import { type Approval, audienceOf, type ChainLine, type Step } from "./run.ts";

export type FeedType =
  | "read_record"
  | "inventory_update"
  | "reorder_trigger"
  | "rfq_sent"
  | "quote_received"
  | "po_drafted"
  | "po_refused"
  | "approval_requested"
  | "approval_received"
  | "escrow_funded"
  | "truck_arrived"
  | "qc_released"
  | "paid"
  | "anomaly"
  | "price_drift"
  | "transfer_suggested"
  | "credential_event"
  | "attack_refused"
  | "brief_ready";

/** The filter chips besides All; an item can sit under several. */
export type FeedGroup = "person" | "money" | "quality" | "chain";

export interface FeedItem {
  /** Stable across renders: the event's id, plus the item's place among that event's items. */
  id: string;
  at: number;
  type: FeedType;
  text: string;
  /** Record ids the line names, in order; never empty. */
  records: string[];
  groups: FeedGroup[];
  /** Routine items fold into one "+n routine updates" line when many land together. */
  routine: boolean;
  /** The recorded step this item comes from, when it does. */
  step?: number;
  /** Who Kevin is waiting on; set only while nothing has happened after it. */
  needs?: { who: string; role: string };
  /** The step's chain lines, for the Chain filter (curtain only). */
  chain?: ChainLine[];
}

/** What the recorded steps say, for the step events: the run's own staff lines and approvals. */
export interface FeedContext {
  steps: Pick<Step, "title" | "staff" | "chain">[];
  approvals: Approval[];
  /**
   * Who the run waits on now, when the source knows it (the live API's `next`); left out, it is
   * read from the recorded step after the latest one.
   */
  next?: { who: string; role: string } | null;
}

export const TYPE_LOOK: Record<FeedType, { icon: string; tone: FeedTone }> = {
  read_record: { icon: "doc", tone: "neutral" },
  inventory_update: { icon: "box", tone: "neutral" },
  reorder_trigger: { icon: "bell", tone: "amber" },
  rfq_sent: { icon: "send", tone: "neutral" },
  quote_received: { icon: "inbox", tone: "neutral" },
  po_drafted: { icon: "cart", tone: "neutral" },
  po_refused: { icon: "shield", tone: "red" },
  approval_requested: { icon: "phone", tone: "amber" },
  approval_received: { icon: "check", tone: "green" },
  escrow_funded: { icon: "lock", tone: "gold" },
  truck_arrived: { icon: "truck", tone: "neutral" },
  qc_released: { icon: "flask", tone: "green" },
  paid: { icon: "coin", tone: "gold" },
  anomaly: { icon: "alert", tone: "amber" },
  price_drift: { icon: "trend", tone: "amber" },
  transfer_suggested: { icon: "arrows", tone: "blue" },
  credential_event: { icon: "badge", tone: "cyan" },
  attack_refused: { icon: "shield", tone: "red" },
  brief_ready: { icon: "sun", tone: "gold" },
};
export type FeedTone = "neutral" | "amber" | "red" | "green" | "gold" | "blue" | "cyan";

const PLANT_NAMES: Record<string, string> = {
  A: "Acme Riverside",
  B: "Hollow Pine",
  C: "Acme Lakeview",
};

/** The record ids the app shows: batches, POs, RFQs, lots, adjustments, receipts, invoices. */
const RECORD_ID =
  /\b(?:B[RPC]-[A-Z]-\d{3,}|PO-[A-Z0-9]+(?:-\d+)?|RFQ-[A-Z0-9-]*\d|[A-Z]{3}-\d{6}-\d{2}|ADJ-\d+|IR-\d+|[A-Z]{2}-INV-\d+(?:-R)?)\b/g;

export function recordIds(text: string): string[] {
  return [...new Set(text.match(RECORD_ID) ?? [])];
}

/**
 * Where a record id opens until the shared inspector exists (§5.8): the page that lists it, and
 * the plant its id names. Material codes and lots open stock; batches their records; the rest
 * purchasing.
 */
export function pageForRecord(id: string): {
  page: "batches" | "inventory" | "purchasing" | "invoices";
  plant?: "A" | "B" | "C";
} {
  const plant = /^B[RPC]-([ABC])-/.exec(id)?.[1] as "A" | "B" | "C" | undefined;
  if (plant) return { page: "batches", plant };
  if (/^[A-Z]{3}(-\d{6}-\d{2})?$/.test(id)) return { page: "inventory" };
  if (/-INV-/.test(id)) return { page: "invoices" };
  return { page: "purchasing" };
}

/** USDC base units (6 decimals) as dollars: "$5,150.00". */
export function dollars(usdc: number): string {
  return `$${(usdc / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const MONEY: FeedType[] = ["escrow_funded", "paid", "po_refused", "price_drift", "po_drafted"];
const QUALITY: FeedType[] = ["qc_released", "truck_arrived", "read_record", "anomaly"];

type Draft = Omit<FeedItem, "id" | "at" | "groups" | "records" | "routine"> & {
  records?: string[];
  routine?: boolean;
};

function finish(e: SimEvent, drafts: Draft[]): FeedItem[] {
  return drafts.flatMap((d, i) => {
    const records = d.records ?? recordIds(d.text);
    if (records.length === 0) return [];
    const groups: FeedGroup[] = [];
    if (MONEY.includes(d.type)) groups.push("money");
    if (QUALITY.includes(d.type)) groups.push("quality");
    if (d.chain?.length) groups.push("chain");
    const { records: _r, routine, ...rest } = d;
    return [
      {
        ...rest,
        id: `${e.id}#${i}`,
        at: e.at,
        records,
        groups,
        routine: routine ?? false,
      },
    ];
  });
}

/** "Kevin read X" → "Read X"; "Kevin's limit" → "my limit": the recorded line in his voice. */
function firstPerson(line: string): string {
  const out = line
    .replace(/^Kevin (\w)/, (_, c: string) => c.toUpperCase())
    .replace(/\bKevin's\b/g, "my");
  return out;
}

/** The batch record the run read last, for the step that confirms it ("Ray confirms"). */
function lastUpload(steps: FeedContext["steps"], before: number): string | null {
  for (let i = before - 1; i >= 0; i--) {
    const m = /^Upload (\S+)/.exec(steps[i]?.title ?? "");
    if (m) return m[1] as string;
  }
  return null;
}

function stepDrafts(index: number, ctx: FeedContext): Draft[] {
  const step = ctx.steps[index];
  if (!step) return [];
  const t = step.title;
  const lines = step.staff;
  const text = lines.join(" ");
  const base = { step: index, ...(step.chain.length ? { chain: step.chain } : {}) };
  const verbatim = (type: FeedType): Draft[] =>
    lines.length ? [{ ...base, type, text: firstPerson(text) }] : [];

  if (t === "Load seed" || t === "Summary" || lines.length === 0) return [];
  if (t.startsWith("Upload ")) {
    const read = text.replace(/^Kevin read (\S+)/, "Read batch record $1");
    return [{ ...base, type: "read_record", text: firstPerson(read) }];
  }
  if (t.endsWith(" confirms")) {
    const who = t.replace(/ confirms$/, "");
    const batch = lastUpload(ctx.steps, index);
    const posted = text.replace(/^Inventory updated\.\s*/, "");
    return [
      {
        ...base,
        type: "inventory_update",
        text: batch
          ? `${who} confirmed ${batch}; I posted its consumption. ${posted}`
          : firstPerson(text),
        ...(batch ? { records: [batch] } : {}),
      },
    ];
  }
  if (t === "Discrepancy") return verbatim("anomaly");
  if (t === "Forecast")
    return [{ ...base, type: "reorder_trigger", text: firstPerson(text), records: ["ASC"] }];
  if (t === "Quotes") {
    const rfq = recordIds(step.chain.map((c) => c.line).join(" ")).find((r) =>
      r.startsWith("RFQ-"),
    );
    const n = /^(\d+) quotes?\./.exec(text)?.[1];
    const back = text.replace(/^\d+ quotes?\.\s*/, "");
    if (!rfq) return verbatim("quote_received");
    return [
      ...(n
        ? [{ ...base, type: "rfq_sent" as const, text: `Asked ${n} suppliers for quotes, ${rfq}` }]
        : []),
      {
        type: "quote_received",
        step: index,
        text: `Quotes back on ${rfq}: ${back}`,
        records: [rfq],
      },
    ];
  }
  if (t === "Small PO" || t === "Big PO") {
    const m = /^(PO-\S+) to (.+?), (\$[\d,.]+)(.*)$/.exec(text);
    if (!m) return verbatim(/refused|is over/i.test(text) ? "po_refused" : "escrow_funded");
    const [, po, vendor, amount, rest] = m as unknown as [string, string, string, string, string];
    if (/is over|refused/i.test(rest)) {
      const limit = /(\$[\d,.]+) limit/.exec(rest)?.[1];
      const ask = ctx.approvals.find((a) => a.request.includes(po.replace(/^PO-/, "")));
      const reply = ask && /Reply (.+?)\.?$/.exec(ask.request)?.[1];
      const approver = /Sent to (\w+)/.exec(rest)?.[1];
      return [
        { type: "po_drafted", step: index, text: `Drafted ${po}, ${amount} to ${vendor}` },
        {
          ...base,
          type: "po_refused",
          text: `The spend policy refused ${po}: ${amount} is over my ${limit ?? "per-PO"} limit.${approver ? ` Texted ${approver}.` : ""}`,
          records: [po],
        },
        ...(reply && approver
          ? [
              {
                type: "approval_requested" as const,
                step: index,
                text: `Waiting on ${approver}: ${reply}`,
                records: [po],
              },
            ]
          : []),
      ];
    }
    const how = rest.replace(/^\s*—\s*/, "").replace(/\.$/, "");
    return [
      {
        ...base,
        type: "escrow_funded",
        text: `Sent ${po} to ${vendor}, ${amount}: ${how}.`,
      },
    ];
  }
  if (t.endsWith(" texts")) {
    const m = /^(\w+): (.+?) → (Approved|Declined) by (.+?)\.?$/.exec(text);
    if (!m) return verbatim("approval_requested");
    const [, , reply, verdict, who] = m as unknown as [string, string, string, string, string];
    const po = /\d+/.exec(reply)?.[0];
    const records = po ? [`PO-${po}`] : recordIds(text);
    return [
      {
        ...base,
        type: verdict === "Approved" ? "approval_received" : "po_refused",
        text: `${who} ${verdict.toLowerCase()} ${records[0] ?? "the PO"} by text (${reply})`,
        records,
      },
    ];
  }
  if (t === "Kevin retries") {
    const sent = text.replace(/^(PO-\S+) sent to/, "Sent $1 to");
    return [
      { ...base, type: /Funds held/.test(text) ? "escrow_funded" : "po_refused", text: sent },
    ];
  }
  if (t === "Delivery") return verbatim("truck_arrived");
  if (t === "QC release") return verbatim("qc_released");
  if (t === "QC reject") return verbatim("anomaly");
  if (t === "Paid") {
    const m = /^(PO-\S+) — paid (\$[\d,.]+)\.\s*(.*)$/.exec(text);
    return m
      ? [{ ...base, type: "paid", text: `Paid ${m[2]} for ${m[1]}. ${m[3]}`.trim() }]
      : verbatim("paid");
  }
  return verbatim("anomaly");
}

function eventDrafts(e: SimEvent, ctx: FeedContext | undefined): Draft[] {
  switch (e.kind) {
    case "batch": {
      const batch = e.id.replace(/^batch:/, "");
      const plant = PLANT_NAMES[e.facility] ?? `Plant ${e.facility}`;
      return [
        {
          type: "inventory_update",
          text: `Batch ${batch} finished at ${plant}: ${e.units.toLocaleString("en-US")} tablets`,
          records: [batch],
          routine: true,
        },
      ];
    }
    case "received": {
      const po = e.id.replace(/^received:/, "");
      return [
        {
          type: "truck_arrived",
          text: `Received ${po} at the dock (${dollars(e.usdc)} order)`,
          records: [po],
          routine: true,
        },
      ];
    }
    case "paid": {
      const po = e.id.replace(/^paid:/, "");
      return [
        { type: "paid", text: `Paid ${dollars(e.usdc)} for ${po}`, records: [po], routine: true },
      ];
    }
    case "step":
      return ctx ? stepDrafts(e.step, ctx) : [];
    case "action":
      // People's own clicks: the step they lead to is what Kevin narrates.
      return [];
  }
}

/**
 * The feed through `upTo` (sim ms), oldest first: one pure function of the event stream, so the
 * same seed and range always give the same feed. `context` gives the recorded steps their words;
 * without it step events produce nothing. The last item of the latest step names who Kevin waits
 * on when the run's next step is a person's.
 */
export function eventsToFeed(
  events: readonly SimEvent[],
  upTo: number,
  context?: FeedContext,
): FeedItem[] {
  const out: FeedItem[] = [];
  let lastStep: number | null = null;
  for (const e of events) {
    if (e.at > upTo) break;
    if (e.kind === "step") lastStep = e.step;
    else if (e.kind !== "action") lastStep = null;
    out.push(...finish(e, eventDrafts(e, context)));
  }
  const tail = out.at(-1);
  if (!context || lastStep === null || !tail || tail.step === undefined) return out;
  const who = context.next !== undefined ? context.next : personNext(context.steps, lastStep);
  if (who) {
    out[out.length - 1] = { ...tail, needs: who, groups: ["person", ...tail.groups] };
  }
  return out;
}

/** The recorded steps a person takes: Ray's confirm, Linda's reply, Tommy's slip, Priya's QC. */
function isPersonStep(title: string): boolean {
  return (
    title.endsWith(" confirms") ||
    title.endsWith(" texts") ||
    title === "Delivery" ||
    title.startsWith("QC ")
  );
}

function personNext(steps: FeedContext["steps"], at: number): FeedContext["next"] {
  const next = steps[at + 1];
  if (!next || !isPersonStep(next.title)) return null;
  const who = audienceOf(next as Step);
  return { who: who.name, role: who.role };
}

// ------------------------------------------------------------------ the rail's views

export type FeedFilter = "all" | FeedGroup;

export function filterFeed(items: FeedItem[], filter: FeedFilter): FeedItem[] {
  return filter === "all" ? items : items.filter((i) => i.groups.includes(filter));
}

export type FeedRow =
  | { kind: "item"; item: FeedItem }
  | { kind: "routine"; id: string; items: FeedItem[] };

/**
 * Newest first, with each run of `min` or more routine items in a row on one plant day folded
 * into one line ("+14 routine updates"), unless its id is in `open`. Items that need a person
 * never fold.
 */
export function coalesce(items: FeedItem[], min = 3, open: ReadonlySet<string> = new Set()) {
  const rows: FeedRow[] = [];
  let run: FeedItem[] = [];
  const flush = () => {
    const id = `routine:${run[0]?.id}`;
    if (run.length >= min && !open.has(id)) rows.push({ kind: "routine", id, items: run });
    else for (const item of run) rows.push({ kind: "item", item });
    run = [];
  };
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i] as FeedItem;
    const head = run[0];
    if (head && simDay(head.at) !== simDay(item.at)) flush();
    if (item.routine && !item.needs) run.push(item);
    else {
      flush();
      rows.push({ kind: "item", item });
    }
  }
  flush();
  return rows;
}

/** "6:42 AM" on the clock's day, "Nov 13 · 9:05 AM" on another. */
export function timeLabel(at: number, now: number): string {
  const d = new Date(at + PLANT_UTC_OFFSET_MIN * MINUTE_MS);
  const h = d.getUTCHours();
  const time = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  if (simDay(at) === simDay(now)) return time;
  const month = MONTHS[d.getUTCMonth()];
  return `${month} ${d.getUTCDate()} · ${time}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ------------------------------------------------------------------ Kevin's status

export type KevinState = "idle" | "reading" | "drafting" | "waiting" | "paying" | "signed";
export interface KevinStatus {
  state: KevinState;
  /** "waiting on Linda", "drafting": what the header chip says. */
  label: string;
  /** Kevin is busy right now: the chip's dot pulses. */
  working: boolean;
}

/** How long after his last item Kevin reads as idle, unless he is waiting on someone. */
export const IDLE_AFTER_MS = 30 * MINUTE_MS;

const STATE_OF: Partial<Record<FeedType, KevinState>> = {
  read_record: "reading",
  inventory_update: "reading",
  anomaly: "reading",
  truck_arrived: "reading",
  reorder_trigger: "drafting",
  rfq_sent: "drafting",
  quote_received: "drafting",
  po_drafted: "drafting",
  po_refused: "drafting",
  price_drift: "drafting",
  transfer_suggested: "drafting",
  escrow_funded: "paying",
  paid: "paying",
  approval_received: "signed",
  qc_released: "signed",
};

/** Kevin's status from the latest item at `now`: the header's chip and the rail's top line. */
export function kevinStatus(items: readonly FeedItem[], now: number): KevinStatus {
  const latest = items.at(-1);
  if (latest?.needs) {
    const first = latest.needs.who.split(" ")[0];
    return { state: "waiting", label: `waiting on ${first}`, working: false };
  }
  const state = latest && now - latest.at < IDLE_AFTER_MS ? STATE_OF[latest.type] : undefined;
  if (!state || state === "waiting") return { state: "idle", label: "idle", working: false };
  return { state, label: state, working: state !== "signed" };
}
