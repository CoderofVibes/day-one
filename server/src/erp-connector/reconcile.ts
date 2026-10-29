// Three sets of books, one answer: do Day One's lot ledger, the acquirer's ERP and the
// spend-policy contract agree? Records cross by ID (PO number, lot code, transaction hash), so
// this reads all three by those IDs and compares. It changes nothing. A mismatch names the
// record and both numbers. `npm run erp:reconcile` runs it after the replayed demo; the same
// function serves a nightly run against the live contract (view calls only, no keys).

import type { Erp } from "@day-one/erp/db";
import { formatUsd } from "@day-one/erp/money";
import { trialBalance } from "@day-one/erp/posting";
import {
  purchaseOrders as erpPurchaseOrders,
  vendors as erpVendors,
  settings,
  vendorBills,
  vendorPayments,
} from "@day-one/erp/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";
import {
  chainTx,
  facilities,
  lotBalances,
  lots,
  materials,
  purchaseOrders,
  vendors,
} from "../ledger/schema.ts";
import { type ContractStanding, compareStanding, type StandingComparison } from "./credentials.ts";
import { verdictOf } from "./sync.ts";
import type { ErpConnector } from "./types.ts";

/** A view call on the spend-policy contract. */
export type ContractView = (method: string, args?: Record<string, unknown>) => Promise<unknown>;

/** A PO as the contract returns it from `get_po` and `list_pos`. */
export interface ContractPo {
  po_id: string;
  supplier: string;
  amount: string;
  category: string;
  status: string;
  approved_by: string | null;
  supplier_lot: string | null;
}

export interface Check {
  name: string;
  ok: boolean;
  /** Plain lines: what agreed, with the numbers; or what did not, record by record. */
  lines: string[];
  /** Could not be checked against this contract (ok stays true; the lines say why). */
  skipped?: boolean;
}

export interface Reconciliation {
  ok: boolean;
  checks: Check[];
}

export interface ReconcileInput {
  dayOne: Ledger;
  erpDb: Erp;
  erp: ErpConnector;
  view: ContractView;
  /**
   * Pooled POs paid in the recorded group purchasing run (`npm run demo:group`, GROUP_BUY.md).
   * That run keeps its own ledger and the mock ERP does not book it, so a contract PO that
   * matches one of these exactly (id, amount, supplier, released) is reported as the group
   * buy, and its payout is added back in the escrow check. Anything else stays a mismatch.
   */
  groupRuns?: readonly GroupRunPo[];
}

export interface GroupRunPo {
  poNo: string;
  /** Token base units. */
  amount: string;
  supplier: string;
  /** The `qc_release` transaction in the recording. */
  releaseTx: string;
}

/** Contract statuses that still hold money, or have paid it out. */
const HOLDING = new Set(["Funded", "Accepted", "Shipped", "Received"]);
const PAID = "Released";

/** What Day One calls each contract status, and what the ERP's mirror should record. */
const STATUS_MAP: Record<string, { dayOne: readonly string[]; erp: string }> = {
  Funded: { dayOne: ["funded"], erp: "funded" },
  Accepted: { dayOne: ["funded"], erp: "funded" },
  Shipped: { dayOne: ["funded"], erp: "funded" },
  Received: { dayOne: ["received"], erp: "funded" },
  Released: { dayOne: ["paid"], erp: "paid" },
  Refunded: { dayOne: ["rejected"], erp: "refunded" },
  Cancelled: { dayOne: ["cancelled"], erp: "cancelled" },
};

const money = (units: number | string | bigint) => formatUsd(Number(units));
const short = (hash: string | null | undefined) => (hash ? `${hash.slice(0, 8)}…` : "none");

function qtyText(base: number, dimension: string) {
  if (dimension !== "mass") return `${base.toLocaleString("en-US")} ea`;
  return `${(base / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

function setting(db: Erp, key: string, fallback: string) {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? fallback;
}

export async function reconcile(input: ReconcileInput): Promise<Reconciliation> {
  const checks = [
    await inventory(input),
    await purchaseOrdersCheck(input),
    await payments(input),
    await escrow(input),
    await strangers(input),
    generalLedger(input),
    await supplierStanding(input),
  ];
  return { ok: checks.every((c) => c.ok), checks };
}

/** Day One's on-hand quantity per material and plant equals the ERP's derived balance. */
async function inventory({ dayOne, erp, erpDb }: ReconcileInput): Promise<Check> {
  const rows = dayOne
    .select({
      material: materials.code,
      dimension: materials.dimension,
      facility: facilities.code,
      qty: lotBalances.onHandBase,
    })
    .from(lotBalances)
    .innerJoin(lots, eq(lots.id, lotBalances.lotId))
    .innerJoin(materials, eq(materials.id, lots.materialId))
    .innerJoin(facilities, eq(facilities.id, lotBalances.facilityId))
    .all();
  const dimension = new Map<string, string>();
  const expected = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.material}@${r.facility}`;
    dimension.set(r.material, r.dimension);
    expected.set(key, (expected.get(key) ?? 0) + r.qty);
  }
  const actual = new Map<string, number>();
  for (const b of await erp.getInventory()) {
    const key = `${b.materialCode}@${b.facilityCode}`;
    actual.set(key, (actual.get(key) ?? 0) + b.qtyBase);
  }
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  const lines: string[] = [];
  let compared = 0;
  for (const key of [...keys].sort()) {
    const want = expected.get(key) ?? 0;
    const have = actual.get(key) ?? 0;
    if (want === 0 && have === 0) continue;
    compared += 1;
    if (want !== have) {
      const dim = dimension.get(key.split("@")[0] ?? "") ?? "mass";
      lines.push(
        `${key.replace("@", " at Plant ")}: Day One ${qtyText(want, dim)}, ERP ${qtyText(have, dim)}`,
      );
    }
  }
  // The ERP's lot values add up to its inventory accounts: derived, not typed in.
  const tb = trialBalance(erpDb);
  const glValue = tb.rows
    .filter((r) => r.acctNumber.startsWith("14"))
    .reduce((s, r) => s + r.balanceUsdc, 0);
  const view = erpDb.$client
    .prepare("select coalesce(sum(value_usdc), 0) as v from inventory_balances")
    .get() as { v: number };
  if (glValue !== view.v) {
    lines.push(
      `ERP inventory accounts ${money(glValue)} differ from the lot balances ${money(view.v)}`,
    );
  }
  const ok = lines.length === 0;
  return {
    name: "Inventory",
    ok,
    lines: ok
      ? [
          `${compared} material-plant balances equal, lot by lot; the ERP's inventory accounts (${money(glValue)}) equal its lot values`,
        ]
      : lines,
  };
}

/** Every Day One PO past draft has an ERP mirror by number; those on the contract agree with it. */
async function purchaseOrdersCheck({ dayOne, erpDb, view }: ReconcileInput): Promise<Check> {
  const lines: string[] = [];
  const onChain: string[] = [];
  const pos = dayOne
    .select({ po: purchaseOrders, vendor: vendors })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .all()
    .filter(({ po }) => po.status !== "draft" && po.status !== "submitted");
  for (const { po, vendor } of pos) {
    const verdict = verdictOf(dayOne, po);
    const mirror = erpDb
      .select({ po: erpPurchaseOrders, vendor: erpVendors })
      .from(erpPurchaseOrders)
      .innerJoin(erpVendors, eq(erpVendors.id, erpPurchaseOrders.vendorId))
      .where(eq(erpPurchaseOrders.tranId, po.poNo))
      .get();
    if (!mirror) {
      lines.push(`${po.poNo}: in Day One (${po.status}, ${money(po.totalUsdc)}), not in the ERP`);
      continue;
    }
    if (mirror.po.totalUsdc !== po.totalUsdc)
      lines.push(
        `${po.poNo}: Day One total ${money(po.totalUsdc)}, ERP ${money(mirror.po.totalUsdc)}`,
      );
    if (mirror.vendor.entityId !== vendor.code)
      lines.push(`${po.poNo}: Day One vendor ${vendor.code}, ERP ${mirror.vendor.entityId}`);
    if (mirror.po.custbodyContractVerdict !== verdict.verdict)
      lines.push(
        `${po.poNo}: Day One says ${verdict.verdict}, the ERP's mirror says ${mirror.po.custbodyContractVerdict}`,
      );
    if ((mirror.po.custbodyNearFundingTx ?? null) !== verdict.fundingTx)
      lines.push(
        `${po.poNo}: funding tx ${short(verdict.fundingTx)} in Day One, ${short(mirror.po.custbodyNearFundingTx)} in the ERP`,
      );
    if (!verdict.fundingTx) continue;

    // Funded on the contract: the contract's record is the one that moved money.
    const chainPo = (await view("get_po", { po_id: po.poNo })) as ContractPo | null;
    if (!chainPo) {
      lines.push(
        `${po.poNo}: funded in Day One (tx ${short(verdict.fundingTx)}), not on the contract`,
      );
      continue;
    }
    if (Number(chainPo.amount) !== po.totalUsdc)
      lines.push(
        `${po.poNo}: contract holds ${money(chainPo.amount)}, Day One ${money(po.totalUsdc)}`,
      );
    if (chainPo.supplier !== vendor.nearAccountId)
      lines.push(
        `${po.poNo}: contract pays ${chainPo.supplier}, Day One's vendor account is ${vendor.nearAccountId ?? "none"}`,
      );
    if (chainPo.supplier !== mirror.vendor.payoutAccount)
      lines.push(
        `${po.poNo}: contract pays ${chainPo.supplier}, the ERP's verified payout account is ${mirror.vendor.payoutAccount ?? "none"}`,
      );
    const map = STATUS_MAP[chainPo.status];
    if (!map) lines.push(`${po.poNo}: contract status ${chainPo.status} is not one Day One knows`);
    else {
      if (!map.dayOne.includes(po.status))
        lines.push(`${po.poNo}: ${chainPo.status} on the contract, ${po.status} in Day One`);
      if (mirror.po.custbodyContractVerdict !== map.erp)
        lines.push(
          `${po.poNo}: ${chainPo.status} on the contract, verdict ${mirror.po.custbodyContractVerdict} in the ERP`,
        );
    }
    onChain.push(`${po.poNo} ${chainPo.status.toLowerCase()} ${money(chainPo.amount)}`);
  }
  const ok = lines.length === 0;
  return {
    name: "Purchase orders",
    ok,
    lines: ok
      ? [
          `${pos.length} Day One POs mirrored in the ERP by number: totals, vendors and verdicts agree`,
          `${onChain.length} of them on the contract, where amount, payee account and status agree: ${onChain.join(", ") || "none"}`,
        ]
      : lines,
  };
}

/** Every escrow release on the contract is one ERP payment with the same hash and amount, on an approved bill; and the other way round. */
async function payments({ dayOne, erpDb, view }: ReconcileInput): Promise<Check> {
  const lines: string[] = [];
  const releases = dayOne
    .select({ tx: chainTx, po: purchaseOrders })
    .from(chainTx)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, chainTx.relatedId))
    .where(
      and(
        eq(chainTx.relatedType, "purchase_order"),
        eq(chainTx.kind, "qc_release"),
        eq(chainTx.status, "success"),
      ),
    )
    .all();
  const erpPayments = erpDb
    .select({ payment: vendorPayments, bill: vendorBills })
    .from(vendorPayments)
    .leftJoin(vendorBills, eq(vendorBills.id, vendorPayments.appliedBillId))
    .where(eq(vendorPayments.paymentMethod, "escrowRelease"))
    .all();
  const summary: string[] = [];
  for (const { tx, po } of releases) {
    const chainPo = (await view("get_po", { po_id: po.poNo })) as ContractPo | null;
    if (chainPo?.status !== PAID) {
      lines.push(
        `${po.poNo}: Day One recorded a release (tx ${short(tx.txHash)}); the contract says ${chainPo?.status ?? "no such PO"}`,
      );
      continue;
    }
    const found = erpPayments.find((p) => p.payment.custbodyNearTx === tx.txHash);
    if (!found) {
      lines.push(
        `${po.poNo}: released ${money(chainPo.amount)} on the contract (tx ${short(tx.txHash)}); the ERP has no payment with that hash`,
      );
      continue;
    }
    const { payment, bill } = found;
    if (payment.amountUsdc !== Number(chainPo.amount))
      lines.push(
        `${po.poNo}: contract released ${money(chainPo.amount)}, ERP payment ${payment.tranId} is ${money(payment.amountUsdc)}`,
      );
    if (!bill)
      lines.push(
        `${po.poNo}: ERP payment ${payment.tranId} is held on account, not applied to a bill`,
      );
    else {
      if (bill.approvalStatus !== "approved" || bill.matchStatus !== "matched")
        lines.push(
          `${po.poNo}: ERP payment ${payment.tranId} applied to ${bill.tranId}, which is ${bill.matchStatus} and ${bill.approvalStatus}`,
        );
      if (bill.totalUsdc !== payment.amountUsdc || bill.status !== "paidInFull")
        lines.push(
          `${po.poNo}: bill ${bill.tranId} is ${money(bill.totalUsdc)} and ${bill.status}; the payment is ${money(payment.amountUsdc)}`,
        );
      summary.push(
        `${po.poNo} ${money(chainPo.amount)} to ${chainPo.supplier}, tx ${short(tx.txHash)} = ERP ${payment.tranId} on ${bill.tranId} (${bill.matchStatus}, ${bill.approvalStatus}, ${bill.status === "paidInFull" ? "paid in full" : bill.status})`,
      );
    }
  }
  const releaseHashes = new Set(releases.map((r) => r.tx.txHash));
  for (const { payment } of erpPayments) {
    if (!releaseHashes.has(payment.custbodyNearTx ?? ""))
      lines.push(
        `ERP payment ${payment.tranId} (${money(payment.amountUsdc)}, ref ${short(payment.externalId)}) matches no release Day One recorded`,
      );
  }
  const ok = lines.length === 0;
  return {
    name: "Payments",
    ok,
    lines: ok
      ? [
          releases.length === 0
            ? "no escrow releases yet; the ERP has no escrow payments either"
            : `${releases.length} escrow release${releases.length === 1 ? "" : "s"}: ${summary.join("; ")}`,
        ]
      : lines,
  };
}

/** Every PO on the contract, in submission order. */
async function contractPos(view: ContractView): Promise<ContractPo[]> {
  const all: ContractPo[] = [];
  for (let from = 0; ; from += 100) {
    const page = (await view("list_pos", { from, limit: 100 })) as ContractPo[];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

/** Contract POs that are exactly a paid PO of the recorded group run. */
function groupRunPos(all: readonly ContractPo[], groupRuns: readonly GroupRunPo[] = []) {
  return all.flatMap((p) => {
    const run = groupRuns.find((g) => g.poNo === p.po_id);
    return run && p.status === PAID && p.amount === run.amount && p.supplier === run.supplier
      ? [{ po: p, run }]
      : [];
  });
}

/** What the ERP books as money at the contract equals what the contract still holds. */
async function escrow({ erpDb, view, groupRuns }: ReconcileInput): Promise<Check> {
  const budget = (await view("get_budget")) as { budget: string; escrowed: string };
  const account = setting(erpDb, "escrowClearingAccount", "1050");
  const tb = trialBalance(erpDb);
  const erpHeld = tb.rows.find((r) => r.acctNumber === account)?.balanceUsdc ?? 0;
  const group = groupRunPos(await contractPos(view), groupRuns);
  const groupPaid = group.reduce((sum, g) => sum + Number(g.po.amount), 0);
  const chainHeld = Number(budget.budget) + Number(budget.escrowed) + groupPaid;
  const ok = erpHeld === chainHeld;
  const plus = group.length
    ? ` + paid by the group buy ${money(groupPaid)} (${group.map((g) => g.po.po_id).join(", ")})`
    : "";
  return {
    name: "Escrow",
    ok,
    lines: [
      ok
        ? `ERP account ${account} ${money(erpHeld)} = contract budget ${money(budget.budget)} + in escrow ${money(budget.escrowed)}${plus}`
        : `ERP account ${account} holds ${money(erpHeld)}; the contract holds ${money(chainHeld - groupPaid)} (budget ${money(budget.budget)} + escrow ${money(budget.escrowed)})${plus}; difference ${money(erpHeld - chainHeld)}`,
    ],
  };
}

/** POs on the contract that Day One never created: fine while they hold no money. */
async function strangers({ dayOne, view, groupRuns }: ReconcileInput): Promise<Check> {
  const known = new Set(
    dayOne
      .select({ poNo: purchaseOrders.poNo })
      .from(purchaseOrders)
      .all()
      .map((p) => p.poNo),
  );
  const all = await contractPos(view);
  const group = groupRunPos(all, groupRuns);
  const grouped = new Set(group.map((g) => g.po.po_id));
  const unknown = all.filter((p) => !known.has(p.po_id));
  const lines = unknown
    .filter((p) => !grouped.has(p.po_id))
    .filter((p) => HOLDING.has(p.status) || p.status === PAID)
    .map(
      (p) =>
        `${p.po_id} is ${p.status} with ${money(p.amount)} ${p.status === PAID ? "paid to" : "held for"} ${p.supplier} and has no Day One PO`,
    );
  const ok = lines.length === 0;
  return {
    name: "Contract POs not in Day One",
    ok,
    lines: ok
      ? [
          unknown.length === 0
            ? "none: every PO on the contract is one of Day One's"
            : unknown.length === group.length
              ? groupLine(group)
              : `${unknown.length - group.length} (rehearsals and cancelled tests): all cancelled or refunded, none holding or paid` +
                (group.length ? `; ${groupLine(group)}` : ""),
        ]
      : lines,
  };
}

function groupLine(group: ReturnType<typeof groupRunPos>) {
  return group
    .map(
      (g) =>
        `${g.po.po_id} ${money(g.po.amount)} to ${g.po.supplier} is the recorded group purchase (npm run demo:group, release tx ${short(g.run.releaseTx)}), booked in its own run, not in this ERP`,
    )
    .join("; ");
}

/** The ERP's ledger balances, and its payables account equals its open approved bills. */
function generalLedger({ erpDb }: ReconcileInput): Check {
  const tb = trialBalance(erpDb);
  const apAccount = setting(erpDb, "accountsPayableAccount", "2000");
  const apBalance = -(tb.rows.find((r) => r.acctNumber === apAccount)?.balanceUsdc ?? 0);
  const openBills = erpDb
    .select()
    .from(vendorBills)
    .where(and(eq(vendorBills.approvalStatus, "approved"), inArray(vendorBills.status, ["open"])))
    .all();
  const owed = openBills.reduce((s, b) => s + b.totalUsdc - b.amountPaidUsdc, 0);
  const lines: string[] = [];
  if (!tb.balanced)
    lines.push(
      `trial balance out of balance: debits ${money(tb.totalDebits)}, credits ${money(tb.totalCredits)}`,
    );
  if (apBalance !== owed)
    lines.push(
      `accounts payable ${money(apBalance)}; open approved bills owe ${money(owed)} (${openBills.length} bills)`,
    );
  const ok = lines.length === 0;
  return {
    name: "General ledger",
    ok,
    lines: ok
      ? [
          `debits = credits (${money(tb.totalDebits)}); accounts payable ${money(apBalance)} = ${openBills.length} open approved bill${openBills.length === 1 ? "" : "s"}`,
        ]
      : lines,
  };
}

/**
 * The ERP's status for every vendor the escrow can pay (one with a verified payout account)
 * agrees with that account's credential on the contract (credentials.ts). Skipped, not failed,
 * on a contract deployed before supplier credentials, which has no `get_supplier_standing`.
 */
async function supplierStanding({ erp, view }: ReconcileInput): Promise<Check> {
  const name = "Supplier standing";
  const payable = (await erp.listVendors())
    .filter((v) => v.payoutAccount)
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows: StandingComparison[] = [];
  for (const vendor of payable) {
    let standing: ContractStanding;
    try {
      standing = (await view("get_supplier_standing", {
        supplier: vendor.payoutAccount,
      })) as ContractStanding;
    } catch {
      return {
        name,
        ok: true,
        skipped: true,
        lines: [
          "not checked: this contract has no supplier credentials (deployed before them; read again after the redeploy)",
        ],
      };
    }
    rows.push(compareStanding(vendor, standing));
  }
  const off = rows.filter((r) => !r.agree);
  return {
    name,
    ok: off.length === 0,
    lines:
      off.length === 0
        ? [
            `${rows.length} vendors the escrow can pay: ERP status and on-chain credential agree`,
            ...rows.map((r) => r.line),
          ]
        : off.map((r) => r.line),
  };
}

interface FixtureEntry {
  type?: string;
  request?: { method?: string; args?: Record<string, unknown> };
  outcome?: { status?: string; txHash?: string | null };
}

/**
 * The paid pooled POs of a recorded group run (`data/replay/group-chain.json`): each funded
 * `submit_pooled_po` with the `qc_release` that paid it. Only a recording on `network` counts.
 */
export function groupRunsFromFixture(
  fixture: { network?: string; entries?: FixtureEntry[] },
  network: string,
): GroupRunPo[] {
  if (fixture.network !== network) return [];
  const entries = fixture.entries ?? [];
  const ok = (e: FixtureEntry, method: string) =>
    e.request?.method === method && e.outcome?.status === "success";
  return entries
    .filter((e) => ok(e, "submit_pooled_po"))
    .flatMap((e) => {
      const args = e.request?.args ?? {};
      const release = entries.find(
        (r) => ok(r, "qc_release") && r.request?.args?.po_id === args.po_id,
      );
      return release?.outcome?.txHash
        ? [
            {
              poNo: String(args.po_id),
              amount: String(args.amount),
              supplier: String(args.supplier),
              releaseTx: release.outcome.txHash,
            },
          ]
        : [];
    });
}
