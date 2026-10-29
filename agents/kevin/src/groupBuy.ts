// Group purchasing (docs/GROUP_BUY.md): Acme's plants pool their need for one material into
// one RFQ, the supplier agents bid on the pooled volume from their own accounts, Kevin picks
// the winner with the same qualification rules as a single-plant buy, and one pooled PO is
// allocated across the plants. The coordination is on chain: each plant's agent pledges to
// the pool from its own account, and the contract charges each plant's share to that plant's
// own limits, waits for every director whose plant needs one, and funds one escrow.
//
// Kevin never checks a limit himself. When the contract refuses the pooled PO he asks it,
// read-only, which shares it would wait for (`explain_pooled_po`: the same checks) and texts
// those plants' directors. Each director approves only their own plant's share.

import { type ChainClient, explorerUrl, type LoggedOutcome } from "@day-one/server/chain/client";
import { NEEDS_APPROVAL, summarizeChainTx } from "@day-one/server/chain/summary";
import type { Ledger } from "@day-one/server/ledger/db";
import {
  approvals,
  chainTx,
  facilities,
  materials,
  productionPlan,
  products,
  purchaseOrders,
  staff,
} from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import { quoteProof } from "@day-one/server/quotes";
import { and, eq } from "drizzle-orm";
import { chainLine, type DemoStep, type QuotesFn, type ShipFn } from "./demo.ts";
import { type Forecast, forecastMaterial } from "./forecast.ts";
import {
  draftPoFromRanking,
  extendedUsdc,
  openRfq,
  type PoDraft,
  rankQuotes,
  recordQuotes,
} from "./purchasing.ts";
import { decideQc, type PackingSlip, receiveDelivery } from "./receiving.ts";

/** The group-buy clock: the day after the main demo's purchasing day. */
export const GROUP_CLOCK = {
  start: "2026-11-10T13:00:00.000Z",
  pool: "2026-11-10T13:05:00.000Z",
  quotes: "2026-11-10T13:10:00.000Z",
  place: "2026-11-10T13:15:00.000Z",
  approve: "2026-11-10T13:40:00.000Z",
  ship: "2026-11-14T09:00:00.000Z",
  receive: "2026-11-17T10:30:00.000Z",
  release: "2026-11-17T15:00:00.000Z",
} as const;

export const GROUP_MATERIAL = "ASC";
export const GROUP_POOL = "RFQ-G-2611";
export const GROUP_PO = "PO-G-2001";
/** The PO number as a director types it back: "YES G2001". */
export const GROUP_PO_SHORT = GROUP_PO.replace(/^PO-/, "").replace(/-/g, "");
const SUPPLIER_LOT = "NG-24-9120";
const SLIP_NO = "NG-PS-60502";

/**
 * The price each plant has on file for the material (FICTIONAL_DATA §5 and §9: Northgate at
 * $7.10/kg plus $180 freight, what Plant B paid on its own). A plant pledges to the pool at
 * most what it would pay alone, so pooling can never cost a plant more than buying alone.
 */
export const PRICE_ON_FILE: Readonly<
  Record<string, { unitPriceUsdc: number; freightUsdc: number }>
> = { ASC: { unitPriceUsdc: 7_100_000, freightUsdc: 180_000_000 } };

/** Staff added for the group scenario (FICTIONAL_DATA §16): the other plants' directors. */
export const GROUP_STAFF = [
  { name: "Dana Whitfield", role: "ops_director", facility: "A", account: "director.plant-a" },
  { name: "Omar Haddad", role: "ops_director", facility: "C", account: "director.plant-c" },
] as const;
/** The VC500 batch Acme moves to Riverside, which gives Plant A its ascorbic acid need. */
export const GROUP_PLANNED_BATCH = {
  batchNo: "BR-A-2210",
  product: "P-VC500",
  facility: "A",
  plannedFor: "2026-11-19",
  batchTablets: 800_000,
} as const;

const RECEIVER = "Tommy Reyes";
const QC = "Priya Natarajan";
const REPLY = /^\s*(YES|NO)\s+(?:PO-)?([A-Za-z0-9-]+)\s*$/i;

const usd = (units: number | bigint) => formatUsd(BigInt(units));
const usdShort = (units: number | bigint) => usd(units).replace(/\.00$/, "");
const firstName = (name: string) => name.split(" ")[0] ?? name;
const kg = (base: number) => `${(base / 1_000_000).toLocaleString("en-US")} kg`;

/** One plant's part of the pool: its agent, what it needs and its share of the pooled PO. */
export interface Share {
  plant: string;
  plantName: string;
  agent: string;
  qtyBase: number;
  /** Token base units. */
  amount: number;
  /** The director who approved this share, once one has. */
  approvedBy?: string;
}

export interface GroupSalts {
  po: string;
  /** One per supplier account, for the quote fingerprints the agents anchor. */
  quotes: Record<string, string>;
}

export interface GroupDeps {
  db: Ledger;
  chain: ChainClient;
  setClock: (iso: string) => void;
  policyContract: string;
  relayer: string;
  tokenSymbol: string;
  /** Each plant's purchasing agent account, by facility code. */
  agents: Record<string, string>;
  /** The plant that places the pooled PO and takes the delivery. */
  hub: string;
  quotes: QuotesFn;
  ship: ShipFn;
  salts: GroupSalts;
}

export interface GroupResult {
  steps: DemoStep[];
  pool: { poolId: string; material: string; qtyBase: number; shares: Share[]; declined: string[] };
  po: {
    poNo: string;
    vendor: string;
    totalUsdc: number;
    unitPriceUsdc: number;
    /** What the plants would have paid alone at the price on file, less the pooled total. */
    savingsUsdc: number;
    status: string;
  } | null;
  /** Each plant's committed spend this month, from the contract, after the run. */
  spent: Record<string, number>;
  quoteProofs: ReturnType<typeof quoteProof>[];
  summary: { transactions: number; refusedByDesign: number; refusedOther: number; failed: number };
  ok: boolean;
}

class GroupStopped extends Error {
  override name = "GroupStopped";
}

/** The group scenario's additions to the seed: the other plants' directors and Plant A's batch. */
export function seedGroupBuy(db: Ledger, root: string) {
  const facilityId = new Map(
    db
      .select({ code: facilities.code, id: facilities.id })
      .from(facilities)
      .all()
      .map((f) => [f.code, f.id]),
  );
  const id = (code: string) => {
    const found = facilityId.get(code);
    if (found === undefined) throw new Error(`seedGroupBuy: no facility ${code}`);
    return found;
  };
  db.insert(staff)
    .values(
      GROUP_STAFF.map((s) => ({
        facilityId: id(s.facility),
        name: s.name,
        role: s.role,
        nearAccountId: `${s.account}.${root}`,
      })),
    )
    .run();
  const product = db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.code, GROUP_PLANNED_BATCH.product))
    .get();
  if (!product) throw new Error(`seedGroupBuy: no product ${GROUP_PLANNED_BATCH.product}`);
  db.insert(productionPlan)
    .values({
      batchNo: GROUP_PLANNED_BATCH.batchNo,
      productId: product.id,
      facilityId: id(GROUP_PLANNED_BATCH.facility),
      plannedFor: GROUP_PLANNED_BATCH.plannedFor,
      batchTablets: GROUP_PLANNED_BATCH.batchTablets,
      status: "planned",
    })
    .run();
}

/** Base units per cent: shares are whole cents, as every amount staff read is. */
const UNITS_PER_CENT = 10_000n;

/**
 * Splits the pooled total across the plants in proportion to quantity, in whole cents, with
 * the rounding remainder on the first (hub) line so the shares add up exactly. BigInt keeps the
 * products exact (a total in base units times a quantity in mg passes 2^53).
 */
export function allocateShares(
  totalUsdc: number,
  plants: readonly Omit<Share, "amount">[],
): Share[] {
  const total = BigInt(totalUsdc);
  if (total % UNITS_PER_CENT !== 0n) {
    throw new RangeError(`a pooled total of ${totalUsdc} base units has fractions of a cent`);
  }
  const cents = total / UNITS_PER_CENT;
  const qty = plants.reduce((sum, p) => sum + BigInt(p.qtyBase), 0n);
  const shares = plants.map((p) => ({
    ...p,
    amount: Number(((cents * BigInt(p.qtyBase)) / qty) * UNITS_PER_CENT),
  }));
  const first = shares[0];
  if (first) first.amount += totalUsdc - shares.reduce((sum, s) => sum + s.amount, 0);
  return shares;
}

/** What a plant would pay alone at the price on file: the most it pledges to the pool. */
export function aloneCost(materialCode: string, qtyBase: number, dimension: string) {
  const price = PRICE_ON_FILE[materialCode];
  if (!price) throw new Error(`no price on file for ${materialCode}`);
  const perUnit = dimension === "mass" ? 1_000_000 : 1;
  return extendedUsdc(qtyBase, price.unitPriceUsdc, perUnit) + price.freightUsdc;
}

interface AgentPolicyView {
  name: string;
  plant: string;
  per_po_limit: string;
  approver: string;
}
interface ShareVerdict {
  agent: string;
  plant: string;
  name: string;
  amount: string;
  approved_by: string | null;
  needs_approval: string | null;
}
interface PooledVerdict {
  refusal: string | null;
  shares: ShareVerdict[];
}

export interface PooledSubmitInput {
  po: PoDraft;
  poolId: string;
  shares: Share[];
  /** The agent placing the PO: the hub plant's. */
  agent: string;
  /** "1,400 kg ascorbic acid", for the approval texts. */
  summary: string;
}
export interface PooledSubmitResult {
  outcome: LoggedOutcome;
  status: "funded" | "awaiting_approval" | "refused" | "failed";
  sentence: string;
  /** The shares the contract waits for, with the text sent to each plant's director. */
  waiting: { share: Share; approver: string; requestText: string }[];
}

function pooledArgs(input: Pick<PooledSubmitInput, "po" | "poolId" | "shares">) {
  const { po } = input;
  if (!po.vendor.account) throw new Error(`${po.poNo}: ${po.vendor.name} has no NEAR account`);
  return {
    po_id: po.poNo,
    pool_id: input.poolId,
    supplier: po.vendor.account,
    amount: String(po.totalUsdc),
    category: po.category,
    po_hash: po.poHash,
    lines: input.shares.map((s) => ({ agent: s.agent, amount: String(s.amount) })),
  };
}

/** Kevin places the pooled PO; the contract funds it or says which plants' directors to ask. */
export async function submitPooledPo(
  db: Ledger,
  chain: ChainClient,
  input: PooledSubmitInput,
  ctx: { policyContract: string; now: string },
): Promise<PooledSubmitResult> {
  const { po, shares } = input;
  const args = pooledArgs(input);
  const outcome = await chain.call({
    kind: "submit_pooled_po",
    signerId: input.agent,
    receiverId: ctx.policyContract,
    method: "submit_pooled_po",
    args,
    related: { type: "purchase_order", id: po.id },
  });
  const setStatus = (status: typeof purchaseOrders.status._.data) =>
    db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, po.id)).run();
  const plantList = shares.map((s) => `Plant ${s.plant} ${usd(s.amount)}`).join(", ");
  const head = `${po.poNo} to ${po.vendor.name}, ${usd(po.totalUsdc)} pooled for ${shares.length} plants`;

  if (outcome.status === "success") {
    setStatus("funded");
    return {
      outcome,
      status: "funded",
      sentence: `${head} — within every plant's limits, funded: ${plantList}.`,
      waiting: [],
    };
  }
  if (outcome.status === "failed") {
    return {
      outcome,
      status: "failed",
      sentence: `${po.poNo} could not be sent to the chain; Kevin will retry. (${outcome.errorMessage})`,
      waiting: [],
    };
  }
  const reason = outcome.errorMessage ?? "";
  if (!reason.endsWith(NEEDS_APPROVAL)) {
    setStatus("refused");
    return { outcome, status: "refused", sentence: `${head} was refused: ${reason}`, waiting: [] };
  }

  // The contract says which shares it waits for; Kevin does not work that out himself.
  const verdict = await chain.view<PooledVerdict>({
    contractId: ctx.policyContract,
    method: "explain_pooled_po",
    args: { agent: input.agent, ...args },
  });
  const waiting: PooledSubmitResult["waiting"] = [];
  const descriptions: string[] = [];
  for (const v of verdict.shares) {
    if (!v.needs_approval) continue;
    const share = shares.find((s) => s.agent === v.agent);
    if (!share) continue;
    const policy = await chain.view<AgentPolicyView>({
      contractId: ctx.policyContract,
      method: "get_agent_policy",
      args: { agent: v.agent },
    });
    const approver = db.select().from(staff).where(eq(staff.nearAccountId, policy.approver)).get();
    if (!approver) throw new Error(`${po.poNo}: approver ${policy.approver} is not on staff`);
    const limit = BigInt(policy.per_po_limit);
    const overLimit = BigInt(share.amount) > limit;
    const why = overLimit
      ? `Over ${policy.name}'s ${usdShort(limit)} limit.`
      : `${v.needs_approval}.`;
    const requestText =
      `${policy.name} needs approval: ${po.poNo}, Plant ${share.plant}'s ${usd(share.amount)} share ` +
      `of a ${usd(po.totalUsdc)} pooled order to ${po.vendor.name} for ${input.summary} ` +
      `(Plant ${share.plant}: ${kg(share.qtyBase)}). ${why} ` +
      `Reply YES ${GROUP_PO_SHORT} or NO ${GROUP_PO_SHORT}.`;
    db.insert(approvals)
      .values({
        poId: po.id,
        approverStaffId: approver.id,
        channel: "sms_sim",
        requestText,
        requestedAt: ctx.now,
        refusedTxId: outcome.id,
      })
      .run();
    waiting.push({ share, approver: approver.name, requestText });
    descriptions.push(
      overLimit
        ? `Plant ${share.plant}'s ${usd(share.amount)} share is over its ${usd(limit)} limit`
        : `Plant ${share.plant}'s share needs approval (${v.needs_approval})`,
    );
  }
  setStatus("awaiting_approval");
  const names = waiting.map((w) => `${firstName(w.approver)} (Plant ${w.share.plant})`);
  return {
    outcome,
    status: "awaiting_approval",
    sentence: `${head}: ${descriptions.join("; ")}. The whole order waits. Sent to ${names.join(" and ")} for approval.`,
    waiting,
  };
}

export interface ShareReplyResult {
  handled: boolean;
  sentences: string[];
  approval?: LoggedOutcome;
  /** Kevin's retry, once every plant's share is approved. */
  retry?: PooledSubmitResult;
}

/**
 * A director's text about a pooled PO. "YES G2001" approves that director's own plant's share
 * (approve_po on "<po>/<plant agent>", relayed); when every waiting share is approved, Kevin
 * retries the identical pooled PO and the contract funds it.
 */
export async function handleShareReply(
  db: Ledger,
  chain: ChainClient,
  reply: { fromStaffId: number; text: string },
  ctx: { policyContract: string; now: string } & PooledSubmitInput,
): Promise<ShareReplyResult> {
  const { po } = ctx;
  const waiting = db
    .select({ approval: approvals })
    .from(approvals)
    .where(
      and(
        eq(approvals.poId, po.id),
        eq(approvals.approverStaffId, reply.fromStaffId),
        eq(approvals.state, "requested"),
      ),
    )
    .all();
  const match = REPLY.exec(reply.text);
  const named = match?.[2]?.replace(/-/g, "").toUpperCase() === GROUP_PO_SHORT;
  const target = named ? waiting[0] : undefined;
  if (!match || !target) {
    return {
      handled: false,
      sentences: [
        waiting.length
          ? `Please reply YES ${GROUP_PO_SHORT} or NO ${GROUP_PO_SHORT} so I know which order you mean.`
          : "There is nothing waiting for your approval.",
      ],
    };
  }
  const approver = db.select().from(staff).where(eq(staff.id, reply.fromStaffId)).get();
  if (!approver?.nearAccountId) throw new Error(`staff ${reply.fromStaffId} has no NEAR account`);
  // The share this director answers for: the plant whose agent names them as approver.
  let share: Share | undefined;
  for (const s of ctx.shares) {
    const policy = await chain.view<AgentPolicyView>({
      contractId: ctx.policyContract,
      method: "get_agent_policy",
      args: { agent: s.agent },
    });
    if (policy.approver === approver.nearAccountId) share = s;
  }
  if (!share) throw new Error(`${approver.name} approves for no plant in ${po.poNo}`);
  if (!po.vendor.account) throw new Error(`${po.poNo}: vendor has no NEAR account`);
  const refusedTx = target.approval.refusedTxId
    ? db.select().from(chainTx).where(eq(chainTx.id, target.approval.refusedTxId)).get()
    : undefined;
  const yes = match[1]?.toUpperCase() === "YES";
  const shareKey = `${po.poNo}/${share.agent}`;

  const outcome = await chain.call(
    yes
      ? {
          kind: "approve_po",
          signerId: approver.nearAccountId,
          predecessorId: approver.nearAccountId,
          receiverId: ctx.policyContract,
          method: "approve_po",
          args: {
            po_id: shareKey,
            supplier: po.vendor.account,
            amount: String(share.amount),
            category: po.category,
            po_hash: po.poHash,
            refused_tx: refusedTx?.txHash ?? "",
          },
          viaRelayer: true,
          related: { type: "purchase_order", id: po.id },
        }
      : {
          kind: "reject_po",
          signerId: approver.nearAccountId,
          predecessorId: approver.nearAccountId,
          receiverId: ctx.policyContract,
          method: "reject_po",
          args: { po_id: shareKey, reason: `Declined by ${approver.name} by text.` },
          viaRelayer: true,
          related: { type: "purchase_order", id: po.id },
        },
  );
  if (outcome.status !== "success") {
    return {
      handled: true,
      approval: outcome,
      sentences: [`Your reply for ${po.poNo} did not go through; please try again in a minute.`],
    };
  }
  db.update(approvals)
    .set({
      responseText: reply.text.trim(),
      state: yes ? "approved" : "declined",
      respondedAt: ctx.now,
      approveTxId: yes ? outcome.id : null,
    })
    .where(eq(approvals.id, target.approval.id))
    .run();
  if (!yes) {
    return {
      handled: true,
      approval: outcome,
      sentences: [
        `Declined by ${approver.name}. ${po.poNo} is on hold for every plant; Kevin told the purchasers.`,
      ],
    };
  }
  const sentences = [
    `Approved by ${approver.name}: Plant ${share.plant}'s ${usd(share.amount)} share.`,
  ];
  const stillWaiting = db
    .select({ name: staff.name })
    .from(approvals)
    .innerJoin(staff, eq(staff.id, approvals.approverStaffId))
    .where(and(eq(approvals.poId, po.id), eq(approvals.state, "requested")))
    .all()
    .map((r) => firstName(r.name));
  if (stillWaiting.length) {
    sentences.push(`Still waiting for ${stillWaiting.join(" and ")}.`);
    return { handled: true, approval: outcome, sentences };
  }
  const retry = await submitPooledPo(db, chain, ctx, ctx);
  sentences.push(
    retry.status === "funded"
      ? `${po.poNo} sent to ${po.vendor.name}: ${usd(po.totalUsdc)} held until delivery passes QC; ` +
          `${ctx.shares.map((s) => `Plant ${s.plant} ${usd(s.amount)}`).join(", ")}, each charged to its own plant.`
      : retry.sentence,
  );
  return { handled: true, approval: outcome, retry, sentences };
}

/** The scripted group buy, every phase in order (npm run demo:group). */
export async function runGroupDemo(deps: GroupDeps): Promise<GroupResult> {
  const { db, chain } = deps;
  const steps: DemoStep[] = [];
  const add = (step: number, title: string, staffLines: string[], chainLines: string[] = []) => {
    steps.push({ step, title, staff: staffLines, chain: chainLines });
  };
  const amount = (units: number | bigint) => `${usd(units).replace("$", "")} ${deps.tokenSymbol}`;
  const relayed = (account: string | null) =>
    `signed by ${account ?? "unknown"}, paid by ${deps.relayer}`;
  const expect = (ok: boolean, why: string) => {
    if (!ok) throw new GroupStopped(why);
  };
  const staffBy = (name: string) => {
    const row = db.select().from(staff).where(eq(staff.name, name)).get();
    if (!row) throw new GroupStopped(`${name} is not on the staff list`);
    return row;
  };
  const ctx = { policyContract: deps.policyContract };
  const material = db.select().from(materials).where(eq(materials.code, GROUP_MATERIAL)).get();
  if (!material) throw new Error(`group buy: no material ${GROUP_MATERIAL}`);
  const plants = db
    .select()
    .from(facilities)
    .where(eq(facilities.role, "sister"))
    .all()
    .concat(db.select().from(facilities).where(eq(facilities.role, "acquired")).all())
    .concat(db.select().from(facilities).where(eq(facilities.role, "packaging")).all())
    .sort((a, b) => a.code.localeCompare(b.code));
  const hubPlant = plants.find((p) => p.code === deps.hub);
  if (!hubPlant) throw new Error(`group buy: no hub plant ${deps.hub}`);

  let shares: Share[] = [];
  const declined: string[] = [];
  let po: PoDraft | null = null;
  let unitPriceUsdc = 0;
  let savingsUsdc = 0;
  let quoteProofs: GroupResult["quoteProofs"] = [];
  let poStatus = "none";
  try {
    // 0. Who may spend what, from the contract.
    deps.setClock(GROUP_CLOCK.start);
    const budget = (await chain.view({
      contractId: deps.policyContract,
      method: "get_budget",
    })) as { budget: string; escrowed: string };
    const policyLines: string[] = [];
    for (const plant of plants) {
      const agent = deps.agents[plant.code];
      if (!agent) continue;
      const policy = await chain.view<AgentPolicyView>({
        contractId: deps.policyContract,
        method: "get_agent_policy",
        args: { agent },
      });
      const approver = db
        .select({ name: staff.name })
        .from(staff)
        .where(eq(staff.nearAccountId, policy.approver))
        .get();
      policyLines.push(
        `Plant ${plant.code} (${plant.name}): ${policy.name} may spend ${usd(BigInt(policy.per_po_limit))} per PO; ` +
          `over that, ${approver?.name ?? "its director"} approves.`,
      );
    }
    add(
      0,
      "Three plants, one material",
      [`Group purchasing for ${material.name.toLowerCase()} across Acme's plants.`, ...policyLines],
      [
        `chain: spend-policy budget ${amount(BigInt(budget.budget))}, escrowed ${amount(BigInt(budget.escrowed))}`,
      ],
    );

    // 1. Each plant's own forecast decides whether it joins.
    const forecasts = new Map<string, Forecast>();
    const needLines: string[] = [];
    for (const plant of plants) {
      const forecast = forecastMaterial(db, {
        facility: plant.code,
        material: GROUP_MATERIAL,
        now: GROUP_CLOCK.start,
      });
      forecasts.set(plant.code, forecast);
      // A plant with no planned use pools nothing, whatever its stock level says.
      needLines.push(
        forecast.needBase > 0
          ? `Plant ${plant.code}: ${forecast.sentence}`
          : `Plant ${plant.code}: no planned batches use ${material.name.toLowerCase()} in the next ${forecast.horizonDays} days; nothing to pool.`,
      );
    }
    add(1, "Forecasts", needLines);
    const demand = plants.filter((p) => {
      const f = forecasts.get(p.code);
      return (f?.needBase ?? 0) > 0 && (f?.recommendQtyBase ?? 0) > 0;
    });
    for (const p of plants.filter((p) => !demand.includes(p))) declined.push(p.code);
    expect(demand.length >= 2, "fewer than two plants need the material; nothing to pool");

    // 2. The pool on chain: the hub opens it, the others pledge from their own accounts.
    deps.setClock(GROUP_CLOCK.pool);
    const ordered = [hubPlant, ...demand.filter((p) => p.code !== deps.hub)].filter((p) =>
      demand.includes(p),
    );
    const poolLines: string[] = [];
    const pledges: Omit<Share, "amount">[] = [];
    for (const plant of ordered) {
      const agent = deps.agents[plant.code];
      const forecast = forecasts.get(plant.code);
      if (!agent || !forecast?.recommendQtyBase) continue;
      const qtyBase = forecast.recommendQtyBase;
      const cap = aloneCost(GROUP_MATERIAL, qtyBase, material.dimension);
      const opening = plant.code === deps.hub;
      const outcome = await chain.call({
        kind: opening ? "open_pool" : "join_pool",
        signerId: agent,
        receiverId: deps.policyContract,
        method: opening ? "open_pool" : "join_pool",
        args: opening
          ? {
              pool_id: GROUP_POOL,
              category: "raw_material",
              material: GROUP_MATERIAL,
              qty: String(qtyBase),
              max_amount: String(cap),
            }
          : { pool_id: GROUP_POOL, qty: String(qtyBase), max_amount: String(cap) },
      });
      poolLines.push(
        chainLine(
          `${opening ? "open_pool" : "join_pool"} ${GROUP_POOL}`,
          outcome,
          `signed by ${agent}`,
        ),
      );
      expect(outcome.status === "success", `Plant ${plant.code} could not pledge to the pool`);
      pledges.push({
        plant: plant.code,
        plantName: plant.name,
        agent,
        qtyBase,
      });
    }
    const totalQty = pledges.reduce((sum, p) => sum + p.qtyBase, 0);
    const price = PRICE_ON_FILE[GROUP_MATERIAL];
    add(
      2,
      "Pool",
      [
        `Pooled: ${kg(totalQty)} ${material.name.toLowerCase()} for ${pledges
          .map((p) => `Plant ${p.plant} (${kg(p.qtyBase)})`)
          .join(
            " and ",
          )}, each pledging at most its cost alone at the ${usd(price?.unitPriceUsdc ?? 0)}/kg on file.`,
        ...declined.map(
          (code) =>
            `Plant ${code} has no ${material.name.toLowerCase()} need and stays out of the pool.`,
        ),
      ],
      poolLines,
    );

    // 3. One RFQ for the pooled volume; the supplier agents bid and anchor their quotes.
    deps.setClock(GROUP_CLOCK.quotes);
    const hubForecast = forecasts.get(deps.hub);
    if (!hubForecast) throw new Error("group buy: the hub has no forecast");
    const needBy = pledges
      .map((p) => forecasts.get(p.plant)?.needBy ?? "")
      .filter(Boolean)
      .sort()[0];
    const pooledForecast: Forecast = {
      ...hubForecast,
      recommendQtyBase: totalQty,
      needBy: needBy ?? hubForecast.needBy,
    };
    const rfq = openRfq(db, pooledForecast, GROUP_POOL);
    const answers = await deps.quotes(rfq);
    recordQuotes(db, rfq, answers);
    quoteProofs = rfq.quotes
      .filter((q) => q.anchor?.status === "success")
      .map((q) => quoteProof(q.terms, q.salt, q.anchor?.txHash ?? null));
    const ranking = rankQuotes(db, rfq, GROUP_CLOCK.start);
    expect(ranking.selected !== null, "no eligible quote for the pooled RFQ");
    const drafted = draftPoFromRanking(db, ranking, GROUP_PO, deps.salts.po);
    po = drafted;
    unitPriceUsdc = ranking.selected?.unitPriceUsdc ?? 0;
    const alone = pledges.reduce(
      (sum, p) => sum + aloneCost(GROUP_MATERIAL, p.qtyBase, material.dimension),
      0,
    );
    savingsUsdc = alone - po.totalUsdc;
    add(
      3,
      "Pooled quotes",
      [
        ranking.sentence,
        `${drafted.why} Pooled price ${usd(unitPriceUsdc)}/kg against ${usd(price?.unitPriceUsdc ?? 0)}/kg on file: ` +
          `${usd(Math.max(0, savingsUsdc))} saved across the plants.`,
      ],
      answers.flatMap((a) =>
        a.anchor
          ? [chainLine(`anchor quote ${rfq.rfqNo}`, a.anchor, `signed by ${a.account}`)]
          : [],
      ),
    );

    // 4. One pooled PO, allocated by quantity; the contract checks every plant's share.
    deps.setClock(GROUP_CLOCK.place);
    shares = allocateShares(po.totalUsdc, pledges);
    const pooledInput: PooledSubmitInput = {
      po,
      poolId: GROUP_POOL,
      shares,
      agent: deps.agents[deps.hub] ?? "",
      summary: `${kg(totalQty)} ${material.name.toLowerCase()}`,
    };
    const placed = await submitPooledPo(db, chain, pooledInput, {
      ...ctx,
      now: GROUP_CLOCK.place,
    });
    add(
      4,
      "Pooled PO",
      [
        `Allocation: ${shares.map((s) => `Plant ${s.plant} ${usd(s.amount)} (${kg(s.qtyBase)})`).join(", ")}.`,
        placed.sentence,
      ],
      [chainLine(`submit_pooled_po ${po.poNo}`, placed.outcome)],
    );
    poStatus = placed.status;
    expect(placed.status === "awaiting_approval", `${po.poNo} did not go to approval`);

    // 5. Each plant's director approves its own share; the last approval funds the pool.
    deps.setClock(GROUP_CLOCK.approve);
    let funded: PooledSubmitResult | undefined;
    for (const w of placed.waiting) {
      const approver = staffBy(w.approver);
      const first = firstName(approver.name);
      const text = `YES ${GROUP_PO_SHORT}`;
      const reply = await handleShareReply(
        db,
        chain,
        { fromStaffId: approver.id, text },
        { ...ctx, now: GROUP_CLOCK.approve, ...pooledInput },
      );
      const [approvedLine, ...rest] = reply.sentences;
      add(
        5,
        `${first} texts`,
        [`${first}: ${text} → ${approvedLine ?? ""}`, ...(reply.retry ? [] : rest)],
        reply.approval
          ? [
              chainLine(
                `approve_po ${po.poNo}/Plant ${w.share.plant}`,
                reply.approval,
                relayed(approver.nearAccountId),
              ),
            ]
          : [],
      );
      expect(reply.approval?.status === "success", `${first}'s approval did not go through`);
      w.share.approvedBy = approver.name;
      if (reply.retry) {
        funded = reply.retry;
        add(6, "Kevin retries", rest, [
          chainLine(
            `submit_pooled_po ${po.poNo}`,
            reply.retry.outcome,
            reply.retry.status === "funded"
              ? `escrow funded ${amount(po.totalUsdc)} · ${shares.map((s) => `Plant ${s.plant} ${amount(s.amount)}`).join(" · ")}`
              : undefined,
          ),
        ]);
      }
    }
    poStatus = funded?.status ?? poStatus;
    expect(funded?.status === "funded", `${po.poNo} was not funded after the approvals`);

    // 7. The supplier accepts and ships the pooled quantity to the hub from its own account.
    deps.setClock(GROUP_CLOCK.ship);
    const shipped = await deps.ship({
      poNo: po.poNo,
      poId: po.id,
      supplierAccount: po.vendor.account ?? "",
      amount: BigInt(po.totalUsdc),
      supplierLot: SUPPLIER_LOT,
    });
    add(
      7,
      "Supplier ships",
      [],
      shipped.outcomes.map((o) =>
        chainLine(
          `${methodOf(db, o.id)} ${po?.poNo ?? ""}`,
          o,
          `signed by ${po?.vendor.account ?? ""}`,
        ),
      ),
    );
    expect(shipped.status === "shipped", `${po.vendor.name} did not ship: ${shipped.reason ?? ""}`);

    // 8. The hub receives the whole lot; the other plants' shares are earmarked for transfer.
    deps.setClock(GROUP_CLOCK.receive);
    const receiver = staffBy(RECEIVER);
    const slip: PackingSlip = {
      slipNo: SLIP_NO,
      poNo: po.poNo,
      vendorName: po.vendor.name,
      lines: [
        {
          description: `${material.name} USP, 25 kg bags`,
          shippedBase: totalQty,
          backorderedBase: 0,
          supplierLot: SUPPLIER_LOT,
        },
      ],
    };
    const received = await receiveDelivery(
      db,
      chain,
      { slip, receiverStaffId: receiver.id },
      { ...ctx, now: GROUP_CLOCK.receive },
    );
    const others = shares.filter((s) => s.plant !== deps.hub);
    add(
      8,
      "Delivery at the hub",
      [
        ...received.sentences,
        ...(received.status === "received"
          ? [
              `${others.map((s) => `${kg(s.qtyBase)} is earmarked for Plant ${s.plant} (${s.plantName})`).join("; ")}; it moves on once QC releases the lot.`,
            ]
          : []),
      ],
      received.outcome
        ? [
            chainLine(
              `confirm_receipt ${po.poNo}`,
              received.outcome,
              relayed(receiver.nearAccountId),
            ),
          ]
        : [],
    );
    expect(received.status === "received", `the delivery was not received (${received.status})`);

    // 9. QC releases: one payout to the supplier; each plant's books carry its own share.
    deps.setClock(GROUP_CLOCK.release);
    const inspector = staffBy(QC);
    const qc = await decideQc(
      db,
      chain,
      { lotCode: received.lotCodes[0] ?? "", decision: "release", qcStaffId: inspector.id },
      { ...ctx, now: GROUP_CLOCK.release },
    );
    poStatus = qc.status === "released" ? "paid" : poStatus;
    add(
      9,
      "QC release",
      qc.sentences,
      qc.outcome
        ? [
            chainLine(
              `qc_release ${po.poNo}`,
              qc.outcome,
              qc.status === "released"
                ? `${amount(po.totalUsdc)} → ${po.vendor.account}`
                : undefined,
            ),
          ]
        : [],
    );
    expect(qc.status === "released", `QC release ended ${qc.status}`);
  } catch (error) {
    if (!(error instanceof GroupStopped)) throw error;
    add(-1, "Stopped", [`The group buy stopped: ${error.message}`]);
  }

  // 10. What each plant has committed this month, from the contract, and the chain summary.
  const spent: Record<string, number> = {};
  for (const plant of plants) {
    const agent = deps.agents[plant.code];
    if (!agent) continue;
    const value = await chain.view<string>({
      contractId: deps.policyContract,
      method: "get_spent",
      args: { agent },
    });
    spent[plant.code] = Number(value);
  }
  const summary = summarizeChainTx(db.select().from(chainTx).all());
  add(
    10,
    "Each plant's books",
    [
      `On the books this month: ${plants
        .map((p) => `Plant ${p.code} ${usd(spent[p.code] ?? 0)}`)
        .join(", ")} — each counted against its own limits by the contract.`,
    ],
    [
      `chain: ${summary.transactions} transactions, ${summary.refusedByDesign} refused by design, ` +
        (summary.refusedOther ? `${summary.refusedOther} refused otherwise, ` : "") +
        `${summary.failed} failed.`,
    ],
  );
  const stopped = steps.some((s) => s.step === -1);
  return {
    steps,
    pool: {
      poolId: GROUP_POOL,
      material: GROUP_MATERIAL,
      qtyBase: shares.reduce((s, x) => s + x.qtyBase, 0),
      shares,
      declined,
    },
    po: po
      ? {
          poNo: po.poNo,
          vendor: po.vendor.name,
          totalUsdc: po.totalUsdc,
          unitPriceUsdc,
          savingsUsdc,
          status: poStatus,
        }
      : null,
    spent,
    quoteProofs,
    summary,
    ok: !stopped && summary.failed === 0 && summary.refusedOther === 0,
  };
}

/** The transcript npm run demo:group prints and checks. A sandbox recording has no explorer. */
export function formatGroupTranscript(db: Ledger, steps: DemoStep[], network: string): string {
  const lines: string[] = [];
  for (const step of steps) {
    for (const text of step.staff) lines.push(text);
    for (const text of step.chain) lines.push(`  ${text}`);
  }
  if (network === "sandbox") {
    return `${[...lines, "", "Recorded on a local NEAR sandbox: the hashes above have no public explorer."].join("\n")}\n`;
  }
  const txs = db
    .select()
    .from(chainTx)
    .all()
    .filter((r) => r.txHash)
    .map((r) => `  ${r.method} ${explorerUrl(r.network, r.txHash)}`);
  return `${[...lines, "", "Explorer links:", ...txs].join("\n")}\n`;
}

function methodOf(db: Ledger, chainTxId: number) {
  return (
    db.select({ m: chainTx.method }).from(chainTx).where(eq(chainTx.id, chainTxId)).get()?.m ?? ""
  );
}
