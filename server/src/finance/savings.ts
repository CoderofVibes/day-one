// The savings ledger (docs/UPGRADE_BRIEF.md §2.4 item 7): one entry per saving, each with its
// formula, the arithmetic, its evidence and whether it was realized or only identified. Built from
// recorded or generated records only; where a formula's input is missing the saving is listed
// under `notCounted` with the reason, never estimated. Refused attacks are not savings: they are
// "payments protected", a separate figure.

import type { World } from "../world/index.ts";
import {
  type BatchRec,
  batchCost,
  day,
  type LotRec,
  type MoneyBook,
  type SavingEntry,
} from "./money.ts";

const USD = 1_000_000;
const usd = (usdc: number) =>
  `$${(usdc / USD).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kgOf = (base: number) =>
  `${(base / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 })} kg`;
const perKg = (usdcPerKg: number) =>
  `$${(usdcPerKg / USD).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}/kg`;

export interface NotCounted {
  type: SavingEntry["type"];
  plant: string;
  title: string;
  reason: string;
  evidence: string[];
}

export interface Quote {
  vendor: string;
  unitPriceUsdc: number;
  freightUsdc: number;
}

/** What the recordings give the ledger, already read from their files (load.ts). */
export interface SavingsInputs {
  t0: string;
  /** Each plant's world and book, where the plant has one. */
  worlds: { world: World; book: MoneyBook }[];
  /** PO-G-2001 (web/src/data/group-buy.json): the pooled PO and each plant's share. */
  group: {
    poNo: string;
    poolId: string;
    material: string;
    unitPriceUsdc: number;
    totalUsdc: number;
    realizedAt: string;
    shares: { plant: string; plantName: string; qtyBase: number; amountUsdc: number }[];
    /** Each plant's recorded standalone RFQ for the material, if one exists. */
    standalone: Record<
      string,
      { rfqNo: string; qtyBase: number; quotes: Quote[]; winner: string } | undefined
    >;
  };
  /** Kevin's proposed moves at the end of the recorded run (web/src/data/plants.json). */
  transfers: {
    at: string;
    suggestions: {
      material: string;
      materialName: string;
      from: string;
      to: string;
      qtyBase: number;
      lots: { lotCode: string }[];
      valueUsdc: number | null;
    }[];
    freightUsd: number;
  };
  /** The recorded sealed round (data/sealed/RFQ-2611-02.round.json), opened. */
  sealed: {
    roundId: string;
    plant: string;
    awardedAt: string;
    qtyBase: number;
    quotes: Quote[];
    winner: string;
    poPlaced: boolean;
  };
  /** Duplicates held before payment in Kevin's era: the ERP's rejection at cutover. */
  heldDuplicates: {
    plant: string;
    billNo: string;
    duplicateOf: string;
    amountUsdc: number;
    heldAt: string;
  }[];
  /** Price-drift alerts in Kevin's books at cutover (books.ts priceDrift on the seed). */
  driftAlerts: {
    plant: string;
    poNo: string;
    invoiceNo: string;
    material: string;
    unitPriceUsdc: number;
    trailingUsdc: number;
    qtyBase: number;
    /** mass: prices per kg on mg quantities; count: prices per each. */
    dimension: string;
    trailingPoNos: string[];
    at: string;
  }[];
  /** Legacy drift, recomputed with the trailing prices (books.ts priceDrift over the world's POs). */
  legacyDrift: {
    plant: string;
    poNo: string;
    material: string;
    unitPriceUsdc: number;
    trailingUsdc: number;
    qtyBase: number;
    dimension: string;
    trailingPoNos: string[];
    orderedAt: string;
  }[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
};
/** A quote's landed cost for a quantity: qty × unit price + freight. */
export const landed = (q: Quote, qtyBase: number) =>
  Math.round((qtyBase / USD) * q.unitPriceUsdc) + q.freightUsdc;

/** (billed − trailing) × qty: prices are per kg on mg quantities, per each on counts. */
const driftAmount = (d: {
  unitPriceUsdc: number;
  trailingUsdc: number;
  qtyBase: number;
  dimension: string;
}) =>
  Math.round(((d.unitPriceUsdc - d.trailingUsdc) * d.qtyBase) / (d.dimension === "mass" ? USD : 1));

export function buildSavings(inputs: SavingsInputs): {
  entries: SavingEntry[];
  notCounted: NotCounted[];
} {
  const entries: SavingEntry[] = [];
  const notCounted: NotCounted[] = [];
  const t0 = inputs.t0;
  const eraAt = (at: string): SavingEntry["era"] =>
    day(at) < "2026-07-06" ? "legacy" : day(at) <= "2026-11-16" ? "anchor" : "simulated";

  // Group buy: each plant's best standalone quote for its share, landed, less what its share cost.
  const g = inputs.group;
  for (const share of g.shares) {
    const alone = g.standalone[share.plant];
    const best = alone?.quotes.find((q) => q.vendor === alone.winner);
    if (!alone || !best || alone.qtyBase !== share.qtyBase) {
      notCounted.push({
        type: "group_buy",
        plant: share.plant,
        title: `${g.poNo}: ${share.plantName}'s share`,
        reason: `No standalone quote for ${kgOf(share.qtyBase)} is recorded for ${share.plantName}; the pooled order's "price on file" is not a quote, so its share's saving is left out.`,
        evidence: [`${g.poNo} · ${share.plantName} share`],
      });
      continue;
    }
    const aloneUsdc = landed(best, share.qtyBase);
    entries.push({
      id: `group:${g.poNo}:${share.plant}`,
      type: "group_buy",
      plant: share.plant,
      title: `Group buy ${g.poNo}: ${share.plantName}'s share`,
      amountUsdc: aloneUsdc - share.amountUsdc,
      status: "realized",
      identifiedAt: g.realizedAt,
      realizedAt: g.realizedAt,
      evidence: [`${g.poNo} · ${share.plantName} share`, alone.rfqNo],
      formula:
        "(best standalone quote, landed, for the plant's quantity) − (the plant's share of the pooled PO). Never the PO total.",
      working: `${alone.rfqNo} best: ${kgOf(share.qtyBase)} × ${perKg(best.unitPriceUsdc)} + ${usd(best.freightUsdc)} freight = ${usd(aloneUsdc)}; share of ${g.poNo} at ${perKg(g.unitPriceUsdc)} pooled = ${usd(share.amountUsdc)}; saving ${usd(aloneUsdc - share.amountUsdc)}.`,
      era: eraAt(g.realizedAt),
    });
  }

  // Inter-plant transfers: the purchase avoided at the last price paid, less the move's freight.
  // Kevin proposes them; none is approved in the recording, so each is identified.
  const freight = Math.round(inputs.transfers.freightUsd * USD);
  for (const s of inputs.transfers.suggestions) {
    const lot = s.lots.map((l) => l.lotCode).join(", ");
    if (s.valueUsdc === null) {
      notCounted.push({
        type: "transfer",
        plant: s.to,
        title: `Move ${s.materialName} ${s.from} → ${s.to}`,
        reason:
          "No price has been paid for this material at the receiving plant, so the avoided purchase has no value on record.",
        evidence: [lot],
      });
      continue;
    }
    entries.push({
      id: `transfer:${s.material}:${s.from}-${s.to}`,
      type: "transfer",
      plant: s.to,
      title: `Move ${s.materialName} from Plant ${s.from} to Plant ${s.to}`,
      amountUsdc: s.valueUsdc - freight,
      status: "identified",
      identifiedAt: inputs.transfers.at,
      realizedAt: null,
      evidence: [lot],
      formula:
        "avoided purchase (qty × last price paid) − transfer freight (assumed). Realized when the move is approved and made.",
      working: `${usd(s.valueUsdc)} of ${s.material} at the last price paid − ${usd(freight)} freight = ${usd(s.valueUsdc - freight)}.`,
      era: eraAt(inputs.transfers.at),
    });
  }

  // Sealed bid: landed quotes, the median of the other qualified quotes less the winner's.
  {
    const s = inputs.sealed;
    const winner = s.quotes.find((q) => q.vendor === s.winner);
    const others = s.quotes.filter((q) => q.vendor !== s.winner);
    if (winner && others.length) {
      const w = landed(winner, s.qtyBase);
      const m = Math.round(median(others.map((q) => landed(q, s.qtyBase))));
      entries.push({
        id: `sealed:${s.roundId}`,
        type: "sealed_bid",
        plant: s.plant,
        title: `Sealed round ${s.roundId}`,
        amountUsdc: m - w,
        status: s.poPlaced ? "realized" : "identified",
        identifiedAt: s.awardedAt,
        realizedAt: s.poPlaced ? s.awardedAt : null,
        evidence: [s.roundId],
        formula:
          "(median of the other qualified quotes − winning quote), each landed (qty × price + freight). Not against the incumbent's last price, which is the winner's here. Identified until a PO is placed from the round.",
        working: `${others.map((q) => `${q.vendor} ${usd(landed(q, s.qtyBase))}`).join(", ")} (median ${usd(m)}) − ${winner.vendor} ${usd(w)} = ${usd(m - w)}.`,
        era: eraAt(s.awardedAt),
      });
    }
  }

  for (const { world, book } of inputs.worlds) {
    const plant = world.meta.facility;
    const lots = new Map<string, LotRec>(book.lots.map((l) => [l.lot, l]));
    const batches = new Map<string, BatchRec>(book.batches.map((b) => [b.batchNo, b]));

    // Duplicates the paper process paid: identified · recoverable (Kevin's look-back).
    for (const d of world.lookBack.duplicates) {
      const original = world.bills.find((b) => b.billNo === d.duplicateOf);
      entries.push({
        id: `duplicate:${d.billNo}`,
        type: "duplicate_invoice",
        plant,
        title: `Duplicate invoice paid before cutover: ${d.billNo.trim()}`,
        amountUsdc: d.amountUsdc,
        status: "identified",
        identifiedAt: t0,
        realizedAt: null,
        evidence: [d.billNo],
        formula:
          "the bill amount. Paid twice before Day One: identified · recoverable from the supplier.",
        working: `${d.why}; ${usd(d.amountUsdc)} paid ${d.paid ? "twice" : "once"}${original ? ` (first on ${original.billDate})` : ""}.`,
        era: "legacy",
      });
    }

    // Prices that drifted in the legacy months: (billed − trailing) × qty, identified.
    for (const d of inputs.legacyDrift.filter((x) => x.plant === plant)) {
      const amount = driftAmount(d);
      entries.push({
        id: `drift:${d.poNo}:${d.material}`,
        type: "price_drift",
        plant,
        title: `Price drift on ${d.poNo} (${d.material})`,
        amountUsdc: amount,
        status: "identified",
        identifiedAt: t0,
        realizedAt: null,
        evidence: [d.poNo],
        formula:
          "(billed price − trailing price paid) × qty. Found in the look-back; worth a call to the supplier.",
        working: `(${perKg(d.unitPriceUsdc)} − ${perKg(d.trailingUsdc)} trailing on ${d.trailingPoNos.join(", ")}) × ${kgOf(d.qtyBase)} = ${usd(amount)}.`,
        era: "legacy",
      });
    }

    // Batches issued over the formula in the legacy months: excess × lot cost, identified.
    for (const o of world.lookBack.overIssued) {
      const b = world.batches.find((x) => x.batchNo === o.batchNo);
      const rec = batches.get(o.batchNo);
      if (!b || !rec) continue;
      for (const material of o.materials) {
        // A material can be drawn from several lots, each draw repeating its formula line's
        // standard: the excess is over the material's standard (its distinct formula lines), at
        // the draws' weighted lot cost.
        const lines = b.consumption.filter((c) => c.material === material);
        const actual = lines.reduce((s, c) => s + c.actualBase, 0);
        const std = [...new Set(lines.map((c) => c.stdBase))].reduce((s, x) => s + x, 0);
        const value = lines.reduce(
          (s, c) => s + c.actualBase * (lots.get(c.lot)?.costPerBase ?? 0),
          0,
        );
        if (!lines.length || actual <= std) continue;
        const cost = value / actual;
        const excess = actual - std;
        const amount = Math.round(excess * cost);
        const line = { lot: lines.map((c) => c.lot).join(" + "), actualBase: actual, stdBase: std };
        entries.push({
          id: `over:${o.batchNo}:${material}`,
          type: "over_consumption",
          plant,
          title: `Over-consumption on ${o.batchNo} (${material})`,
          amountUsdc: amount,
          status: "identified",
          identifiedAt: t0,
          realizedAt: null,
          evidence: [o.batchNo],
          formula:
            "excess drawn over the formula × lot unit cost. Realized only when the cause is fixed and later batches return to standard in Kevin's era.",
          working: `${kgOf(line.actualBase)} drawn against ${kgOf(line.stdBase)} standard on lot ${line.lot}: ${kgOf(excess)} × ${perKg(cost * USD)} = ${usd(amount)} (batch cost ${usd(batchCost(rec, lots))}).`,
          era: "legacy",
        });
      }
    }

    // Rush freight avoided: only when the continuation shows the legacy rush did not recur.
    const legacyRush = world.pos.filter((p) => p.era === "legacy" && p.rush);
    const simRush = world.pos.filter((p) => p.era === "simulated" && p.rush);
    if (legacyRush.length) {
      const first = legacyRush[0] as (typeof legacyRush)[number];
      const comparable = `${Number(first.orderedAt.slice(0, 4)) + 1}${first.orderedAt.slice(4, 10)}`;
      const reason = simRush.length
        ? `The simulated continuation has its own rush order (${simRush.map((p) => `${p.poNo}, ${usd(p.freightUsdc)} freight`).join("; ")}), so no recurrence was prevented.`
        : world.meta.calendar.end < comparable
          ? `The legacy rush came on ${day(first.orderedAt)}; the continuation ends ${world.meta.calendar.end}, before the comparable date.`
          : null;
      const amount = legacyRush.reduce((s, p) => s + p.freightUsdc, 0);
      if (reason) {
        notCounted.push({
          type: "rush_freight",
          plant,
          title: `Rush freight avoided (${usd(amount)} paid in the legacy months)`,
          reason,
          evidence: legacyRush.map((p) => p.poNo),
        });
      } else {
        entries.push({
          id: `rush:${plant}`,
          type: "rush_freight",
          plant,
          title: "Rush freight avoided",
          amountUsdc: first.freightUsdc,
          status: "realized",
          identifiedAt: comparable,
          realizedAt: comparable,
          evidence: [first.poNo],
          formula:
            "the rush freight of the comparable legacy event, counted once the continuation passes its date with no rush.",
          working: `${first.poNo} paid ${usd(first.freightUsdc)} of next-day freight; the continuation passed ${comparable} with none.`,
          era: "simulated",
        });
      }
    }
  }

  // Duplicates held before payment in Kevin's era: realized when held.
  for (const d of inputs.heldDuplicates) {
    entries.push({
      id: `duplicate:${d.billNo}`,
      type: "duplicate_invoice",
      plant: d.plant,
      title: `Duplicate invoice held: ${d.billNo}`,
      amountUsdc: d.amountUsdc,
      status: "realized",
      identifiedAt: d.heldAt,
      realizedAt: d.heldAt,
      evidence: [d.billNo],
      formula: "the bill amount, held before payment.",
      working: `${d.billNo} repeats ${d.duplicateOf} (${usd(d.amountUsdc)}); held at cutover, never paid.`,
      era: eraAt(d.heldAt),
    });
  }

  // Drift Kevin flagged in the books at cutover: identified (the bill was paid before Day One).
  for (const d of inputs.driftAlerts) {
    const amount = driftAmount(d);
    entries.push({
      id: `drift:${d.poNo}:${d.material}`,
      type: "price_drift",
      plant: d.plant,
      title: `Price drift on ${d.invoiceNo} (${d.material})`,
      amountUsdc: amount,
      status: "identified",
      identifiedAt: d.at,
      realizedAt: null,
      evidence: [d.invoiceNo, d.poNo],
      formula:
        "(billed price − trailing price paid) × qty. Paid before Day One; worth a call to the supplier.",
      working: `(${perKg(d.unitPriceUsdc)} − ${perKg(d.trailingUsdc)} trailing on ${d.trailingPoNos.join(", ")}) × ${kgOf(d.qtyBase)} = ${usd(amount)}.`,
      era: eraAt(d.at),
    });
  }

  return {
    entries: entries.sort((a, b) =>
      a.identifiedAt < b.identifiedAt
        ? -1
        : a.identifiedAt > b.identifiedAt
          ? 1
          : a.id < b.id
            ? -1
            : 1,
    ),
    notCounted,
  };
}

export interface ProtectedPayment {
  attack: string;
  amountUsdc: number;
  what: string;
  source: string;
}

/** Recorded calls (data/replay/attacks-chain.json, data/attacks/credentials-testnet.json). */
export interface ChainEntry {
  type: string;
  request: {
    method?: string;
    args?: { po_id?: string; supplier?: string; amount?: number | string };
  };
  outcome?: { status: string; errorMessage: string | null; txHash?: string };
}

/**
 * Payments protected: what each refused attack tried to move (a protection figure, never a
 * saving). Refused `submit_po` calls count their amount, except refusals for a cap or the per-PO
 * limit, which stopped no redirect; the invoice attacks count what they asked to be paid.
 */
export function protectedPayments(
  chains: { file: string; entries: ChainEntry[] }[],
  invoices: { genuine: string; inflated: string; hidden: string },
): { totalUsdc: number; items: ProtectedPayment[] } {
  const items: ProtectedPayment[] = [];
  const seen = new Set<string>();
  for (const { file, entries } of chains) {
    for (const e of entries) {
      if (e.type !== "call" || e.request.method !== "submit_po") continue;
      if (e.outcome?.status !== "refused") continue;
      const why = e.outcome.errorMessage ?? "";
      if (/cap of|per-PO limit|approval required/i.test(why)) continue;
      // The same PO tried again is the same money: counted once.
      const key = `${e.request.args?.po_id}|${e.request.args?.supplier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const amount = Number(e.request.args?.amount ?? 0);
      items.push({
        attack: `${e.request.args?.po_id ?? "PO"} to ${e.request.args?.supplier ?? "a supplier"}`,
        amountUsdc: amount,
        what: why,
        source: e.outcome.txHash ? `${file} · tx ${e.outcome.txHash.slice(0, 8)}…` : file,
      });
    }
  }
  const total = (text: string) => {
    const m = /Total due: \$([\d,]+\.\d\d)/.exec(text);
    return m ? Math.round(Number((m[1] ?? "0").replaceAll(",", "")) * USD) : 0;
  };
  const genuine = total(invoices.genuine);
  items.push(
    {
      attack: "Inflated invoice",
      amountUsdc: total(invoices.inflated) - genuine,
      what: "billed over the PO price; held, and the PO pays only its escrow",
      source: "data/attacks/invoices.json",
    },
    {
      attack: "Hidden instructions in an invoice",
      amountUsdc: total(invoices.hidden),
      what: "asked for payment to another account; held",
      source: "data/attacks/invoices.json",
    },
    {
      attack: "Duplicate invoice",
      amountUsdc: genuine,
      what: "the same invoice again after release; the escrow paid once",
      source: "data/replay/attacks-chain.json",
    },
  );
  return { totalUsdc: items.reduce((s, i) => s + i.amountUsdc, 0), items };
}
