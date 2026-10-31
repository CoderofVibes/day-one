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
//
// The recorded group purchase (docs/GROUP_BUY.md) is the same shape of run and draws through
// the same function: a pooled PO is one coin per plant share, each leaving its own plant's
// purchasing roof for the vault, refused and approved per plant, held as one escrow and paid
// once; the hub's receipt earmarks the other plant's share, which leaves by truck on release.

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

/** One plant's share of a pooled purchase order (docs/GROUP_BUY.md), charged to that plant. */
export interface PooledShare {
  plant: FacilityId;
  /** The whole order: "$9,490.00". */
  total: string;
  /** The director who approved this plant's share, once they have. */
  approvedBy?: string;
}

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
  /** Set on each coin of a pooled PO; a plain PO's money has none. */
  share?: PooledShare;
}

export type QuoteStanding = "selected" | "runner-up" | "excluded";

/** A supplier's quote and standing, from the Quotes step (FICTIONAL_DATA §5). */
export interface TwinQuote {
  supplier: string;
  /** "$7.10/kg" */
  price: string;
  /** "7 days", when the line gives one. */
  leadTime?: string;
  standing: QuoteStanding;
  /** Why it was excluded: "vendor not qualified". */
  reason?: string;
  /** The supplier agent's quote anchor, shown only behind the curtain. */
  chainTx?: { hash: string; status: string; error: string | null; signer: string };
}

export interface TwinState {
  /** The step index the map shows. */
  t: number;
  facilities: Facility[];
  lots: TwinLot[];
  flows: Flow[];
  /** The supplier quotes once Kevin has them; empty before. The 2D map does not draw these. */
  quotes: TwinQuote[];
  /** What the escrow holds right now, in cents. */
  escrowHeldCents: number;
  /** "Plant B: 6 of 9 departments online." (DEMO_SCRIPT step 14) */
  summary: string;
  /** The pooled PO once the run has one ("PO-G-2001"); the money then moves as plant shares. */
  pooled?: string;
}

/** How the run starts: Plant B grey on day one (the demo), or every plant online (the group run). */
export interface TwinOptions {
  plantB?: "offline" | "online";
}

const RANK: Record<DeptStatus, number> = { offline: 0, onboarding: 1, online: 2 };

/** A purchase order number: PO-1042, or PO-G-2001 for a pooled order. */
const PO_RE = /\b(PO-[A-Z0-9-]*\d)\b/;
const PLANT_RE = /\bPlant ([ABC])\b/;

interface PendingFlow extends Omit<Flow, "progress"> {
  fromStep: number;
  toStep?: number;
  po?: string;
}

class Twin {
  private readonly plantB: Map<DeptCode, DeptStatus>;
  private readonly vendors = new Map<string, string>();
  private readonly amounts = new Map<string, string>();
  /** A pooled PO's shares by plant, from the allocation line or the funding call. */
  private readonly shares = new Map<string, PooledShare[]>();
  private readonly shareAmounts = new Map<string, Map<FacilityId, string>>();
  /** What the hub's receipt set aside for another plant: "700 kg" for Plant A. */
  private readonly earmarks = new Map<string, { qty: string; plant: FacilityId }>();
  private readonly flows: PendingFlow[] = [];
  private readonly lots: TwinLot[] = [];
  private readonly alerts: Record<FacilityId, string[]> = { A: [], B: [], C: [] };
  private readonly quotes: TwinQuote[] = [];
  private escrowCents = 0;
  private pooled: string | undefined;

  constructor(
    private readonly byHash: Map<string, Transaction>,
    private readonly options: TwinOptions,
  ) {
    this.plantB = new Map(
      DEPARTMENTS.filter((d) => d.plants.includes("B")).map((d) => [
        d.code,
        options.plantB ?? "offline",
      ]),
    );
  }

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
    else if (title === "Forecast" || title === "Forecasts") this.light("purchasing", "onboarding");
    else if (title === "Quotes" || title === "Pooled quotes") {
      this.light("purchasing", "onboarding");
      this.quote(step);
    } else if (title === "Pool") this.pool(staff);

    // "Allocation: Plant B $4,745.00 (700 kg), Plant A $4,745.00 (700 kg)." comes just before
    // the pooled PO's own line in the same step.
    const allocation: { plant: FacilityId; amount: string }[] = [];
    for (const line of step.staff) {
      if (line.startsWith("Allocation:")) {
        for (const m of line.matchAll(/Plant ([ABC]) (\$[\d,]+\.\d{2}) \(/g)) {
          if (m[1] && m[2]) allocation.push({ plant: m[1] as FacilityId, amount: m[2] });
        }
      }
      const m = /^(PO-[A-Z0-9-]*\d) to ([^,:]+), (\$[\d,]+\.\d{2})/.exec(line);
      if (m?.[1] && m[2] && m[3]) {
        this.vendors.set(m[1], m[2]);
        this.amounts.set(m[1], m[3]);
        if (allocation.length) this.allocate(m[1], m[3], allocation);
      }
    }

    for (const c of step.chain) {
      const tx = c.tx ? this.byHash.get(c.tx) : undefined;
      if (!tx) continue;
      const po = PO_RE.exec(c.line)?.[1];
      const chainTx = { hash: tx.tx, status: tx.status, error: tx.error };
      if (!po) continue;
      const vendor = this.vendors.get(po) ?? "the supplier";

      if (tx.events.includes("po_funded")) {
        const amount = dollars(
          /funded ([\d,]+\.\d{2}) DTUSD/.exec(c.line)?.[1],
          this.amounts.get(po),
        );
        // A pooled call names each plant's share: "· Plant B 4,745.00 DTUSD · Plant A …".
        const named = [...c.line.matchAll(/Plant ([ABC]) ([\d,]+\.\d{2}) DTUSD/g)].map((m) => ({
          plant: m[1] as FacilityId,
          amount: `$${m[2]}`,
        }));
        if (named.length && !this.shares.has(po)) this.allocate(po, amount, named);
        this.light("purchasing", "online");
        this.drop((f) => f.po === po && f.status === "refused");
        for (const coin of this.coins(po)) {
          this.flows.push({
            id: coin.share ? `fund-${po}/${coin.share.plant}` : `fund-${po}`,
            kind: "money",
            from: coin.from,
            to: { kind: "escrow" },
            label: coin.share
              ? `${po} · ${coin.name} ${coin.amount} share held${coin.share.approvedBy ? `, approved by ${coin.share.approvedBy}` : ""}`
              : `${po} · ${amount} held`,
            short: coin.share ? `${coin.name} ${coin.amount}` : `${po} ${amount}`,
            status: "held",
            fromStep: i,
            toStep: i,
            po,
            chainTx,
            ...(coin.share ? { share: coin.share } : {}),
          });
        }
        this.escrowCents += cents(amount);
        this.amounts.set(po, amount);
        // The approval is spent once the PO is funded: nothing is left to review; and the
        // pledges to the pool have become the shares the vault holds.
        for (const id of Object.keys(this.alerts) as FacilityId[]) {
          this.alerts[id] = this.alerts[id].filter(
            (line) => !line.startsWith(`${po} approved by`) && !line.startsWith("In the pool:"),
          );
        }
      } else if (tx.events.includes("po_refused")) {
        this.light("purchasing", "online");
        for (const coin of this.coins(po)) {
          this.flows.push({
            id: coin.share ? `refused-${po}/${coin.share.plant}` : `refused-${po}`,
            kind: "money",
            from: coin.from,
            to: { kind: "escrow" },
            label: coin.share
              ? `${po} · ${coin.name} ${coin.amount} share refused`
              : `${po} · ${this.amounts.get(po) ?? ""} refused`.replace("  ", " "),
            short: coin.share ? `${coin.name} ${coin.amount} refused` : `${po} refused`,
            status: "refused",
            fromStep: i,
            toStep: i,
            po,
            chainTx,
            ...(coin.share ? { share: coin.share } : {}),
          });
        }
      } else if (tx.events.includes("po_approved")) {
        // "Approved by Linda Park." or, pooled, "Approved by Linda Park: Plant B's $4,745.00 share."
        const who = /Approved by ([^.:]+)/.exec(staff)?.[1]?.trim() ?? "the director";
        const plant = (PLANT_RE.exec(staff)?.[1] as FacilityId | undefined) ?? "B";
        const share = this.shares.get(po)?.find((s) => s.plant === plant);
        if (share) share.approvedBy = who;
        this.alerts[plant].push(`${po} approved by ${who}; Kevin retries within the approval.`);
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
        // "Matches PO-G-2001: 1,400 kg ascorbic acid, supplier lot …": the quantity keeps its comma.
        const what = /Matches PO-[A-Z0-9-]*\d: (\d[\d,.]*\s[^,.]+)/.exec(staff)?.[1];
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
        // The hub took delivery for another plant too: "700 kg is earmarked for Plant A (…)".
        const mark = /([\d,.]+ kg) is earmarked for Plant ([ABC])/.exec(staff);
        if (mark?.[1] && mark[2])
          this.earmarks.set(po, { qty: mark[1], plant: mark[2] as FacilityId });
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
        const mark = this.earmarks.get(po);
        if (mark) {
          const to = FACILITIES.find((f) => f.id === mark.plant);
          this.flows.push({
            id: `earmark-${po}`,
            kind: "material",
            from: { kind: "dept", facility: "B", dept: "warehouse" },
            to: { kind: "dept", facility: mark.plant, dept: "warehouse" },
            label: `${po} · ${mark.qty} on to ${to?.name ?? `Plant ${mark.plant}`}`,
            short: `${mark.qty} → Plant ${mark.plant}`,
            status: "moving",
            fromStep: i,
            po,
          });
        }
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

  /**
   * The quotes as Kevin ranked them: "QuickChem Direct $5.90/kg excluded: vendor not qualified.
   * Northgate $7.10/kg, 7 days — selected. Ridgeway $7.35/kg, 5 days — runner-up." Each
   * supplier agent's anchor (or the contract's refusal of it) is matched by the signer's name.
   */
  private quote(step: Step) {
    const line = step.staff.join(" ");
    const re =
      /([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*) (\$[\d.]+\/kg)(?:, (\d+ days?))?(?: excluded: ([^.]+)| — (selected|runner-up))/g;
    for (const m of line.matchAll(re)) {
      const [, supplier, price, leadTime, reason, standing] = m;
      if (!supplier || !price) continue;
      const q: TwinQuote = {
        supplier,
        price,
        standing: standing === "selected" || standing === "runner-up" ? standing : "excluded",
      };
      if (leadTime) q.leadTime = leadTime;
      if (reason) q.reason = reason;
      this.quotes.push(q);
    }
    for (const c of step.chain) {
      const tx = c.tx ? this.byHash.get(c.tx) : undefined;
      if (!tx || !/anchor quote/.test(c.line)) continue;
      const first = (q: TwinQuote) => q.supplier.split(" ")[0]?.toLowerCase() ?? "";
      const q = this.quotes.find((q) => tx.signer.startsWith(first(q)));
      if (q) q.chainTx = { hash: tx.tx, status: tx.status, error: tx.error, signer: tx.signer };
    }
  }

  /**
   * "Pooled: 1,400 kg ascorbic acid for Plant B (700 kg) and Plant A (700 kg), each pledging …
   * Plant C has no ascorbic acid need and stays out of the pool." One note per plant.
   */
  private pool(staff: string) {
    this.light("purchasing", "onboarding");
    const material = /Pooled: [\d,.]+ kg ([a-z][a-z ]*?) for Plant/.exec(staff)?.[1] ?? "material";
    for (const m of staff.matchAll(/Plant ([ABC]) \(([\d,.]+ kg)\)/g)) {
      if (m[1] && m[2]) this.alerts[m[1] as FacilityId].push(`In the pool: ${m[2]} ${material}.`);
    }
    const out = /Plant ([ABC]) has no ([a-z][a-z ]*?) need/.exec(staff);
    if (out?.[1] && out[2])
      this.alerts[out[1] as FacilityId].push(`No ${out[2]} need; out of the pool.`);
  }

  /** The pooled PO's shares, one coin each; the plants' names are kept for the labels. */
  private allocate(po: string, total: string, parts: { plant: FacilityId; amount: string }[]) {
    this.pooled = po;
    this.shares.set(
      po,
      parts.map(({ plant }) => ({ plant, total })),
    );
    this.shareAmounts.set(po, new Map(parts.map(({ plant, amount }) => [plant, amount])));
  }

  /** The coins a PO's money moves as: one from HQ, or one per plant share from its purchasing roof. */
  private coins(
    po: string,
  ): { from: NodeRef; share?: PooledShare; name: string; amount: string }[] {
    const shares = this.shares.get(po);
    if (!shares?.length) return [{ from: { kind: "hq" }, name: "", amount: "" }];
    return shares.map((share) => ({
      from: { kind: "dept", facility: share.plant, dept: "purchasing" },
      share,
      name: `Plant ${share.plant}'s`,
      amount: this.shareAmounts.get(po)?.get(share.plant) ?? "",
    }));
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
      // An open review, not a rejected lot: the label says so (the Labels chip hides it).
      short: `${lot} · under review`,
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
    const code = /\blot (\S+?)\.(?:\s|$)/.exec(staff)?.[1];
    const lot =
      this.lots.find((l) => l.code === code) ?? this.lots.find((l) => l.state === "quarantine");
    if (lot) lot.state = state;
    // One escrow per PO, whether it is held as one coin or as a coin per plant share.
    if (this.flows.some((f) => f.po === po && f.status === "held")) {
      this.escrowCents -= cents(this.amounts.get(po) ?? "$0.00");
      this.drop((f) => f.po === po && f.status === "held");
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
        ...(f.share ? { share: { ...f.share } } : {}),
        progress: progress(f.kind, fromStep, toStep, t),
      })),
      quotes: this.quotes.map((q) => ({ ...q })),
      escrowHeldCents: this.escrowCents,
      summary: this.summary(b),
      ...(this.pooled ? { pooled: this.pooled } : {}),
    };
  }

  /** Plant B's count on day one; once an order is pooled, the shares each plant carries. */
  private summary(b: Facility | undefined): string {
    const po = this.pooled;
    const shares = po ? this.shareAmounts.get(po) : undefined;
    if (po && shares) {
      const parts = [...shares].map(([plant, amount]) => `Plant ${plant} ${amount}`).join(", ");
      const total = this.amounts.get(po);
      return `${po} pooled${total ? ` for ${total}` : ""}: ${parts}.`;
    }
    if (this.options.plantB === "online") return "All three plants on Acme's systems.";
    return `Plant B: ${b?.online ?? 0} of ${b?.departments.length ?? 0} departments online.`;
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
export function deriveTwinState(run: RunData, t: number, options: TwinOptions = {}): TwinState {
  const last = run.steps.length - 1;
  const upTo = Math.min(Math.floor(Math.max(0, t)), last);
  const twin = new Twin(new Map(run.transactions.map((tx) => [tx.tx, tx])), options);
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

/** The supplier standing in plain text, one line per quote; the 3D view adds these to its caption. */
export function formatQuotes(state: TwinState, curtain = false): string[] {
  return state.quotes.map((q) => {
    const terms = q.leadTime ? `${q.price}, ${q.leadTime}` : q.price;
    const standing =
      q.standing === "excluded" ? `excluded: ${q.reason ?? "not qualified"}` : q.standing;
    let tx = "";
    if (curtain && q.chainTx) {
      tx =
        q.chainTx.status === "success"
          ? ` (quote anchored by ${q.chainTx.signer}, tx ${q.chainTx.hash.slice(0, 8)}…)`
          : ` (anchor refused by the contract, tx ${q.chainTx.hash.slice(0, 8)}…)`;
    }
    return `Quote: ${q.supplier} ${terms}, ${standing}${tx}.`;
  });
}
