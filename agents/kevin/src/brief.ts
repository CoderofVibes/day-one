// Kevin's 5am brief (PROJECT_BRIEF §5, FEATURES_V2 stretch): one printable page for a plant's
// purchaser, from Kevin's own data. What moved since the last working day, what waits on a
// person (QC, an approval, a flagged record, a discrepancy, a transfer to receive), what to buy
// or move before buying, and what to watch (price drift, mass balance, expiring lots). A pure
// read over the ledger: nothing is drafted, sent or changed, and no model is involved.

import { books } from "@day-one/server/ledger/books";
import type { Ledger } from "@day-one/server/ledger/db";
import { plantInventory } from "@day-one/server/ledger/inventory";
import {
  approvals,
  batchRecords,
  extractionFlags,
  facilities,
  lotEvents,
  lots,
  materials,
  purchaseOrders,
  staff,
  vendors,
} from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { amount, projectMaterial } from "./forecast.ts";
import { massBalance } from "./massBalance.ts";
import { suggestTransfers, transfersInTransit } from "./transferSuggestions.ts";

export interface BriefInput {
  /** Plant code; the acquired plant by default. */
  facility?: string;
  /** The plant's clock when the brief is printed. */
  now: string;
  /** Lots expiring within this many days are listed. */
  expiryDays?: number;
}

export interface BriefLine {
  text: string;
  /** What the line is about: a lot code, PO number, batch number, transfer or material. */
  ref?: string;
}

export interface BriefSection {
  key: "moved" | "waiting" | "buying" | "watch";
  title: string;
  lines: BriefLine[];
  /** Said when the section has no lines. */
  empty: string;
}

export interface Brief {
  facility: string;
  facilityName: string;
  /** The plant's purchaser, who the brief is for. */
  for: string | null;
  at: string;
  /** Start of the "moved" window: the same time on the previous working day. */
  since: string;
  headline: string;
  sections: BriefSection[];
}

const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August"].concat([
  "September",
  "October",
  "November",
  "December",
]);

/** The same time on the previous working day: Monday looks back to Friday. */
export function previousWorkingDay(now: string) {
  const t = new Date(now);
  const back = t.getUTCDay() === 1 ? 3 : t.getUTCDay() === 0 ? 2 : 1;
  return new Date(t.getTime() - back * DAY).toISOString();
}

function longDate(iso: string) {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function shortDate(iso: string) {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]?.slice(0, 3)} ${d.getUTCDate()}`;
}

/** "Magnesium stearate" reads as "magnesium stearate"; "HPLC" and "150 cc" stay as written. */
function lower(name: string) {
  return /^[A-Z][a-z]/.test(name) ? name[0]?.toLowerCase() + name.slice(1) : name;
}

/** Calendar days between two times, by date. */
function days(fromIso: string, toIso: string) {
  const n = Math.round((Date.parse(toIso.slice(0, 10)) - Date.parse(fromIso.slice(0, 10))) / DAY);
  return n <= 0 ? "since today" : n === 1 ? "for 1 day" : `for ${n} days`;
}

const EVENT_WORDS: Record<string, string> = {
  ordered: "ordered",
  shipped: "shipped",
  received: "received",
  quarantined: "put in quarantine",
  released: "released by QC",
  rejected: "rejected by QC",
  issued: "issued to production",
  returned: "returned to stock",
  consumed: "used up",
  wasted: "written off as waste",
  transfer_out: "sent to a sister plant",
  transfer_in: "received from a sister plant",
  count_adjust: "count adjusted",
};

const OPEN_PO = ["authorized", "approved", "funded"] as const;

export function morningBrief(db: Ledger, input: BriefInput): Brief {
  const plant = input.facility
    ? db.select().from(facilities).where(eq(facilities.code, input.facility)).get()
    : db.select().from(facilities).where(eq(facilities.role, "acquired")).get();
  if (!plant) throw new Error(`unknown plant ${input.facility}`);
  const { now } = input;
  const since = previousWorkingDay(now);
  const person = (role: string) =>
    db
      .select({ name: staff.name })
      .from(staff)
      .where(and(eq(staff.facilityId, plant.id), sql`${staff.role} = ${role}`))
      .get()?.name ?? null;
  const purchaser = person("purchaser");
  const qc = person("qc");

  // What moved: every lot event at the plant since the last working day, one line per lot.
  const moved = new Map<
    string,
    { at: string; name: string; words: string[]; deltaBase: number; dimension: string }
  >();
  for (const e of db
    .select({
      lotCode: lots.lotCode,
      name: materials.name,
      dimension: materials.dimension,
      kind: lotEvents.kind,
      deltaBase: lotEvents.qtyDeltaBase,
      at: lotEvents.occurredAt,
    })
    .from(lotEvents)
    .innerJoin(lots, eq(lots.id, lotEvents.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(
      and(
        eq(lotEvents.facilityId, plant.id),
        gte(lotEvents.occurredAt, since),
        lte(lotEvents.occurredAt, now),
      ),
    )
    .orderBy(asc(lotEvents.seq))
    .all()) {
    const m = moved.get(e.lotCode) ?? {
      at: e.at,
      name: e.name,
      words: [],
      deltaBase: 0,
      dimension: e.dimension,
    };
    const word = EVENT_WORDS[e.kind] ?? e.kind;
    if (!m.words.includes(word)) m.words.push(word);
    m.deltaBase += e.deltaBase;
    moved.set(e.lotCode, m);
  }
  const movedLines = [...moved].map(([lotCode, m]) => ({
    ref: lotCode,
    text:
      `${shortDate(m.at)}: ${lotCode}, ${lower(m.name)}, ${m.words.join(", ")}` +
      (m.deltaBase
        ? ` (${m.deltaBase > 0 ? "+" : "−"}${amount(Math.abs(m.deltaBase), m.dimension)}).`
        : "."),
  }));

  // Waiting on a person.
  const waiting: BriefLine[] = [];
  for (const lot of db
    .select({
      lotCode: lots.lotCode,
      name: materials.name,
      state: lots.state,
      since: sql<string>`(select max(${lotEvents.occurredAt}) from ${lotEvents} where ${lotEvents.lotId} = ${lots.id})`,
    })
    .from(lots)
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(
      and(eq(lots.currentFacilityId, plant.id), inArray(lots.state, ["received", "quarantine"])),
    )
    .orderBy(asc(lots.lotCode))
    .all()) {
    waiting.push({
      ref: lot.lotCode,
      text:
        `${lot.lotCode}, ${lower(lot.name)}, has been ${lot.state === "quarantine" ? "in quarantine" : "received but not sampled"} ` +
        `${days(lot.since, now)}; it waits on QC${qc ? ` (${qc})` : ""} before production can use it.`,
    });
  }
  for (const a of db
    .select({
      poNo: purchaseOrders.poNo,
      total: purchaseOrders.totalUsdc,
      vendor: vendors.name,
      approver: staff.name,
      requestedAt: approvals.requestedAt,
    })
    .from(approvals)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, approvals.poId))
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .innerJoin(staff, eq(staff.id, approvals.approverStaffId))
    .where(and(eq(approvals.state, "requested"), eq(purchaseOrders.shipToFacilityId, plant.id)))
    .orderBy(asc(approvals.id))
    .all()) {
    waiting.push({
      ref: a.poNo,
      text:
        `${a.poNo} (${a.vendor}, ${formatUsd(BigInt(a.total))}) is over Kevin's limit and waits for ` +
        `${a.approver}'s approval, asked ${shortDate(a.requestedAt)}.`,
    });
  }
  for (const b of db
    .select({
      batchNo: batchRecords.batchNo,
      open: sql<number>`(select count(*) from ${extractionFlags} where ${extractionFlags.batchId} = ${batchRecords.id} and ${extractionFlags.resolvedBy} is null)`,
    })
    .from(batchRecords)
    .where(and(eq(batchRecords.facilityId, plant.id), eq(batchRecords.status, "draft")))
    .orderBy(asc(batchRecords.batchNo))
    .all()) {
    waiting.push({
      ref: b.batchNo,
      text:
        `Batch record ${b.batchNo} is read but not confirmed` +
        (b.open
          ? `; ${b.open} field${b.open === 1 ? "" : "s"} flagged for a person to check.`
          : "."),
    });
  }
  const inventory = plantInventory(db);
  for (const d of inventory.discrepancies) {
    if (d.status !== "open" && d.status !== "proposed_adjustment") continue;
    if (d.facility !== plant.code && d.proposed?.facility !== plant.code) continue;
    waiting.push({
      ref: d.transferNo ?? d.batchNo ?? d.lotCode ?? `discrepancy ${d.id}`,
      text:
        (d.explanation ?? `${d.kind} on ${d.lotCode ?? d.material}.`) +
        (d.status === "proposed_adjustment" ? " Kevin's adjustment waits for review." : ""),
    });
  }
  for (const t of transfersInTransit(db).filter((t) => t.to === plant.code)) {
    waiting.push({
      ref: t.transferNo,
      text:
        `${t.transferNo}: ${amount(t.qtyBase, t.dimension)} ${lower(t.materialName)} ` +
        `(${t.lotCode}) on the road from Plant ${t.from}, to count in on arrival.`,
    });
  }

  // Buying: what the plan needs that stock and open orders do not cover, and spare stock at a
  // sister plant that could cover it first.
  const buying: BriefLine[] = [];
  for (const po of db
    .select({
      poNo: purchaseOrders.poNo,
      status: purchaseOrders.status,
      total: purchaseOrders.totalUsdc,
      vendor: vendors.name,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(
      and(
        eq(purchaseOrders.shipToFacilityId, plant.id),
        inArray(purchaseOrders.status, [...OPEN_PO]),
      ),
    )
    .orderBy(asc(purchaseOrders.poNo))
    .all()) {
    buying.push({
      ref: po.poNo,
      text:
        `${po.poNo} (${po.vendor}, ${formatUsd(BigInt(po.total))}) is ` +
        (po.status === "funded"
          ? "paid into escrow and on its way; the supplier is paid when QC releases the lot."
          : "authorized and waiting for the escrow to be funded."),
    });
  }
  const transfers = suggestTransfers(db, { now }).filter((s) => s.to === plant.code);
  // Only what this plant makes with or keeps in stock; a sister plant's materials are not its buy.
  const stocked = new Set(
    inventory.materials.filter((m) => m.byPlant[plant.code]).map((m) => m.code),
  );
  for (const m of db
    .select()
    .from(materials)
    .orderBy(asc(materials.category), asc(materials.code))
    .all()) {
    const f = projectMaterial(db, { facility: plant.code, material: m.code, now });
    if (f.recommendQtyBase === null) continue;
    if (!f.plannedBatches.length && !stocked.has(m.code)) continue;
    const text = f.plannedBatches.length
      ? `${m.name}: ${f.sentence}${f.needBy ? ` Needed by ${shortDate(f.needBy)}.` : ""}`
      : `${m.name}: ${amount(f.onHandBase + f.onOrderBase, m.dimension)} on hand and on order, ` +
        `under the reorder point of ${amount(f.reorderPointBase, m.dimension)}. ` +
        `Recommend ordering ${amount(f.recommendQtyBase, m.dimension)}.`;
    buying.push({ ref: m.code, text });
    for (const s of transfers.filter((s) => s.material === m.code)) {
      buying.push({ ref: s.key, text: s.sentence });
    }
  }

  // Watch: price drift on settled POs, mass balance at this plant, lots expiring soon.
  const watch: BriefLine[] = [];
  const plantPos = new Set(
    db
      .select({ poNo: purchaseOrders.poNo })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.shipToFacilityId, plant.id))
      .all()
      .map((po) => po.poNo),
  );
  for (const alert of books(db).alerts) {
    if (plantPos.has(alert.poNo)) watch.push({ ref: alert.poNo, text: alert.sentence });
  }
  // One sentence per flagged period, in the same order.
  const balance = massBalance(db);
  balance.periods
    .filter((p) => p.flagged)
    .forEach((p, i) => {
      const sentence = balance.sentences[i];
      if (p.facility === plant.code && sentence) watch.push({ ref: p.product, text: sentence });
    });
  const expiryUntil = new Date(Date.parse(now) + (input.expiryDays ?? 30) * DAY)
    .toISOString()
    .slice(0, 10);
  for (const lot of db
    .select({ lotCode: lots.lotCode, name: materials.name, expiresOn: lots.expiresOn })
    .from(lots)
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .where(
      and(
        eq(lots.currentFacilityId, plant.id),
        inArray(lots.state, ["received", "quarantine", "released", "in_use"]),
        lt(lots.expiresOn, expiryUntil),
      ),
    )
    .orderBy(asc(lots.expiresOn))
    .all()) {
    watch.push({
      ref: lot.lotCode,
      text: `${lot.lotCode}, ${lower(lot.name)}, expires ${lot.expiresOn}.`,
    });
  }

  const sections: BriefSection[] = [
    {
      key: "moved",
      title: `Since ${WEEKDAYS[new Date(since).getUTCDay()]}`,
      lines: movedLines,
      empty: "Nothing moved.",
    },
    {
      key: "waiting",
      title: "Waiting on a person",
      lines: waiting,
      empty: "Nothing waits on anyone.",
    },
    {
      key: "buying",
      title: "Buying",
      lines: buying,
      empty: "Stock and open orders cover the plan.",
    },
    { key: "watch", title: "Worth a look", lines: watch, empty: "Nothing unusual." },
  ];
  const n = waiting.length;
  const toBuy = buying.filter((l) => !l.ref?.startsWith("PO-") && !l.ref?.includes(":")).length;
  const headline =
    `Good morning${purchaser ? `, ${purchaser.split(" ")[0]}` : ""}. ` +
    (n
      ? `${n} thing${n === 1 ? "" : "s"} wait${n === 1 ? "s" : ""} on a person`
      : "Nothing waits on a person") +
    (toBuy
      ? `, and ${toBuy} material${toBuy === 1 ? "" : "s"} need${toBuy === 1 ? "s" : ""} ordering.`
      : ".");

  return {
    facility: plant.code,
    facilityName: plant.name,
    for: purchaser,
    at: now,
    since,
    headline,
    sections,
  };
}

/** The brief as plain text: the headline, then each section with its lines. */
export function formatBrief(brief: Brief) {
  const out = [`${brief.facilityName} · ${longDate(brief.at)}`, brief.headline];
  for (const s of brief.sections) {
    out.push("", s.title);
    for (const line of s.lines.length ? s.lines : [{ text: s.empty }]) out.push(`- ${line.text}`);
  }
  return out.join("\n");
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

/** One printable page: no scripts, no external assets, black on white for paper. */
export function briefHtml(brief: Brief) {
  const sections = brief.sections
    .map(
      (s) =>
        `<section class="${s.key}"><h2>${escapeHtml(s.title)}</h2>` +
        (s.lines.length
          ? `<ul>${s.lines.map((l) => `<li>${escapeHtml(l.text)}</li>`).join("")}</ul>`
          : `<p class="empty">${escapeHtml(s.empty)}</p>`) +
        "</section>",
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Morning brief · ${escapeHtml(brief.facilityName)}</title>
<style>
  /* The web UI's tokens (web/src/tokens.css), light only: this page is printed. */
  :root { --bg: #ffffff; --ink: #1b1d20; --ink-2: #5c6370; --line: #dcdad2; --brand: #1f6f5c; --brand-ink: #ffffff; --waiting: #8a5a00; --waiting-bg: #fff3d6; }
  body { font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--bg); max-width: 46rem; margin: 2rem auto; padding: 0 16px; }
  header { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: .75rem; margin-bottom: 1rem; }
  .mark { grid-row: 1 / 3; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--brand); color: var(--brand-ink); font-weight: 700; font-size: 17px; }
  .meta { font-size: 12px; color: var(--ink-2); }
  h1 { font-size: 20px; margin: 0; line-height: 1.3; }
  h2 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-2); margin: 1.4rem 0 .4rem; }
  section.waiting h2 { color: var(--waiting); }
  section.waiting ul { background: var(--waiting-bg); border-radius: 10px; padding: 8px 12px 8px 28px; }
  ul { margin: 0; padding-left: 1.2rem; }
  li { margin: .3rem 0; }
  .empty { color: var(--ink-2); margin: 0; }
  footer { margin-top: 1.5rem; font-size: 12px; color: var(--ink-2); border-top: 1px solid var(--line); padding-top: .5rem; }
  @media print { body { margin: 0 auto; } a { color: inherit; } section.waiting ul { background: none; padding-left: 1.2rem; } }
</style>
</head>
<body>
<header>
  <span class="mark" aria-hidden="true">K</span>
  <div class="meta">Kevin's morning brief · ${escapeHtml(brief.facilityName)} · ${escapeHtml(longDate(brief.at))}</div>
  <h1>${escapeHtml(brief.headline)}</h1>
</header>
${sections}
<footer>From Day One's ledger at ${escapeHtml(brief.at)}. Kevin drafts and flags; a person decides. Spending limits are enforced by the plant's contract, not by this page.</footer>
</body>
</html>
`;
}
