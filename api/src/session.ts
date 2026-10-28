// One demo run behind the HTTP API: the phase machine from agents/kevin, advanced by staff
// actions one at a time, and a snapshot of it for the screens. Replay by default (the recorded
// testnet run, no keys); live when started with --live. Actions run one after another, so two
// clicks at once cannot interleave the run.

import { type DemoPhase, type DemoStep, formatTranscript, startDemo } from "@day-one/kevin/demo";
import { explorerUrl } from "@day-one/server/chain/client";
import { approvals, chainTx, staff } from "@day-one/server/ledger/schema";
import { eq } from "drizzle-orm";
import {
  type DemoEnv,
  type DemoEnvOptions,
  loadBatchRecord,
  loadPackingSlip,
  openDemoEnv,
  pageOf,
} from "./env.ts";

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
}

export interface RunState {
  mode: "replay" | "live";
  network: string;
  next: NextAction;
  stopped: string | null;
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
}

const TX = /\(tx ([1-9A-HJ-NP-Za-km-z]{43,44})\)/;

export class DemoSession {
  private env!: DemoEnv;
  private machine!: ReturnType<typeof startDemo>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: DemoEnvOptions = {}) {}

  /** Seeds a fresh ledger and plays step 0. */
  async start() {
    this.env = await openDemoEnv(this.options);
    this.machine = startDemo(this.env.deps);
    await this.machine.load();
    return this;
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

  /** Step 2, then Kevin's follow-up (steps 4–7). */
  confirm(batchNo: string, staffName?: string) {
    return this.run(async () => {
      const draft = this.machine.draft;
      if (draft && draft.batchNo !== batchNo) {
        throw new SessionError(400, `the draft waiting for confirmation is ${draft.batchNo}`);
      }
      const confirmed = await this.machine.confirm(staffName);
      if (this.machine.stopped) return confirmed;
      return [...confirmed, ...(await this.machine.purchase())];
    });
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

  state(): RunState {
    const { db } = this.env;
    const m = this.machine;
    const rows = db.select().from(chainTx).all();
    const finished = m.next === "done";
    const refused = rows.filter((r) => r.status === "refused");
    const summary = finished
      ? {
          transactions: rows.length,
          refusedByDesign: refused.filter((r) =>
            r.errorMessage?.endsWith("director approval required."),
          ).length,
          refusedOther: refused.filter(
            (r) => !r.errorMessage?.endsWith("director approval required."),
          ).length,
          failed: rows.filter((r) => r.status === "failed").length,
        }
      : null;
    return {
      mode: this.env.live ? "live" : "replay",
      network: this.env.accounts.network,
      next: this.nextAction(),
      stopped: m.stopped,
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
      people: db
        .select({ name: staff.name, role: staff.role })
        .from(staff)
        .all()
        .map((p) => ({ name: p.name, role: p.role })),
    };
  }

  /** Who the run waits for, so a screen can show the right person the right button. */
  private nextAction(): NextAction {
    const m = this.machine;
    const person = (name: string) =>
      this.env.db.select({ role: staff.role }).from(staff).where(eq(staff.name, name)).get()
        ?.role ?? null;
    switch (m.next) {
      case "load":
        return { phase: "load", who: null, role: null, action: "Loading the plant's records." };
      case "upload":
        return {
          phase: "upload",
          who: "Ray Delgado",
          role: person("Ray Delgado"),
          action: "Upload a batch record.",
        };
      case "confirm":
        return {
          phase: "confirm",
          who: "Ray Delgado",
          role: person("Ray Delgado"),
          action: `Confirm ${m.draft?.batchNo ?? "the batch record"}.`,
        };
      case "purchase":
        return {
          phase: "purchase",
          who: null,
          role: null,
          action: "Kevin checks stock and orders.",
        };
      case "reply":
        return {
          phase: "reply",
          who: "Linda Park",
          role: person("Linda Park"),
          action: "Reply YES 1042 or NO 1042.",
        };
      case "receive":
        return {
          phase: "receive",
          who: "Tommy Reyes",
          role: person("Tommy Reyes"),
          action: "Photograph the packing slip.",
        };
      case "qc":
        return {
          phase: "qc",
          who: "Priya Natarajan",
          role: person("Priya Natarajan"),
          action: `Release or reject lot ${m.quarantined ?? ""}.`.replace(" .", "."),
        };
      case "finish":
        return { phase: "finish", who: null, role: null, action: "Summing up." };
      default:
        return { phase: "done", who: null, role: null, action: "The run is complete." };
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

function eventsOf(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { event?: string }[];
    return Array.isArray(parsed) ? parsed.map((e) => e.event ?? "").filter(Boolean) : [];
  } catch {
    return [];
  }
}
