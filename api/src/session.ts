// One demo run behind the HTTP API: the phase machine from agents/kevin, advanced by staff
// actions one at a time, and a snapshot of it for the screens. Replay by default (the recorded
// testnet run, no keys); live when started with --live. Actions run one after another, so two
// clicks at once cannot interleave the run.

import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { briefHtml, morningBrief } from "@day-one/kevin/brief";
import { type DemoPhase, type DemoStep, formatTranscript, startDemo } from "@day-one/kevin/demo";
import { reviewDiscrepancy } from "@day-one/kevin/discrepancies";
import {
  confirmInboxItem,
  type InboxRead,
  type InboxRow,
  inboxItems,
  inboxRead,
  markInboxConfirmed,
  readInboxFile,
  waitingInboxItem,
} from "@day-one/kevin/inbox";
import { massBalance, proposeWasteCorrections } from "@day-one/kevin/massBalance";
import {
  approveTransfer,
  dismissTransfer,
  receiveTransfer,
  suggestTransfers,
  transfersInTransit,
} from "@day-one/kevin/transferSuggestions";
import { readAttestationFixture, recordedReceipts } from "@day-one/server/attestation/fixture";
import type { AttestationResult } from "@day-one/server/attestation/types";
import { verifyAttestation } from "@day-one/server/attestation/verify";
import { explorerUrl } from "@day-one/server/chain/client";
import { explainFailure } from "@day-one/server/chain/explain";
import { LiveTransport } from "@day-one/server/chain/live";
import { type PolicyView, readPolicy, type ViewFn } from "@day-one/server/chain/policy";
import { summarizeChainTx } from "@day-one/server/chain/summary";
import { books, booksCsv } from "@day-one/server/ledger/books";
import { plantInventory } from "@day-one/server/ledger/inventory";
import { approvals, chainTx, staff, vendors } from "@day-one/server/ledger/schema";
import { eq } from "drizzle-orm";
import {
  type DemoEnv,
  type DemoEnvOptions,
  loadBatchRecord,
  loadPackingSlip,
  openDemoEnv,
  pageOf,
} from "./env.ts";
import { type FolderWatch, watchFolder } from "./watcher.ts";

export interface StepView {
  step: number;
  title: string;
  staff: string[];
  chain: { line: string; tx: string | null }[];
}

export interface TransactionView {
  tx: string;
  url: string | null;
  method: string;
  contract: string;
  signer: string;
  paidBy: string;
  status: string;
  error: string | null;
  events: string[];
}

export interface NextAction {
  phase: DemoPhase;
  /** Who acts next, or null when Kevin or nobody does. */
  who: string | null;
  role: string | null;
  /** What they do, in their words. */
  action: string;
  /** What the action is about: the batch number, the PO number or the lot code. */
  subject: string | null;
  /** The inputs a screen can offer: photos on file, YES/NO, slip numbers, release/reject. */
  choices: string[];
}

export interface RunState {
  mode: "replay" | "live";
  network: string;
  next: NextAction;
  stopped: string | null;
  /** When the run stopped on a failure we can explain: what happened and what to do, plainly. */
  help: string | null;
  /** Set once the run has finished. */
  ok: boolean | null;
  summary: {
    transactions: number;
    refusedByDesign: number;
    refusedOther: number;
    failed: number;
  } | null;
  steps: StepView[];
  transactions: TransactionView[];
  approvals: { request: string; response: string | null }[];
  people: { name: string; role: string }[];
  /** The recorded run's attestation (replay); null in a live run, whose answers are new. */
  attestation: AttestationResult | null;
}

const TX = /\(tx ([1-9A-HJ-NP-Za-km-z]{43,44})\)/;

/** The events that change the policy (CONTRACTS §5); HQ's view lists the ones this run logged. */
const POLICY_EVENTS = new Set([
  "agent_policy_set",
  "category_cap_set",
  "supplier_set",
  "roles_set",
  "agent_paused",
  "agent_resumed",
]);
const CATEGORIES = ["raw_material", "packaging", "lab_chemical"];

export interface PolicyChange {
  method: string;
  signer: string;
  tx: string;
  url: string | null;
  events: string[];
}
/** HQ's view: the policy the contract enforces now, or why it could not be read. */
export type PolicyState =
  | {
      reachable: true;
      policy: PolicyView;
      /** Staff and vendor names by NEAR account, so the screen shows people, not accounts. */
      names: Record<string, string>;
      history: PolicyChange[];
    }
  | { reachable: false; error: string; history: PolicyChange[] };

export interface SessionExtras {
  /** View calls on the policy contract; by default keyless calls on the network. */
  policyView?: ViewFn;
  /** The watched batch-record folder; none unless given (npm run api watches data/inbox/). */
  inbox?: {
    dir: string;
    stableMs?: number;
    pollMs?: number;
    /** Each file Kevin read, as it lands. */
    onRead?: (read: InboxRead) => void;
    onError?: (error: unknown, name: string) => void;
  };
}

/** The review queue as Ray's screen draws it. */
export interface InboxState {
  /** The watched folder, relative to the repository; null when nothing is watched. */
  folder: string | null;
  items: ReturnType<typeof inboxItems>;
}

export class DemoSession {
  private env!: DemoEnv;
  private machine!: ReturnType<typeof startDemo>;
  private queue: Promise<unknown> = Promise.resolve();
  private attestation: AttestationResult | null = null;
  private watch: FolderWatch | null = null;

  constructor(
    private readonly options: DemoEnvOptions = {},
    private readonly extras: SessionExtras = {},
  ) {}

  /** Seeds a fresh ledger and plays step 0; the folder is read again into the new ledger. */
  async start() {
    this.watch?.stop();
    this.watch = null;
    this.env = await openDemoEnv(this.options);
    this.machine = startDemo(this.env.deps);
    const fixture = this.env.live ? null : readAttestationFixture(this.env.root);
    this.attestation = fixture
      ? await verifyAttestation(
          fixture,
          recordedReceipts(this.env.root, ["data/replay/demo-llm.json"]),
        )
      : null;
    await this.machine.load();
    this.watchInbox();
    return this;
  }

  /** Kevin reads every scan that settles in the watched folder into the review queue. */
  private watchInbox() {
    const inbox = this.extras.inbox;
    if (!inbox) return;
    const env = this.env;
    this.watch = watchFolder({
      dir: inbox.dir,
      ...(inbox.stableMs === undefined ? {} : { stableMs: inbox.stableMs }),
      ...(inbox.pollMs === undefined ? {} : { pollMs: inbox.pollMs }),
      onFile: async (path) => {
        const read = await readInboxFile(
          env.db,
          env.inboxLlm,
          { path: relative(env.root, path).split(sep).join("/"), bytes: readFileSync(path) },
          env.clock(),
        );
        // A read that finishes after "Start over" belongs to the old ledger; nobody sees it.
        if (env === this.env) inbox.onRead?.(read);
      },
      ...(inbox.onError ? { onError: inbox.onError } : {}),
    });
  }

  /** The review queue; `scan` waits for files that have settled in the folder to be read. */
  async inbox(scan = false): Promise<InboxState> {
    if (scan) await this.watch?.scan();
    const dir = this.extras.inbox?.dir;
    return {
      folder: dir ? relative(this.env.root, dir).split(sep).join("/") : null,
      items: inboxItems(this.env.db),
    };
  }

  /** Stops watching the folder (the server is closing). */
  close() {
    this.watch?.stop();
    this.watch = null;
  }

  reset() {
    return this.run(() => this.start().then(() => this.machine.steps));
  }

  get live() {
    return this.env.live;
  }

  /** Step 1: the purchaser's photo, as bytes or as a committed file under data/batch-records/. */
  upload(page: { bytes: Buffer; name?: string } | { file: string }) {
    return this.run(() =>
      this.machine.upload(
        "file" in page
          ? loadBatchRecord(this.env.root, page.file)
          : pageOf(`uploads/${page.name ?? "batch-record.jpg"}`, page.bytes),
      ),
    );
  }

  /**
   * Step 2, then Kevin's follow-up (steps 4–7). A record waiting in the inbox is confirmed from
   * there, with the purchaser's answers to its flags (`resolutions`, by field path).
   */
  confirm(batchNo: string, staffName?: string, resolutions?: Record<string, string>) {
    return this.run(async () => {
      const item = this.machine.draft ? undefined : waitingInboxItem(this.env.db, batchNo);
      if (item) return this.confirmFromInbox(item, staffName, resolutions ?? {});
      if (resolutions && Object.keys(resolutions).length) {
        throw new SessionError(400, `${batchNo} is not waiting in the inbox; it takes no answers`);
      }
      const draft = this.machine.draft;
      if (draft && draft.batchNo !== batchNo) {
        throw new SessionError(400, `the draft waiting for confirmation is ${draft.batchNo}`);
      }
      const confirmed = await this.machine.confirm(staffName);
      if (this.machine.stopped) return confirmed;
      return [...confirmed, ...(await this.machine.purchase())];
    });
  }

  /**
   * The run's own page (the recorded BR-B-1045, by hash) goes through the run when it is the
   * run's turn: Ray's confirm is the upload and the confirm, and Kevin goes on to buy. Any other
   * record posts on its own, at any point of the run, and answers with its confirm as a step
   * that is not part of the run's transcript.
   */
  private async confirmFromInbox(
    item: InboxRow,
    staffName = "Ray Delgado",
    resolutions: Record<string, string>,
  ): Promise<DemoStep[]> {
    const { db, deps } = this.env;
    const staffId = this.staffId(staffName);
    const runsOwn =
      this.machine.next === "upload" &&
      item.fileSha256 === deps.batchRecord.sha256 &&
      Object.keys(resolutions).length === 0;
    if (runsOwn) {
      const page = { ...deps.batchRecord, file: item.sourceFile };
      const uploaded = await this.machine.upload(page, inboxRead(item));
      if (this.machine.next !== "confirm") return uploaded;
      const confirmed = await this.machine.confirm(staffName);
      const step = confirmed.find((s) => s.step === 2);
      if (step && item.batchNo) {
        markInboxConfirmed(db, item.id, {
          batchNo: item.batchNo,
          staffId,
          now: this.env.clock(),
          outcome: step.staff.join(" "),
        });
      }
      if (this.machine.stopped) return [...uploaded, ...confirmed];
      return [...uploaded, ...confirmed, ...(await this.machine.purchase())];
    }
    const done = await confirmInboxItem(
      {
        db,
        // A replay has no recorded anchor for this record; a live run anchors it as Kevin.
        ...(this.env.live ? { chain: deps.chain } : {}),
        kevin: deps.kevin,
        policyContract: deps.policyContract,
        ...(deps.erp ? { erp: deps.erp } : {}),
      },
      item.id,
      { staffId, now: this.env.clock(), salt: randomBytes(16).toString("hex"), resolutions },
    );
    const step: DemoStep = {
      step: 2,
      title: `${staffName.split(" ")[0]} confirms ${done.confirmation.review.batchNo}`,
      staff: done.staff,
      chain: done.chain,
    };
    if (done.erp.length) step.erp = done.erp;
    return [step];
  }

  /** Steps 8–9: a text from the approver's phone. */
  message(from: string, text: string) {
    return this.run(() => this.machine.reply(from, text));
  }

  /** Step 10: receiving's packing slip, by its number. */
  delivery(slipNo: string, receiverName?: string) {
    return this.run(() =>
      this.machine.receive(loadPackingSlip(this.env.root, slipNo), receiverName),
    );
  }

  /** Steps 11–12 and the summary. */
  qcDecision(lotCode: string, decision: "release" | "reject", qcName?: string) {
    return this.run(async () => {
      const decided = await this.machine.qc(decision, lotCode, qcName);
      const before = this.machine.steps.length;
      this.machine.finish();
      return [...decided, ...this.machine.steps.slice(before)];
    });
  }

  transcript() {
    return formatTranscript(this.env.db, this.machine.steps);
  }

  /** What each plant holds and every transfer discrepancy: the three-facility view. */
  inventory() {
    return plantInventory(this.env.db);
  }

  /** Issued against tablets, QC samples and waste for every confirmed batch, with Kevin's line. */
  massBalance() {
    return massBalance(this.env.db);
  }

  /** Kevin's waste corrections for flagged batches, for the plant to review; ledger only. */
  proposeWasteCorrections() {
    return this.run(async () => proposeWasteCorrections(this.env.db));
  }

  /** Spare stock at one plant that covers another's reorder, before anyone buys (FEATURES_V2 §3). */
  transferSuggestions() {
    const suggestions = suggestTransfers(this.env.db, { now: this.env.clock() });
    return {
      suggestions,
      sentences: suggestions.map((s) => s.sentence),
      inTransit: transfersInTransit(this.env.db),
    };
  }

  /**
   * A person approves or dismisses Kevin's proposed move: ledger events only, no chain call, so
   * it never disturbs a replay. HQ's integration lead decides unless a name is given.
   */
  decideTransfer(key: string, decision: "approve" | "dismiss", staffName?: string) {
    return this.run(async () => {
      const input = { staffId: this.staffId(staffName), now: this.env.clock() };
      try {
        const done =
          decision === "approve"
            ? approveTransfer(this.env.db, key, input)
            : dismissTransfer(this.env.db, key, input);
        return { sentence: done.sentence, ...this.transferSuggestions() };
      } catch (error) {
        throw new SessionError(409, error instanceof Error ? error.message : String(error));
      }
    });
  }

  /** The receiving plant books an approved transfer in, at the count it took. */
  receiveTransfer(transferNo: string, receivedBase?: number, staffName?: string) {
    return this.run(async () => {
      const input = {
        staffId: this.staffId(staffName),
        now: this.env.clock(),
        ...(receivedBase === undefined ? {} : { receivedBase }),
      };
      try {
        const done = receiveTransfer(this.env.db, transferNo, input);
        return { ...done, ...this.transferSuggestions() };
      } catch (error) {
        throw new SessionError(409, error instanceof Error ? error.message : String(error));
      }
    });
  }

  private staffId(staffName = "Jordan Pike") {
    const row = this.env.db
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.name, staffName))
      .get();
    if (!row) throw new SessionError(400, `${staffName} is not on the staff list`);
    return row.id;
  }

  /** The bookkeeper export: settled POs, price-drift alerts and Kevin's note (FEATURES_V2 §2). */
  books() {
    return books(this.env.db);
  }

  booksCsv() {
    return booksCsv(this.env.db);
  }

  /** Kevin's 5am brief for a plant at the run's clock; the acquired plant by default. */
  brief(facility?: string) {
    try {
      return morningBrief(this.env.db, {
        now: this.env.clock(),
        ...(facility ? { facility } : {}),
      });
    } catch (error) {
      throw new SessionError(400, (error as Error).message);
    }
  }

  briefHtml(facility?: string) {
    return briefHtml(this.brief(facility));
  }

  /**
   * HQ's read of the policy the contract enforces right now (view calls, no keys, the network
   * even in replay) and the policy changes this run has logged. Never cached: HQ sees the chain.
   */
  async policy(): Promise<PolicyState> {
    const { db, accounts } = this.env;
    const history: PolicyChange[] = db
      .select()
      .from(chainTx)
      .all()
      .filter((r) => r.txHash && eventsOf(r.eventsJson).some((e) => POLICY_EVENTS.has(e)))
      .map((r) => ({
        method: r.method,
        signer: r.signerId,
        tx: r.txHash ?? "",
        url: explorerUrl(r.network, r.txHash),
        events: eventsOf(r.eventsJson),
      }));
    const view = this.extras.policyView ?? this.keylessView();
    const vendorRows = db.select().from(vendors).all();
    try {
      const policy = await readPolicy(view, {
        contract: accounts.spendPolicy,
        network: accounts.network,
        agent: `kevin.plant-b.${accounts.root}`,
        plant: `plant-b.${accounts.root}`,
        categories: CATEGORIES,
        suppliers: vendorRows.flatMap((v) => (v.nearAccountId ? [v.nearAccountId] : [])),
      });
      const names: Record<string, string> = {};
      for (const v of vendorRows) if (v.nearAccountId) names[v.nearAccountId] = v.name;
      for (const s of db.select().from(staff).all()) {
        if (s.nearAccountId) names[s.nearAccountId] = s.name;
      }
      return { reachable: true, policy, names, history };
    } catch (error) {
      return { reachable: false, error: (error as Error).message, history };
    }
  }

  private keylessView(): ViewFn {
    const { accounts } = this.env;
    const chain = new LiveTransport(accounts.network, () => {
      throw new Error("HQ's policy view signs nothing");
    });
    return (method, args = {}) => chain.view({ contractId: accounts.spendPolicy, method, args });
  }

  /**
   * A review of a proposed adjustment: a ledger event by the reviewer, no chain call, so it
   * never disturbs a replay. HQ's integration lead reviews unless a name is given.
   */
  review(discrepancyId: number, decision: "apply" | "dismiss", staffName = "Jordan Pike") {
    return this.run(async () => {
      const staffId = this.staffId(staffName);
      try {
        return reviewDiscrepancy(this.env.db, discrepancyId, {
          staffId,
          decision,
          now: this.env.clock(),
        });
      } catch (error) {
        throw new SessionError(409, error instanceof Error ? error.message : String(error));
      }
    });
  }

  state(): RunState {
    const { db } = this.env;
    const m = this.machine;
    const rows = db.select().from(chainTx).all();
    const finished = m.next === "done";
    const summary = finished ? summarizeChainTx(rows) : null;
    return {
      mode: this.env.live ? "live" : "replay",
      network: this.env.accounts.network,
      next: this.nextAction(),
      stopped: m.stopped,
      help: m.stopped ? helpFor(m.stopped, rows) : null,
      ok:
        finished && summary
          ? !m.stopped && summary.failed === 0 && summary.refusedOther === 0
          : null,
      summary,
      steps: m.steps.map((s) => stepView(s)),
      transactions: rows
        .filter((r) => r.txHash)
        .map((r) => ({
          tx: r.txHash ?? "",
          url: explorerUrl(r.network, r.txHash),
          method: r.method,
          contract: r.receiverId,
          signer: r.signerId,
          paidBy: r.viaRelayer ? this.env.deps.relayer : r.signerId,
          status: r.status,
          error: r.errorMessage,
          events: eventsOf(r.eventsJson),
        })),
      approvals: db
        .select({ request: approvals.requestText, response: approvals.responseText })
        .from(approvals)
        .all(),
      attestation: this.attestation,
      people: db
        .select({ name: staff.name, role: staff.role })
        .from(staff)
        .all()
        .map((p) => ({ name: p.name, role: p.role })),
    };
  }

  /** Who the run waits for, so a screen can show the right person the right buttons. */
  private nextAction(): NextAction {
    const m = this.machine;
    const db = this.env.db;
    const role = (name: string) =>
      db.select({ role: staff.role }).from(staff).where(eq(staff.name, name)).get()?.role ?? null;
    const files = (dir: string, suffix: string) =>
      readdirSync(join(this.env.root, dir))
        .filter((f) => f.endsWith(suffix))
        .map((f) => f.slice(0, -suffix.length))
        .sort();
    const nobody = (phase: DemoPhase, action: string, choices: string[] = []) => ({
      phase,
      who: null,
      role: null,
      action,
      subject: null,
      choices,
    });
    switch (m.next) {
      case "load":
        return nobody("load", "Loading the plant's records.");
      case "upload":
        return {
          phase: "upload",
          who: "Ray Delgado",
          role: role("Ray Delgado"),
          action: "Upload a batch record.",
          subject: null,
          choices: files("data/batch-records", ".jpg").map((f) => `${f}.jpg`),
        };
      case "confirm":
        return {
          phase: "confirm",
          who: "Ray Delgado",
          role: role("Ray Delgado"),
          action: `Confirm ${m.draft?.batchNo ?? "the batch record"}.`,
          subject: m.draft?.batchNo ?? null,
          choices: m.draft ? [m.draft.batchNo] : [],
        };
      case "purchase":
        return nobody("purchase", "Kevin checks stock and orders.");
      case "reply": {
        const open = db
          .select({ request: approvals.requestText })
          .from(approvals)
          .where(eq(approvals.state, "requested"))
          .all()
          .at(-1);
        const po = /PO-(\d+)/.exec(open?.request ?? "")?.[1];
        return {
          phase: "reply",
          who: "Linda Park",
          role: role("Linda Park"),
          action: po ? `Reply YES ${po} or NO ${po}.` : "Reply to Kevin's text.",
          subject: po ? `PO-${po}` : null,
          choices: po ? [`YES ${po}`, `NO ${po}`] : [],
        };
      }
      case "receive":
        return {
          phase: "receive",
          who: "Tommy Reyes",
          role: role("Tommy Reyes"),
          action: "Photograph the packing slip.",
          subject: null,
          choices: files("data/packing-slips", ".truth.json"),
        };
      case "qc":
        return {
          phase: "qc",
          who: "Priya Natarajan",
          role: role("Priya Natarajan"),
          action: m.quarantined ? `Release or reject lot ${m.quarantined}.` : "Decide on the lot.",
          subject: m.quarantined,
          choices: ["release", "reject"],
        };
      case "finish":
        return nobody("finish", "Summing up.");
      default:
        return nobody("done", "The run is complete.", ["reset"]);
    }
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action, action);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** An action the API cannot take as asked; `status` is the HTTP status it maps to. */
export class SessionError extends Error {
  override name = "SessionError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function stepView(s: DemoStep): StepView {
  return {
    step: s.step,
    title: s.title,
    staff: s.staff,
    chain: s.chain.map((line) => ({ line, tx: TX.exec(line)?.[1] ?? null })),
  };
}

/**
 * Why a stopped run stopped, in plain words: the last call that failed (the network, a key, the
 * relayer's balance) explains it better than the step's own line ("PO-1041 was not funded").
 */
export function helpFor(
  stopped: string,
  rows: { status: string; errorMessage: string | null }[],
): string | null {
  const failed = rows.filter((r) => r.status === "failed" || r.status === "refused").at(-1);
  const help = explainFailure(failed?.errorMessage) ?? explainFailure(stopped);
  return help ? `${help.what} ${help.fix}` : null;
}

function eventsOf(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { event?: string }[];
    return Array.isArray(parsed) ? parsed.map((e) => e.event ?? "").filter(Boolean) : [];
  } catch {
    return [];
  }
}
