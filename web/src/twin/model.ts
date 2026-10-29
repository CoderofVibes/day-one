// The plant map's state, derived by a pure function from the run the screens already have: the
// steps shown so far and their transactions (src/run.ts), which is the event log in both modes
// (the recorded run on a static host, GET /api/run behind the API). The map never owns state:
// deriveTwinState(run, t) gives the same picture for the same run and the same step, so
// scrubbing, replaying and the live run all draw from one place (research 16).
//
// Plants A and C are already on Acme's systems and start online. Plant B starts grey; a
// department comes online the first time Kevin processes a record for it (FICTIONAL_DATA §1):
// the batch record for weigh & dispense, blending and compression; a purchase order for
// purchasing; the delivery for receiving; the QC decision for the lab. The warehouse waits for
// a count or import, packaging for a packaging record, and accounting for the acquirer's books
// (the ERP integration, OPEN_QUESTIONS #32), so the recorded run ends at 6 of 9, the number
// DEMO_SCRIPT step 14 expects.

import type { RunData, Step, Transaction } from "../run.ts";

export type FacilityId = "A" | "B" | "C";

export type DeptCode =
  | "receiving"
  | "warehouse"
  | "weigh_dispense"
  | "blending"
  | "compression"
  | "packaging"
  | "qc_lab"
  | "purchasing"
  | "accounting";

export type DeptStatus = "offline" | "onboarding" | "online";

export const DEPARTMENTS: { code: DeptCode; label: string; plants: FacilityId[] }[] = [
  { code: "receiving", label: "Receiving", plants: ["A", "B", "C"] },
  { code: "warehouse", label: "Warehouse", plants: ["A", "B", "C"] },
  { code: "weigh_dispense", label: "Weigh & Dispense", plants: ["A", "B"] },
  { code: "blending", label: "Blending", plants: ["A", "B"] },
  { code: "compression", label: "Compression", plants: ["A", "B"] },
  { code: "packaging", label: "Packaging", plants: ["A", "B", "C"] },
  { code: "qc_lab", label: "QC Lab", plants: ["A", "B"] },
  { code: "purchasing", label: "Purchasing", plants: ["A", "B"] },
  { code: "accounting", label: "Accounting", plants: ["A", "B", "C"] },
];

export const FACILITIES: { id: FacilityId; name: string; town: string }[] = [
  { id: "A", name: "Acme Riverside", town: "Riverside" },
  { id: "B", name: "Hollow Pine Tablet Co.", town: "Hollow Pine" },
  { id: "C", name: "Acme Lakeview", town: "Lakeview" },
];

/** What a tablet batch record covers at Plant B. */
const BATCH_RECORD_DEPTS: DeptCode[] = ["weigh_dispense", "blending", "compression"];

export type LotVisual = "quarantine" | "released" | "rejected";

export interface TwinLot {
  code: string;
  state: LotVisual;
  facility: FacilityId;
  department: DeptCode;
}

export interface Department {
  code: DeptCode;
  label: string;
  status: DeptStatus;
}

export interface Facility {
  id: FacilityId;
  name: string;
  town: string;
  departments: Department[];
  online: number;
  alerts: string[];
}

export type NodeRef =
  | { kind: "dept"; facility: FacilityId; dept: DeptCode }
  | { kind: "suppliers" }
  | { kind: "escrow" }
  | { kind: "hq" };

export type FlowStatus = "moving" | "arrived" | "held" | "refused" | "disputed";

export interface Flow {
  id: string;
  kind: "material" | "money";
  from: NodeRef;
  to: NodeRef;
  /** 0 at `from`, 1 at `to`; a shipment is halfway while it is on the road. */
  progress: number;
  /** The full line, for the caption. */
  label: string;
  /** A few characters for the map itself. */
  short: string;
  status: FlowStatus;
  /** Shown only behind the curtain. */
  chainTx?: { hash: string; status: string; error: string | null };
}

export interface TwinState {
  /** The step index the map shows. */
  t: number;
  facilities: Facility[];
  lots: TwinLot[];
  flows: Flow[];
  /** What the escrow holds right now, in cents. */
  escrowHeldCents: number;
  /** "Plant B: 6 of 9 departments online." (DEMO_SCRIPT step 14) */
  summary: string;
}

const RANK: Record<DeptStatus, number> = { offline: 0, onboarding: 1, online: 2 };

interface PendingFlow extends Omit<Flow, "progress"> {
  fromStep: number;
  toStep?: number;
  po?: string;
}

class Twin {
  private readonly plantB = new Map<DeptCode, DeptStatus>(
    DEPARTMENTS.filter((d) => d.plants.includes("B")).map((d) => [d.code, "offline"]),
  );
  private readonly vendors = new Map<string, string>();
  private readonly amounts = new Map<string, string>();
  private readonly flows: PendingFlow[] = [];
  private readonly lots: TwinLot[] = [];
  private readonly alerts: Record<FacilityId, string[]> = { A: [], B: [], C: [] };
  private escrowCents = 0;

  constructor(private readonly byHash: Map<string, Transaction>) {}

  /** A department only moves forward: offline → onboarding → online. */
  private light(dept: DeptCode, to: DeptStatus) {
    const now = this.plantB.get(dept) ?? "offline";
    if (RANK[to] > RANK[now]) this.plantB.set(dept, to);
  }

  apply(step: Step, i: number) {
    const { title } = step;
    const staff = step.staff.join(" ");

    if (title.startsWith("Upload "))
      for (const d of BATCH_RECORD_DEPTS) this.light(d, "onboarding");
    else if (title.endsWith(" confirms"))
      for (const d of BATCH_RECORD_DEPTS) this.light(d, "online");
    else if (title === "Discrepancy") this.discrepancy(staff, i);
    else if (title === "Forecast" || title === "Quotes") this.light("purchasing", "onboarding");

    for (const line of step.staff) {
      const m = /^(PO-\d+) to ([^,]+), (\$[\d,]+\.\d{2})/.exec(line);
      if (m?.[1] && m[2] && m[3]) {
        this.vendors.set(m[1], m[2]);
        this.amounts.set(m[1], m[3]);
      }
    }

    for (const c of step.chain) {
      const tx = c.tx ? this.byHash.get(c.tx) : undefined;
      if (!tx) continue;
      const po = /\b(PO-\d+)\b/.exec(c.line)?.[1];
      const chainTx = { hash: tx.tx, status: tx.status, error: tx.error };
      if (!po) continue;
      const vendor = this.vendors.get(po) ?? "the supplier";

      if (tx.events.includes("po_funded")) {
        const amount = dollars(
          /funded ([\d,]+\.\d{2}) DTUSD/.exec(c.line)?.[1],
          this.amounts.get(po),
        );
        this.light("purchasing", "online");
        this.drop((f) => f.po === po && f.status === "refused");
        this.flows.push({
          id: `fund-${po}`,
          kind: "money",
          from: { kind: "hq" },
          to: { kind: "escrow" },
          label: `${po} · ${amount} held`,
          short: `${po} ${amount}`,
          status: "held",
          fromStep: i,
          toStep: i,
          po,
          chainTx,
        });
        this.escrowCents += cents(amount);
        this.amounts.set(po, amount);
      } else if (tx.events.includes("po_refused")) {
        this.light("purchasing", "online");
        this.flows.push({
          id: `refused-${po}`,
          kind: "money",
          from: { kind: "hq" },
          to: { kind: "escrow" },
          label: `${po} · ${this.amounts.get(po) ?? ""} refused`.replace("  ", " "),
          short: `${po} refused`,
          status: "refused",
          fromStep: i,
          toStep: i,
          po,
          chainTx,
        });
      } else if (tx.events.includes("po_approved")) {
        const who = /Approved by ([^.]+)\./.exec(staff)?.[1] ?? "the director";
        this.alerts.B.push(`${po} approved by ${who}; Kevin retries within the approval.`);
      } else if (tx.events.includes("po_shipped")) {
        this.flows.push({
          id: `ship-${po}`,
          kind: "material",
          from: { kind: "suppliers" },
          to: { kind: "dept", facility: "B", dept: "receiving" },
          label: `${po} from ${vendor}`,
          short: po,
          status: "moving",
          fromStep: i,
          po,
          chainTx,
        });
      } else if (tx.events.includes("po_received")) {
        this.light("receiving", "online");
        const what = /Matches PO-\d+: ([^,.]+)/.exec(staff)?.[1];
        const ship = this.flows.find((f) => f.id === `ship-${po}`);
        if (ship) {
          ship.toStep = i;
          ship.status = "arrived";
          if (what) ship.label = `${po} · ${what} from ${vendor}`;
          ship.chainTx = chainTx;
        }
        const lot = /\bLot (\S+) is in quarantine/.exec(staff)?.[1];
        if (lot) {
          this.lots.push({ code: lot, state: "quarantine", facility: "B", department: "qc_lab" });
          this.light("qc_lab", "onboarding");
        }
      } else if (tx.events.includes("po_released")) {
        this.light("qc_lab", "online");
        this.decide(po, staff, "released");
        const paid = dollars(/([\d,]+\.\d{2}) DTUSD →/.exec(c.line)?.[1], this.amounts.get(po));
        this.flows.push({
          id: `paid-${po}`,
          kind: "money",
          from: { kind: "escrow" },
          to: { kind: "suppliers" },
          label: `${po} · ${paid} paid to ${vendor}`,
          short: `${paid} paid`,
          status: "arrived",
          fromStep: i,
          toStep: i,
          po,
          chainTx,
        });
      } else if (tx.method === "qc_reject" && tx.status === "success") {
        this.light("qc_lab", "online");
        this.decide(po, staff, "rejected");
        const back = this.amounts.get(po) ?? "";
        this.flows.push({
          id: `refund-${po}`,
          kind: "money",
          from: { kind: "escrow" },
          to: { kind: "hq" },
          label: `${po} · ${back} refunded`.replace("  ", " "),
          short: `${back} refunded`.trim(),
          status: "arrived",
          fromStep: i,
          toStep: i,
          po,
          chainTx,
        });
      }
    }
  }

  /** Plant A still books part of a lot that Plant B weighed in (FICTIONAL_DATA §8). */
  private discrepancy(staff: string, i: number) {
    const lot = /\blot (\S+),/.exec(staff)?.[1] ?? "a transferred lot";
    const m = /weighed in ([\d.]+ kg) of the ([\d.]+ kg) sent/.exec(staff);
    const label = m
      ? `${lot} · ${m[2]} sent, ${m[1]} weighed in`
      : `${lot} · transfer under review`;
    this.flows.push({
      id: `transfer-${lot}`,
      kind: "material",
      from: { kind: "dept", facility: "A", dept: "warehouse" },
      to: { kind: "dept", facility: "B", dept: "warehouse" },
      label,
      short: lot,
      status: "disputed",
      fromStep: i,
      toStep: i,
    });
    const phantom = /shows ([\d.]+ kg) of lot/.exec(staff)?.[1];
    this.alerts.A.push(
      phantom
        ? `${phantom} of ${lot} on the books is not there; adjustment proposed for review.`
        : `${lot}: adjustment proposed for review.`,
    );
  }

  /** QC decided on the quarantined lot: the escrow for the PO is paid out or refunded. */
  private decide(po: string, staff: string, state: "released" | "rejected") {
    const code = /\blot (\S+?)\.?$/.exec(staff)?.[1];
    const lot =
      this.lots.find((l) => l.code === code) ?? this.lots.find((l) => l.state === "quarantine");
    if (lot) lot.state = state;
    const held = this.flows.find((f) => f.po === po && f.status === "held");
    if (held) {
      this.escrowCents -= cents(this.amounts.get(po) ?? "$0.00");
      this.drop((f) => f === held);
    }
  }

  private drop(test: (f: PendingFlow) => boolean) {
    for (let i = this.flows.length - 1; i >= 0; i--) {
      const f = this.flows[i];
      if (f && test(f)) this.flows.splice(i, 1);
    }
  }

  state(t: number): TwinState {
    const facilities = FACILITIES.map(({ id, name, town }) => {
      const departments = DEPARTMENTS.filter((d) => d.plants.includes(id)).map((d) => ({
        code: d.code,
        label: d.label,
        status: id === "B" ? (this.plantB.get(d.code) ?? "offline") : ("online" as DeptStatus),
      }));
      return {
        id,
        name,
        town,
        departments,
        online: departments.filter((d) => d.status === "online").length,
        alerts: [...this.alerts[id]],
      };
    });
    const b = facilities.find((f) => f.id === "B");
    return {
      t,
      facilities,
      lots: this.lots.map((l) => ({ ...l })),
      flows: this.flows.map(({ fromStep, toStep, po: _po, ...f }) => ({
        ...f,
        progress: progress(f.kind, fromStep, toStep, t),
      })),
      escrowHeldCents: this.escrowCents,
      summary: `Plant B: ${b?.online ?? 0} of ${b?.departments.length ?? 0} departments online.`,
    };
  }
}

/** A money flow lands within its step; a shipment is halfway while it is on the road. */
function progress(
  kind: Flow["kind"],
  fromStep: number,
  toStep: number | undefined,
  t: number,
): number {
  if (toStep === undefined) return kind === "material" ? 0.5 : 1;
  if (toStep <= fromStep) return 1;
  const p = Math.min(1, Math.max(0, (t - fromStep) / (toStep - fromStep)));
  return 0.5 + 0.5 * p;
}

function dollars(amount: string | undefined, fallback: string | undefined): string {
  if (amount) return `$${amount}`;
  return fallback ?? "$0.00";
}

function cents(dollarsText: string): number {
  return Math.round(Number(dollarsText.replace(/[$,]/g, "")) * 100) || 0;
}

export function formatCents(c: number): string {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/**
 * The map at step `t` of the run: everything up to and including that step has happened.
 * `t` may be fractional while a shipment is on the road; the picture is otherwise discrete.
 */
export function deriveTwinState(run: RunData, t: number): TwinState {
  const last = run.steps.length - 1;
  const upTo = Math.min(Math.floor(Math.max(0, t)), last);
  const twin = new Twin(new Map(run.transactions.map((tx) => [tx.tx, tx])));
  run.steps.slice(0, upTo + 1).forEach((step, i) => {
    twin.apply(step, i);
  });
  return twin.state(Math.min(Math.max(0, t), last));
}

const STATUS_WORD: Record<FlowStatus, string> = {
  moving: "on the road",
  arrived: "arrived",
  held: "in escrow",
  refused: "refused by the contract",
  disputed: "under review",
};

/** The same picture as plain text, for the caption under the map and for machine readers. */
export function formatTwinState(state: TwinState, curtain = false): string[] {
  const lines: string[] = [];
  for (const f of state.facilities) {
    const total = f.departments.length;
    if (f.id === "B") {
      const on = f.departments.filter((d) => d.status === "online").map((d) => d.label);
      const warming = f.departments.filter((d) => d.status === "onboarding").map((d) => d.label);
      let line = `Plant B (${f.name}): ${f.online} of ${total} departments online`;
      if (on.length) line += `: ${on.join(", ")}`;
      if (warming.length) line += `. Coming online: ${warming.join(", ")}`;
      lines.push(`${line}.`);
    } else {
      lines.push(`Plant ${f.id} (${f.name}): all ${total} departments online.`);
    }
    for (const a of f.alerts) lines.push(`Plant ${f.id}: ${a}`);
  }
  for (const l of state.lots) {
    const where = state.facilities.find((f) => f.id === l.facility)?.town ?? `Plant ${l.facility}`;
    lines.push(
      l.state === "quarantine"
        ? `Lot ${l.code} is in quarantine at ${where}, awaiting QC.`
        : `Lot ${l.code} ${l.state} by QC at ${where}.`,
    );
  }
  for (const f of state.flows) {
    const tx = curtain && f.chainTx ? ` (tx ${f.chainTx.hash.slice(0, 8)}…)` : "";
    lines.push(
      `${f.kind === "money" ? "Money" : "Material"}: ${f.label}, ${STATUS_WORD[f.status]}${tx}.`,
    );
  }
  if (state.escrowHeldCents > 0) lines.push(`Escrow holds ${formatCents(state.escrowHeldCents)}.`);
  return lines;
}
