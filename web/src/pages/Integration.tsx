// Your integration (docs/VISION.md §6.12.3): seven stages that move Hollow Pine's work from the
// old way to Kevin, a person checking every step. Each stage shows how the work is done today
// beside the same work with Kevin, and what is left; a stage is done when the ledger says so.
// Live, people act here; on a static host, the program as the recorded run walked it, read-only.

import { useState } from "react";
import batchRecordScan from "../../../data/batch-records/BR-B-1043.jpg?url";
import type { Books, ImportView, InboxItem, InboxState, PolicyState } from "../api.ts";
import { dollars, qty } from "../charts.tsx";
import { initials, KevinNote, Pill } from "../feed.tsx";
import { ImportPane } from "../ImportPane.tsx";
import { InboxPane } from "../InboxPane.tsx";
import {
  type Catalog,
  type Journey,
  type JourneyItem,
  type JourneyStage,
  loadRecorded,
  type PolicyDraft,
  postPolicyDraft,
  type Reconciliation,
  type RecordedJourney,
  readCatalog,
  readJourney,
  readReconciliation,
} from "../journey.ts";
import { HeldInvoiceCard } from "../panes.tsx";
import { readSchedule, type Source, useRead } from "../series.ts";
import { PageHeader, type PageId } from "../shell.tsx";

export interface IntegrationActions {
  decide: (input: {
    stage: number;
    item: string;
    decision?: "started" | "confirmed" | "approved" | "held";
    staff?: string;
    note?: string;
  }) => Promise<void>;
  dropScans: (all: boolean) => Promise<void>;
  /** The import wizard posted the opening stock. */
  posted: () => void;
  confirmScan: (batchNo: string, resolutions: Record<string, string>) => void;
}

const PEOPLE: { name: string; role: string; does: string }[] = [
  {
    name: "Ray Delgado",
    role: "Purchaser",
    does: "Hands Kevin the sheets and the scans, checks what he read.",
  },
  {
    name: "Linda Park",
    role: "Ops director",
    does: "Confirms the products and the plan; approves by text over the limit.",
  },
  { name: "Tommy Reyes", role: "Receiving", does: "Photographs the packing slip at the dock." },
  { name: "Priya Natarajan", role: "QC", does: "Releases or rejects a lot in quarantine." },
  {
    name: "Marcy Allen",
    role: "Accounting",
    does: "Checks the books, the held invoices and the ERP.",
  },
  { name: "Jordan Pike", role: "Acme HQ", does: "Approves the suppliers and sets Kevin's limits." },
];

/** How each stage is done today, in the plant's own terms. */
const OLD_WAY: Record<JourneyStage["key"], string[]> = {
  meet: [
    "Batch records on paper in a binder; stock in a workbook called INVENTORY_FINAL_v7_USE_THIS_ONE; POs typed and emailed; invoices keyed into the acquirer's ERP by hand.",
    "Anything over $2,500 means finding Linda. A changed bank account on an invoice is a phone call, if anyone notices.",
  ],
  sheets: [
    'Ray keeps stock in one workbook, edited by whoever is near it: the same lot entered twice, pounds and kilograms side by side, a quantity typed as "~6 kg", a total row in the middle of the data.',
    "Every month someone retypes it into the ERP and the numbers drift.",
  ],
  paper: [
    "Every batch is written on a paper record in Weigh & Dispense: lots, targets, what was weighed, initials. The binder goes to the office at the end of the week.",
    "Marcy types each record into the ERP by hand. A struck-through number or a smudged one is a phone call to the floor; stock is a week behind the floor.",
  ],
  plan: [
    "The schedule is a whiteboard by the line and the formulas are a folder of sheets. Nobody sees what next week's batches will use until the weigh-out cell runs short.",
  ],
  rules: [
    "The approved vendors are a binder at reception. The $2,500 rule is in Linda's head; a supplier's lapsed audit is found when someone remembers.",
  ],
  order: [
    "Ray works out what to buy from the workbook, calls three suppliers, emails a PO, waits for Linda, and AP mails a check thirty days after the invoice, whoever's bank details are on it.",
  ],
  books: [
    "Marcy matches each invoice to a PO and a receiving slip by hand, keys it into the ERP and hopes the totals agree at month end.",
  ],
  daily: [
    "Ray starts the day in the workbook and his inbox, and finds out what is short when someone asks.",
  ],
};

/** Kevin's one line for each stage, from what the stage holds now. */
function kevinLine(stage: JourneyStage): string {
  const open = stage.items.filter((i) => !i.done);
  if (stage.done) {
    return {
      meet: "We're set. Each stage below moves one piece of the work; nothing posts until someone checks it.",
      sheets:
        "The workbook is posted as Hollow Pine's opening stock, with every row I was unsure of answered by Ray.",
      paper:
        "This week's records are in the ledger. Stock now moves when the batch is confirmed, not when the binder is typed.",
      plan: "The ten products and the next four weeks are confirmed. My forecast reads them from here.",
      rules: "The suppliers and my limits are confirmed; the contract enforces the limits, not me.",
      order: "PO-1042 is paid. The money waited in escrow until Priya released the lot.",
      books: "The books are matched and the ERP agrees with the ledger and the contract.",
      daily: "From here, the 5am brief, the plant map and the trends are the day.",
    }[stage.key];
  }
  if (stage.key === "order")
    return "The first order runs from the Overview: forecast, quotes, the PO, Linda's text, the delivery and QC.";
  if (stage.key === "paper" && stage.items.length <= 1)
    return "Drop this week's scans in the folder, or open them here. I read each one, you check it, then it posts.";
  const next = open[0];
  return next
    ? `${open.length} to go. Next: ${lowerFirst(next.label)} (${next.who.split(" ")[0]}).`
    : "Nothing left here.";
}

/** "Post the opening stock" reads "post the opening stock" mid-sentence; names inside keep their capitals. */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function Integration({
  source,
  books,
  policy,
  inbox,
  busy,
  act,
  go,
  wizardKey,
  curtain,
}: {
  source: Source;
  books: Books | null;
  policy: PolicyState | null;
  inbox: InboxState | null;
  busy: boolean;
  /** Behind the curtain: accounts and transactions show; off, staff see dollars and POs only. */
  curtain: boolean;
  /** Absent on a static host: the program is shown as recorded. */
  act?: IntegrationActions;
  go: (page: PageId) => void;
  wizardKey?: number;
}) {
  const key = `${source.live}-${source.version}`;
  const { value: journey, error } = useRead(() => readJourney(source), key);
  // The recorded walkthrough: the program itself on a static host; live, only the workbook as
  // Ray kept it (fixture data, the same either way).
  const { value: recordedFile } = useRead(() => loadRecorded(), "recorded");
  const recorded = source.live ? null : recordedFile;
  const workbook = recordedFile?.workbook.rows ?? null;
  const [open, setOpen] = useState<number | null>(null);
  if (!journey) {
    return (
      <main className="page v2" aria-label="Your integration">
        <PageHeader
          crumb="Hollow Pine Tablet Co. › Your integration"
          title="Your integration"
          sentence="Loading…"
        />
        {error && <p className="error">{error}</p>}
      </main>
    );
  }
  // Live, the stage in progress; recorded, the start of the story.
  const shown = open ?? (source.live ? journey.current : 0);
  const stage = journey.stages[shown] ?? journey.stages[0];
  const pct = Math.round((journey.done / journey.stages.length) * 100);
  return (
    <main className="page v2" aria-label="Your integration">
      <PageHeader
        crumb="Hollow Pine Tablet Co. › Your integration"
        title="Your integration"
        sentence="Seven stages after you meet Kevin. Each one moves a piece of the plant's work from the old way to Kevin, with a person checking every step. Nothing posts until someone says so."
        right={
          <>
            <span className={journey.current >= 7 ? "pill paid" : "pill waiting"}>
              {journey.current >= 7 ? "all stages done" : `stage ${journey.current} of 7`}
            </span>
            {!source.live && <span className="pill neutral">as recorded</span>}
          </>
        }
      />
      <div className="journey">
        <nav className="card-v2 stages" aria-label="Stages">
          <div className="chart-head">
            <h3>Progress</h3>
            <span className="right muted small">
              {journey.done} of {journey.stages.length} done
            </span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <ol>
            {journey.stages.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={s.stage === shown ? "st on" : "st"}
                  aria-current={s.stage === shown ? "step" : undefined}
                  onClick={() => setOpen(s.stage)}
                >
                  <span className={s.done ? "n done" : s.stage === journey.current ? "n now" : "n"}>
                    {s.done ? "✓" : s.stage}
                  </span>
                  <span>
                    <b>
                      {s.stage} · {s.title}
                    </b>
                    <small>{s.summary}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        {stage && (
          <StageScreen
            stage={stage}
            journey={journey}
            source={source}
            recorded={recorded}
            workbook={workbook}
            books={books}
            policy={policy}
            inbox={inbox}
            busy={busy}
            {...(act ? { act } : {})}
            go={go}
            {...(wizardKey === undefined ? {} : { wizardKey })}
            curtain={curtain}
          />
        )}
      </div>
      <section className="card-v2" aria-label="So far, from the ledger">
        <div className="chart-head">
          <h3>So far, from the ledger</h3>
          <span className="right muted small">counts, not estimates</span>
        </div>
        <div className="tally">
          {journey.tally.map((t) => (
            <div key={t.label} className="t">
              <b className="num">{t.value}</b>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function StageScreen({
  stage,
  journey,
  source,
  recorded,
  workbook,
  books,
  policy,
  inbox,
  busy,
  act,
  go,
  wizardKey,
  curtain,
}: {
  stage: JourneyStage;
  journey: Journey;
  source: Source;
  recorded: RecordedJourney | null;
  workbook: (string | number | null)[][] | null;
  books: Books | null;
  policy: PolicyState | null;
  inbox: InboxState | null;
  busy: boolean;
  act?: IntegrationActions;
  go: (page: PageId) => void;
  wizardKey?: number;
  curtain: boolean;
}) {
  return (
    <div className="stage-screen">
      <section className="card-v2 kevin-line" aria-label="Kevin">
        <span className="avatar kevin" aria-hidden="true">
          K
        </span>
        <p>
          <b>Kevin</b> · stage {stage.stage}, {lowerFirst(stage.title)}
          <br />
          {kevinLine(stage)}
        </p>
        <Pill tone={stage.done ? "paid" : stage.stage === journey.current ? "waiting" : "neutral"}>
          {stage.done ? "done" : stage.stage === journey.current ? "in progress" : "not started"}
        </Pill>
      </section>
      <div className="split">
        <section className="card-v2 old-way" aria-label="How it is done today">
          <div className="chart-head">
            <h3>How it is done today</h3>
            <span className="right">
              <span className="pill neutral">the old way</span>
            </span>
          </div>
          <OldWay stage={stage} workbook={workbook} />
        </section>
        <section className="card-v2 with-kevin" aria-label="With Kevin">
          <div className="chart-head">
            <h3>With Kevin</h3>
            <span className="right muted small">
              {act ? "you check, Kevin posts" : "as recorded"}
            </span>
          </div>
          <WithKevin
            stage={stage}
            source={source}
            recorded={recorded}
            books={books}
            policy={policy}
            inbox={inbox}
            busy={busy}
            {...(act ? { act } : {})}
            go={go}
            {...(wizardKey === undefined ? {} : { wizardKey })}
            curtain={curtain}
          />
        </section>
      </div>
      {stage.items.length > 0 && <Checklist stage={stage} {...(act ? { act } : {})} busy={busy} />}
    </div>
  );
}

function OldWay({
  stage,
  workbook,
}: {
  stage: JourneyStage;
  workbook: (string | number | null)[][] | null;
}) {
  const lines = OLD_WAY[stage.key];
  return (
    <div className="old-body">
      {stage.key === "paper" && (
        <img
          className="artifact"
          src={batchRecordScan}
          alt="A paper batch record, BR-B-1043, with a struck-through quantity initialed DW"
        />
      )}
      {stage.key === "sheets" && workbook && <Workbook rows={workbook} />}
      <div>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
    </div>
  );
}

/** Ray's workbook as he kept it: the first rows, cell for cell. */
function Workbook({ rows }: { rows: (string | number | null)[][] }) {
  return (
    <figure
      className="sheet-grid"
      aria-label="INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx, sheet Inventory"
    >
      <div className="sheet-name">INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx</div>
      <table>
        <tbody>
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a spreadsheet row is its position
            <tr key={i}>
              <th>{i + 1}</th>
              {Array.from({ length: 7 }, (_, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a spreadsheet cell is its column
                <td key={c}>{r[c] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function WithKevin({
  stage,
  source,
  recorded,
  books,
  policy,
  inbox,
  busy,
  act,
  go,
  wizardKey,
  curtain,
}: {
  stage: JourneyStage;
  source: Source;
  recorded: RecordedJourney | null;
  books: Books | null;
  policy: PolicyState | null;
  inbox: InboxState | null;
  busy: boolean;
  act?: IntegrationActions;
  go: (page: PageId) => void;
  wizardKey?: number;
  curtain: boolean;
}) {
  switch (stage.key) {
    case "meet":
      return <Meet stage={stage} {...(act ? { act } : {})} busy={busy} />;
    case "sheets":
      return (
        <Sheets
          stage={stage}
          recorded={recorded}
          {...(act ? { act } : {})}
          busy={busy}
          {...(wizardKey === undefined ? {} : { wizardKey })}
        />
      );
    case "paper":
      return <Paper recorded={recorded} inbox={inbox} {...(act ? { act } : {})} busy={busy} />;
    case "plan":
      return <Plan stage={stage} source={source} {...(act ? { act } : {})} busy={busy} />;
    case "rules":
      return (
        <Rules
          stage={stage}
          source={source}
          recorded={recorded}
          policy={policy}
          {...(act ? { act } : {})}
          busy={busy}
        />
      );
    case "order":
      return <Order stage={stage} go={go} />;
    case "books":
      return (
        <BooksStage
          stage={stage}
          source={source}
          books={books}
          {...(act ? { act } : {})}
          busy={busy}
          curtain={curtain}
        />
      );
    default:
      return <Daily go={go} />;
  }
}

/** Every stage's items: what is done, by whom, and what is left. */
function Checklist({
  stage,
  act,
  busy,
}: {
  stage: JourneyStage;
  act?: IntegrationActions;
  busy: boolean;
}) {
  return (
    <section className="card-v2" aria-label="What this stage holds">
      <div className="chart-head">
        <h3>What this stage holds</h3>
        <span className="right muted small">
          {stage.items.filter((i) => i.done).length} of {stage.items.length} done
        </span>
      </div>
      <ul className="steps">
        {stage.items.map((i) => (
          <li key={i.key} className={i.done ? "done" : undefined}>
            <span className="k" aria-hidden="true">
              {i.done ? "✓" : initials(i.who)}
            </span>
            <span className="what">
              <b>{i.label}</b>
              <small>
                {i.who}
                {i.detail ? ` · ${i.detail}` : ""}
                {i.decidedBy && i.decidedAt
                  ? ` · ${i.decidedBy === i.who ? "" : `${i.decidedBy}, `}${shortTime(i.decidedAt)}`
                  : ""}
                {i.note ? ` · “${i.note}”` : ""}
              </small>
            </span>
            {i.done ? (
              <Pill tone="paid">
                {i.detail === "held" || i.detail?.startsWith("held:") ? "held" : "done"}
              </Pill>
            ) : stage.key === "paper" && act && /^BR-/.test(i.key) && i.key !== "BR-B-1045" ? (
              <HoldButton item={i} act={act} busy={busy} />
            ) : (
              <Pill tone="neutral">open</Pill>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function HoldButton({
  item,
  act,
  busy,
}: {
  item: JourneyItem;
  act: IntegrationActions;
  busy: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  if (!asking) {
    return (
      <button type="button" className="btn sm" disabled={busy} onClick={() => setAsking(true)}>
        Hold
      </button>
    );
  }
  return (
    <form
      className="hold"
      onSubmit={(e) => {
        e.preventDefault();
        act.decide({ stage: 2, item: item.key, decision: "held", staff: "Ray Delgado", note });
      }}
    >
      <input
        aria-label={`Why hold ${item.key}`}
        placeholder="Why, for whoever picks it up"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="submit" className="btn sm" disabled={busy || !note.trim()}>
        Hold it
      </button>
    </form>
  );
}

function Decide({
  act,
  busy,
  label,
  input,
  done,
}: {
  /** Absent on a static host. */
  act: IntegrationActions | undefined;
  busy: boolean;
  label: string;
  input: Parameters<IntegrationActions["decide"]>[0];
  done: boolean;
}) {
  if (done) return <Pill tone="paid">done</Pill>;
  if (!act) return <Pill tone="neutral">open</Pill>;
  return (
    <button
      type="button"
      className="btn primary sm"
      disabled={busy}
      onClick={() => act.decide(input)}
    >
      {label}
    </button>
  );
}

const itemDone = (stage: JourneyStage, key: string) =>
  stage.items.find((i) => i.key === key)?.done ?? false;

// ------------------------------------------------------------------ stage 0

function Meet({
  stage,
  act,
  busy,
}: {
  stage: JourneyStage;
  act?: IntegrationActions;
  busy: boolean;
}) {
  return (
    <div className="stage-body">
      <ul className="people">
        {PEOPLE.map((p) => (
          <li key={p.name}>
            <span className="avatar" aria-hidden="true">
              {initials(p.name)}
            </span>
            <span>
              <b>{p.name}</b> · {p.role}
              <small>{p.does}</small>
            </span>
          </li>
        ))}
      </ul>
      <KevinNote>
        I read the plant's sheets and scans, draft orders and flag what does not add up. I never
        post or pay on my own: a person checks every reading, and the limits, the approvals and the
        payment on delivery are rules HQ sets in a contract I cannot change. The ✓ Protected marker
        opens the record behind it.
      </KevinNote>
      <div className="actions">
        <Decide
          act={act}
          busy={busy}
          label="Start the program"
          input={{ stage: 0, item: "start", decision: "started", staff: "Ray Delgado" }}
          done={stage.done}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stage 1

function Sheets({
  stage,
  recorded,
  act,
  busy,
  wizardKey,
}: {
  stage: JourneyStage;
  recorded: RecordedJourney | null;
  act?: IntegrationActions;
  busy: boolean;
  wizardKey?: number;
}) {
  const workbook = stage.items.find((i) => i.key === "workbook");
  return (
    <div className="stage-body">
      {act ? (
        <ImportPane key={wizardKey ?? 0} onPosted={act.posted} />
      ) : recorded ? (
        <RecordedImport view={recorded.importView} detail={workbook?.detail} />
      ) : null}
      <div className="question">
        {act ? (
          // The wizard above asks the question; this is where Ray answers it.
          <h3 className="small">Ray's answer on the October sales figure</h3>
        ) : (
          <KevinNote alert>
            The sales tab and the Summary disagree on Cardinal Mart 60 ct for October: 4,820 on the
            customer tab, 4,280 on Summary. That is 540 bottles, about 16.7 kg of ascorbic acid. I
            use neither until you say which is right.
          </KevinNote>
        )}
        {itemDone(stage, "sales") ? (
          <p className="small muted">Ray: “{stage.items.find((i) => i.key === "sales")?.note}”</p>
        ) : act ? (
          <div className="actions">
            {[
              ["4,820 is right", "Cardinal Mart 60 ct for October: 4,820 (the customer tab)."],
              ["4,280 is right", "Cardinal Mart 60 ct for October: 4,280 (Summary)."],
            ].map(([label, note]) => (
              <button
                key={label}
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() =>
                  act.decide({ stage: 1, item: "sales", staff: "Ray Delgado", note: note ?? "" })
                }
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecordedImport({ view, detail }: { view: ImportView; detail: string | undefined }) {
  return (
    <div>
      <KevinNote>{view.analysis.message}</KevinNote>
      <ul className="flag-list">
        {view.analysis.flags.map((f) => (
          <li key={f.id}>
            <span className="pill waiting">row {f.row}</span> {f.message}
            {f.proposal && <span className="muted"> Kevin: {f.proposal}</span>}
          </li>
        ))}
      </ul>
      {detail && <p className="small muted">Posted as Hollow Pine's opening stock: {detail}.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ stage 2

function Paper({
  recorded,
  inbox,
  act,
  busy,
}: {
  recorded: RecordedJourney | null;
  inbox: InboxState | null;
  act?: IntegrationActions;
  busy: boolean;
}) {
  const [all, setAll] = useState(false);
  if (!act) {
    return (
      <div className="stage-body">
        <ul className="scans">
          {(recorded?.scans ?? []).map((s) => (
            <ScanRow key={s.id} scan={s} />
          ))}
        </ul>
        <p className="small muted">
          The week's four scans, read by Kevin on the recorded run: BR-B-1046's smudged magnesium
          oxide was confirmed by Ray as 83.040 kg; the packing slip was not a batch record and was
          set aside.
        </p>
      </div>
    );
  }
  const waiting = inbox?.items.filter((i) => i.status === "waiting") ?? [];
  return (
    <div className="stage-body">
      <div className="actions">
        <button
          type="button"
          className="btn primary sm"
          disabled={busy}
          onClick={() => act.dropScans(all)}
        >
          Drop this week's scans in the folder
        </button>
        <label className="small muted check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> every
          scan on record, not just the week's four
        </label>
      </div>
      {inbox && inbox.items.length > 0 ? (
        <InboxPane
          inbox={inbox}
          busy={busy}
          viewer="Ray Delgado"
          onConfirm={act.confirmScan}
          embedded
        />
      ) : (
        <p className="small muted">
          Nothing in the folder yet. On the plant floor a scanner drops each page there; here the
          button copies the week's scans in, as npm run inbox does.
        </p>
      )}
      {waiting.some((w) => w.batchNo === "BR-B-1045") && (
        <p className="small muted">
          Confirming BR-B-1045 also starts the first order (stage 5): it is the record that leaves
          ascorbic acid short.
        </p>
      )}
    </div>
  );
}

function ScanRow({ scan }: { scan: InboxItem }) {
  return (
    <li>
      <span className="page" aria-hidden="true" />
      <span>
        <b>{scan.batchNo ?? scan.file.split("/").at(-1)}</b>
        <small>{scan.summary}</small>
      </span>
      <Pill
        tone={
          scan.status === "confirmed" ? "paid" : scan.status === "set_aside" ? "neutral" : "waiting"
        }
      >
        {scan.status === "set_aside" ? "set aside" : scan.status}
      </Pill>
    </li>
  );
}

// ------------------------------------------------------------------ stage 3

function Plan({
  stage,
  source,
  act,
  busy,
}: {
  stage: JourneyStage;
  source: Source;
  act?: IntegrationActions;
  busy: boolean;
}) {
  const key = `${source.live}-${source.version}`;
  const { value: catalog } = useRead(() => readCatalog(source), key);
  const { value: schedule } = useRead(() => readSchedule(source, "B", 28), key);
  const [openProduct, setOpenProduct] = useState<string | null>(null);
  return (
    <div className="stage-body">
      <h4>Ten products, as Kevin read them from the records and the sheets</h4>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Product</th>
              <th>Form</th>
              <th className="n">Batch</th>
              <th>Made at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(catalog?.products ?? []).map((p) => (
              <ProductRow
                key={p.code}
                product={p}
                open={openProduct === p.code}
                onToggle={() => setOpenProduct(openProduct === p.code ? null : p.code)}
                action={
                  <Decide
                    act={act}
                    busy={busy}
                    label="Confirm"
                    input={{ stage: 3, item: p.code, staff: "Linda Park" }}
                    done={itemDone(stage, p.code)}
                  />
                }
              />
            ))}
          </tbody>
        </table>
      </div>
      <h4>The next four weeks at Hollow Pine</h4>
      {schedule && (
        <>
          <KevinNote alert={schedule.batches.some((b) => b.short.length > 0)}>
            {schedule.sentence}
          </KevinNote>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Batch</th>
                  <th>Product</th>
                  <th className="n">Units</th>
                  <th className="n">Materials at last price</th>
                  <th>Cover</th>
                </tr>
              </thead>
              <tbody>
                {schedule.batches.map((b) => (
                  <tr key={b.batchNo}>
                    <td>{b.plannedFor.slice(5)}</td>
                    <td>
                      <b>{b.batchNo}</b>
                    </td>
                    <td>{b.productName.replace(/^(Hollow Pine|Acme) /, "")}</td>
                    <td className="n num">{b.units.toLocaleString("en-US")}</td>
                    <td className="n num">
                      {dollars(b.costUsdc)}
                      {b.unpriced.length > 0 && (
                        <small> + {b.unpriced.join(", ")} not yet priced</small>
                      )}
                    </td>
                    <td>
                      {b.short.length ? (
                        <Pill tone="refused">short: {b.short.join(", ")}</Pill>
                      ) : (
                        <Pill tone="paid">covered</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="actions">
        <Decide
          act={act}
          busy={busy}
          label="Confirm the next four weeks"
          input={{ stage: 3, item: "plan", staff: "Linda Park" }}
          done={itemDone(stage, "plan")}
        />
      </div>
    </div>
  );
}

function ProductRow({
  product,
  open,
  onToggle,
  action,
}: {
  product: Catalog["products"][number];
  open: boolean;
  onToggle: () => void;
  action: React.ReactNode;
}) {
  return (
    <>
      <tr>
        <td>
          <button type="button" className="link-btn" aria-expanded={open} onClick={onToggle}>
            {open ? "▾" : "▸"} {product.name.replace(/^(Hollow Pine|Acme) /, "")}
          </button>
          <small className="muted"> {product.code}</small>
        </td>
        <td>{product.form}</td>
        <td className="n num">{product.batchUnits.toLocaleString("en-US")}</td>
        <td>
          {product.plants
            .map((p) => ({ A: "Riverside", B: "Hollow Pine", C: "Lakeview" })[p] ?? p)
            .join(", ")}
        </td>
        <td className="n">{action}</td>
      </tr>
      {open && (
        <tr className="formula">
          <td colSpan={5}>
            {product.lines.map((l) => (
              <span key={l.material}>
                {l.name} <b className="num">{qty(l.qtyPerBatchBase, "mass")}</b>
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

// ------------------------------------------------------------------ stage 4

function Rules({
  stage,
  source,
  recorded,
  policy,
  act,
  busy,
}: {
  stage: JourneyStage;
  source: Source;
  recorded: RecordedJourney | null;
  policy: PolicyState | null;
  act?: IntegrationActions;
  busy: boolean;
}) {
  const { value: catalog } = useRead(() => readCatalog(source), `${source.live}-${source.version}`);
  const agent = policy?.reachable ? policy.policy.agent : null;
  const limits = agent
    ? {
        perPo: dollars(Number(agent.perPoLimit)),
        monthly: dollars(Number(agent.monthlyLimit)),
        approver: (policy?.reachable && policy.names[agent.approver]) || agent.approver,
      }
    : recorded
      ? {
          perPo: recorded.limits.perPo,
          monthly: recorded.limits.monthly,
          approver: recorded.limits.approver,
        }
      : null;
  return (
    <div className="stage-body">
      <h4>Suppliers Kevin may buy from</h4>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Standing</th>
              <th>Supplies</th>
            </tr>
          </thead>
          <tbody>
            {(catalog?.vendors ?? []).map((v) => (
              <tr key={v.code}>
                <td>
                  <b>{v.name}</b>
                  {v.notes && <small className="sub">{v.notes}</small>}
                </td>
                <td>
                  <Pill
                    tone={
                      v.qualification === "qualified"
                        ? "paid"
                        : v.qualification === "conditional"
                          ? "waiting"
                          : "refused"
                    }
                  >
                    {v.qualification === "unqualified" ? "not qualified" : v.qualification}
                  </Pill>
                </td>
                <td className="small">{v.supplies.map((s) => s.name).join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <Decide
          act={act}
          busy={busy}
          label="Approve the supplier list"
          input={{ stage: 4, item: "suppliers", decision: "approved", staff: "Jordan Pike" }}
          done={itemDone(stage, "suppliers")}
        />
      </div>
      <h4>Kevin's limits</h4>
      {limits ? (
        <div className="limits">
          <div>
            <small>Per purchase order</small>
            <b className="num">{limits.perPo}</b>
          </div>
          <div>
            <small>Each month</small>
            <b className="num">{limits.monthly}</b>
          </div>
          <div>
            <small>Over the limit</small>
            <b>{limits.approver} approves</b>
          </div>
        </div>
      ) : (
        <p className="small muted">The contract could not be read just now.</p>
      )}
      {act && <PlainWords />}
      <p className="small muted">
        {agent ? "Read from the contract just now." : "As the deployment sets them."} The contract
        enforces these: Kevin cannot change them, and a change takes HQ's signature.
      </p>
      <div className="actions">
        <Decide
          act={act}
          busy={busy}
          label="Confirm Kevin's limits"
          input={{ stage: 4, item: "limits", staff: "Linda Park" }}
          done={itemDone(stage, "limits")}
        />
      </div>
    </div>
  );
}

/** HQ asks for a change in plain words; Kevin drafts the owner call. Nothing is signed here. */
function PlainWords() {
  const [request, setRequest] = useState("raise Kevin's per-PO limit to $3,000");
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="plain-words"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        postPolicyDraft(request).then(setDraft, (err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
      }}
    >
      <label>
        <span className="small muted">Ask for a change in plain words</span>
        <input value={request} onChange={(e) => setRequest(e.target.value)} />
      </label>
      <button type="submit" className="btn sm">
        Ask Kevin to draft it
      </button>
      {draft && (
        <KevinNote alert={!draft.understood}>
          {draft.sentence}
          {draft.understood && " Draft only: HQ signs it; nothing was sent."}
        </KevinNote>
      )}
      {error && <p className="error">{error}</p>}
    </form>
  );
}

// ------------------------------------------------------------------ stage 5

function Order({ stage, go }: { stage: JourneyStage; go: (page: PageId) => void }) {
  return (
    <div className="stage-body">
      <ol className="order-steps">
        {stage.items.map((i) => (
          <li key={i.key} className={i.done ? "done" : undefined}>
            <span className="dot" aria-hidden="true" />
            <b>{i.label}</b> <small>{i.who}</small>
          </li>
        ))}
      </ol>
      <div className="actions">
        <button type="button" className="btn primary sm" onClick={() => go("overview")}>
          {stage.done ? "See the order on the Overview" : "Run the order from the Overview"}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stage 6

/** Each reconciliation check in staff words; the full line, with accounts and transactions, shows behind the curtain. */
export const RECON_PLAIN: Record<string, string> = {
  Inventory: "Stock agrees lot by lot, and so does its value.",
  "Purchase orders": "Every PO is in the ERP with the same total, supplier and outcome.",
  Payments: "Every payment matches an approved bill in the ERP.",
  Escrow: "The money set aside for orders matches the ERP's account.",
  "Contract POs not in Day One": "Test orders were cancelled or refunded; none was paid.",
  "General ledger": "Debits equal credits, and no approved bill is left unpaid.",
  "Supplier standing": "Who may be paid agrees with HQ's approved list.",
};

function BooksStage({
  stage,
  source,
  books,
  act,
  busy,
  curtain,
}: {
  stage: JourneyStage;
  source: Source;
  books: Books | null;
  act?: IntegrationActions;
  busy: boolean;
  curtain: boolean;
}) {
  const { value: rec } = useRead<Reconciliation>(
    () => readReconciliation(source),
    String(source.live),
  );
  return (
    <div className="stage-body">
      {books && <KevinNote>{books.sentences[0]}</KevinNote>}
      <div className="actions">
        <Decide
          act={act}
          busy={busy}
          label="The books are right"
          input={{ stage: 6, item: "books", staff: "Marcy Allen" }}
          done={itemDone(stage, "books")}
        />
      </div>
      {books?.held[0] && (
        <>
          <h4>Held for Marcy</h4>
          <ul className="review">
            <HeldInvoiceCard invoice={books.held[0]} curtain={curtain} />
          </ul>
          <div className="actions">
            <Decide
              act={act}
              busy={busy}
              label="Keep it held and tell Northgate"
              input={{
                stage: 6,
                item: "held",
                staff: "Marcy Allen",
                note: "Kept held; the order pays Northgate's account on file only.",
              }}
              done={itemDone(stage, "held")}
            />
          </div>
        </>
      )}
      <h4>Day One, the ERP and the contract</h4>
      {rec ? (
        <ul className="recon">
          {rec.checks.map((c) => (
            <li key={c.name}>
              <Pill tone={c.skipped ? "neutral" : c.ok ? "paid" : "refused"}>
                {c.skipped ? "skipped" : c.ok ? "match" : "mismatch"}
              </Pill>
              <b>{c.name}</b>
              <small>{curtain ? c.lines[0] : (RECON_PLAIN[c.name] ?? c.lines[0])}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Checking the recorded run against the ERP…</p>
      )}
      <p className="small muted">
        {curtain
          ? "The reconciliation of the recorded run with the ERP attached (npm run erp:reconcile)."
          : "Kevin checks Day One against the ERP and the payment rules, line by line."}
      </p>
      <div className="actions">
        <Decide
          act={act}
          busy={busy}
          label="The ERP agrees"
          input={{ stage: 6, item: "erp", staff: "Marcy Allen" }}
          done={itemDone(stage, "erp")}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stage 7

function Daily({ go }: { go: (page: PageId) => void }) {
  return (
    <div className="stage-body">
      <div className="tiles-2">
        {(
          [
            [
              "overview",
              "Overview",
              "The plant at a glance: batches, yield, stock below reorder, spend.",
            ],
            [
              "map",
              "Plant twin",
              "The three plants, the suppliers, the escrow and HQ, as orders move.",
            ],
            [
              "plants",
              "Three plants",
              "One ledger across the plants: moves Kevin proposes, what does not add up.",
            ],
            [
              "invoices",
              "Invoices",
              "Every bill matched to its PO and receipt, and the held invoice.",
            ],
          ] as const
        ).map(([page, title, text]) => (
          <button key={page} type="button" className="tile-link" onClick={() => go(page)}>
            <b>{title}</b>
            <small>{text}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function shortTime(iso: string) {
  const d = new Date(iso);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
