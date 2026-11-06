// The integration program (docs/VISION.md §6.12.3): seven stages that move Hollow Pine's work
// from the old way to Kevin, a person checking every step. A stage is done when the ledger says
// so (the sheet is posted, the records are confirmed, PO-1042 is paid, a person recorded the
// decision), never because a button was pressed on its own. Read-only here; decisions are
// written by `recordDecision`, the run and the import desk by their own routes.

import type { Ledger } from "@day-one/server/ledger/db";
import {
  batchRecords,
  JOURNEY_DECISIONS,
  journeyDecisions,
  products,
  staff,
} from "@day-one/server/ledger/schema";
import { asc, desc, eq, isNotNull } from "drizzle-orm";

export interface JourneyItem {
  key: string;
  label: string;
  done: boolean;
  /** Who acts on it. */
  who: string;
  /** What the ledger holds for it, in a few words. */
  detail?: string;
  decidedBy?: string | null;
  decidedAt?: string | null;
  note?: string | null;
}
export interface JourneyStage {
  stage: number;
  key: string;
  title: string;
  /** What the stage moves, in one line. */
  summary: string;
  done: boolean;
  items: JourneyItem[];
}
export interface Journey {
  stages: JourneyStage[];
  /** The first stage that is not done; 7 when everything before it is. */
  current: number;
  done: number;
  tally: { label: string; value: number }[];
}

/** The stages, in order. `summary` is shown on the stage list. */
export const STAGES = [
  { key: "meet", title: "Meet Kevin", summary: "Who does what, and how Kevin works" },
  {
    key: "sheets",
    title: "Your spreadsheets",
    summary: "The inventory workbook and its sales tab, read and posted",
  },
  { key: "paper", title: "Your paper", summary: "This week's batch records, read and confirmed" },
  {
    key: "plan",
    title: "Your products and schedule",
    summary: "Ten products and the next four weeks, confirmed",
  },
  {
    key: "rules",
    title: "Your suppliers and spend rules",
    summary: "Who Kevin may buy from, and his limits",
  },
  {
    key: "order",
    title: "Your first order",
    summary: "Forecast, quotes, approval, delivery, QC, paid",
  },
  { key: "books", title: "Your books and the ERP", summary: "Matched, exported, reconciled" },
  { key: "daily", title: "Day to day", summary: "The brief, the map and the trends from here" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];
export type Decision = (typeof JOURNEY_DECISIONS)[number];

/** What a stage records, beyond what the ledger shows by itself. */
const ITEMS: Record<StageKey, { key: string; label: string; who: string }[]> = {
  meet: [{ key: "start", label: "Start the onboarding program", who: "Ray Delgado" }],
  sheets: [{ key: "sales", label: "Say which October figure is right", who: "Ray Delgado" }],
  paper: [],
  plan: [{ key: "plan", label: "Confirm the next four weeks", who: "Linda Park" }],
  rules: [
    { key: "suppliers", label: "Approve the supplier list", who: "Jordan Pike" },
    { key: "limits", label: "Confirm Kevin's limits", who: "Linda Park" },
  ],
  order: [],
  books: [
    { key: "books", label: "Check the settled orders and the export", who: "Marcy Allen" },
    { key: "held", label: "Decide on the held invoice", who: "Marcy Allen" },
    { key: "erp", label: "Confirm the ERP reconciliation", who: "Marcy Allen" },
  ],
  daily: [],
};

export interface JourneyInputs {
  db: Ledger;
  /** The import desk's posted imports (api/src/imports.ts). */
  imports: {
    fileName: string;
    rowsFound: number;
    lotsPosted: number;
    review: unknown[];
    /** Flags Kevin raised on the sheet. */
    questions?: number;
  }[];
  /** Scans in the watched folder (agents/kevin/src/inbox.ts). */
  inbox: {
    file: string;
    batchNo: string | null;
    status: string;
    questions: number;
    flags: unknown[];
  }[];
  /** The run has reached its end: PO-1042 paid. */
  runDone: boolean;
  /** The run's purchasing steps so far, for the order stage. */
  runSteps: string[];
}

/** The decision in force for each stage and item: the latest one recorded. */
function decisions(db: Ledger) {
  const rows = db
    .select({
      stage: journeyDecisions.stage,
      item: journeyDecisions.item,
      decision: journeyDecisions.decision,
      note: journeyDecisions.note,
      at: journeyDecisions.decidedAt,
      by: staff.name,
    })
    .from(journeyDecisions)
    .leftJoin(staff, eq(staff.id, journeyDecisions.staffId))
    .orderBy(asc(journeyDecisions.id))
    .all();
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(`${r.stage}|${r.item}`, r);
  return { latest, count: rows.length };
}

const ORDER_STEPS = [
  "Forecast",
  "Quotes",
  "Small PO",
  "Big PO",
  "Linda texts",
  "Kevin retries",
  "Delivery",
  "QC release",
  "Paid",
];

export function journeyState(input: JourneyInputs): Journey {
  const { db } = input;
  const { latest, count } = decisions(db);
  const decided = (stage: number, item: string) => latest.get(`${stage}|${item}`);
  const recorded = (stage: number, item: { key: string; label: string; who: string }) => {
    const d = decided(stage, item.key);
    return {
      key: item.key,
      label: item.label,
      who: item.who,
      done: Boolean(d && d.decision !== "held"),
      ...(d ? { decidedBy: d.by, decidedAt: d.at, note: d.note, detail: d.decision } : {}),
    };
  };

  const confirmedRecords = db
    .select({ batchNo: batchRecords.batchNo, by: staff.name, at: batchRecords.confirmedAt })
    .from(batchRecords)
    .leftJoin(staff, eq(staff.id, batchRecords.confirmedBy))
    .where(isNotNull(batchRecords.sourceFile))
    .all();
  const confirmedNos = new Set(confirmedRecords.map((r) => r.batchNo));

  const productRows = db.select().from(products).orderBy(asc(products.code)).all();

  const stages: JourneyStage[] = STAGES.map((s, stage) => {
    let items: JourneyItem[] = [];
    switch (s.key) {
      case "meet":
        items = ITEMS.meet.map((i) => recorded(stage, i));
        break;
      case "sheets": {
        const posted = input.imports.find((i) => /inventory/i.test(i.fileName));
        items = [
          {
            key: "workbook",
            label: "Post the opening stock from the inventory workbook",
            who: "Ray Delgado",
            done: Boolean(posted),
            ...(posted
              ? {
                  detail: `${posted.rowsFound} rows read, ${posted.lotsPosted} lots posted, ${posted.review.length} held for review`,
                }
              : {}),
          },
          ...ITEMS.sheets.map((i) => recorded(stage, i)),
        ];
        break;
      }
      case "paper": {
        // Every scan needs a person's answer: confirmed into the ledger, set aside by Kevin as
        // not a record, or held by Ray with a reason (a lot the ledger has never received).
        const scans = input.inbox.map((i) => {
          const held = i.batchNo ? decided(stage, i.batchNo) : undefined;
          const posted =
            i.status === "confirmed" || (i.batchNo !== null && confirmedNos.has(i.batchNo));
          return {
            key: i.batchNo ?? i.file,
            label: i.batchNo ? `Check ${i.batchNo}` : `Look at ${i.file.split("/").at(-1)}`,
            who: "Ray Delgado",
            done: i.status === "set_aside" || posted || held?.decision === "held",
            detail:
              i.status === "set_aside"
                ? "not a batch record: set aside"
                : posted
                  ? "confirmed"
                  : held?.decision === "held"
                    ? `held: ${held.note ?? "for review"}`
                    : i.questions > 0
                      ? `${i.questions} question${i.questions === 1 ? "" : "s"} from Kevin`
                      : "read, nothing unsure",
            ...(held ? { decidedBy: held.by, decidedAt: held.at, note: held.note } : {}),
          };
        });
        const runRecord = confirmedRecords.find((r) => r.batchNo === "BR-B-1045");
        if (!scans.some((s) => s.key === "BR-B-1045")) {
          scans.unshift({
            key: "BR-B-1045",
            label: "Check BR-B-1045",
            who: "Ray Delgado",
            done: Boolean(runRecord),
            detail: runRecord ? "confirmed" : "the record the first order starts from",
          });
        }
        items = scans;
        break;
      }
      case "plan":
        items = [
          ...productRows.map((p) =>
            recorded(stage, {
              key: p.code,
              label: `Confirm ${p.name.replace(/^(Hollow Pine|Acme) /, "")}`,
              who: "Linda Park",
            }),
          ),
          ...ITEMS.plan.map((i) => recorded(stage, i)),
        ];
        break;
      case "rules":
        items = ITEMS.rules.map((i) => recorded(stage, i));
        break;
      case "order": {
        const reached = new Set(input.runSteps);
        items = ORDER_STEPS.map((title) => ({
          key: title,
          label: title,
          who:
            title === "Linda texts"
              ? "Linda Park"
              : title === "Delivery"
                ? "Tommy Reyes"
                : title === "QC release"
                  ? "Priya Natarajan"
                  : title === "Paid"
                    ? "Marcy Allen"
                    : "Kevin",
          done: reached.has(title),
        }));
        break;
      }
      case "books":
        items = ITEMS.books.map((i) => recorded(stage, i));
        break;
      case "daily":
        items = [];
        break;
    }
    return {
      stage,
      key: s.key,
      title: s.title,
      summary: s.summary,
      done: false,
      items,
    };
  });

  // A stage is done when every item is; the order stage when PO-1042 is paid; the last stage
  // when everything before it is.
  // Meeting Kevin is behind anyone who has already started working with him: once any later
  // item is done, the first stage counts as done (first-use review, Nov 5, finding 46).
  const started = stages.slice(1).some((x) => x.items.some((i) => i.done));
  for (const st of stages) {
    if (st.key === "meet" && started) {
      st.items = st.items.map((i) =>
        i.done ? i : { ...i, done: true, detail: "started by working" },
      );
    }
    if (st.key === "order") st.done = input.runDone;
    else if (st.key === "daily") st.done = stages.slice(0, -1).every((x) => x.done);
    else st.done = st.items.length > 0 && st.items.every((i) => i.done);
  }
  const current = stages.find((s) => !s.done)?.stage ?? STAGES.length - 1;

  const inboxQuestions = input.inbox.reduce((s, i) => s + i.questions, 0);
  const tally = [
    {
      label: "spreadsheet rows read",
      value: input.imports.reduce((s, i) => s + i.rowsFound, 0),
    },
    {
      label: "scans read",
      value: input.inbox.length + (input.inbox.some((i) => i.batchNo === "BR-B-1045") ? 0 : 1),
    },
    { label: "records confirmed by a person", value: confirmedRecords.length },
    {
      label: "questions Kevin asked",
      value:
        inboxQuestions + input.imports.reduce((s, i) => s + (i.questions ?? i.review.length), 0),
    },
    { label: "decisions people recorded", value: count },
  ];
  return { stages, current, done: stages.filter((s) => s.done).length, tally };
}

export class JourneyError extends Error {
  override name = "JourneyError";
}

/** A person's decision at a stage, appended to the ledger. */
export function recordDecision(
  db: Ledger,
  input: {
    stage: number;
    item: string;
    decision: Decision;
    staffId: number | null;
    note?: string | null;
    at: string;
  },
) {
  const stage = STAGES[input.stage];
  if (!stage) throw new JourneyError(`no stage ${input.stage}`);
  if (stage.key === "paper") {
    // Ray holds a scan he cannot confirm yet, with the reason; a confirm goes through the inbox.
    if (!/^BR-[A-Z]-\d+$/.test(input.item) || input.decision !== "held" || !input.note?.trim()) {
      throw new JourneyError(
        "stage 2 records only a held batch record, with the reason: confirm one from the queue instead",
      );
    }
  }
  const known =
    stage.key === "paper"
      ? [input.item]
      : stage.key === "plan"
        ? [
            ...ITEMS.plan.map((i) => i.key),
            ...db
              .select({ code: products.code })
              .from(products)
              .all()
              .map((p) => p.code),
          ]
        : ITEMS[stage.key].map((i) => i.key);
  if (!known.includes(input.item)) {
    throw new JourneyError(
      known.length
        ? `stage ${input.stage} (${stage.title}) records ${known.join(", ")}, not ${input.item}`
        : `stage ${input.stage} (${stage.title}) is done by the ledger itself, not by a decision`,
    );
  }
  if (!(JOURNEY_DECISIONS as readonly string[]).includes(input.decision)) {
    throw new JourneyError(`decision must be one of ${JOURNEY_DECISIONS.join(", ")}`);
  }
  return db
    .insert(journeyDecisions)
    .values({
      stage: input.stage,
      item: input.item,
      decision: input.decision,
      staffId: input.staffId,
      note: input.note ?? null,
      decidedAt: input.at,
    })
    .returning()
    .get();
}

/** The latest decision recorded at a stage, for a page that needs one directly. */
export function lastDecision(db: Ledger, stage: number, item: string) {
  return db
    .select()
    .from(journeyDecisions)
    .where(eq(journeyDecisions.stage, stage))
    .orderBy(desc(journeyDecisions.id))
    .all()
    .find((r) => r.item === item);
}
