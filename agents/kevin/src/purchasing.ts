// From a forecast to a PO draft: request quotes, rank them with the qualification rules, and
// draft the PO with the hash the director's approval is bound to. No LLM and no chain here;
// `submit_po` is the next step and the contract enforces the limits, not this file.
//
// Ranking rules (SPEC step 4, FICTIONAL_DATA §5): an unqualified or suspended vendor is
// excluded with a reason even when cheapest; a quote that cannot arrive by the need-by date is
// excluded; the rest are ranked by landed cost (quantity × price + freight), then lead time.
// A conditional vendor may win but always needs the director's approval.

import { canonicalJson, sha256Hex } from "@day-one/server/canonical";
import type { LoggedOutcome } from "@day-one/server/chain/client";
import type { Ledger } from "@day-one/server/ledger/db";
import {
  materials,
  poLines,
  purchaseOrders,
  quotes,
  rfqs,
  vendorMaterials,
  vendors,
} from "@day-one/server/ledger/schema";
import { formatUsd } from "@day-one/server/money";
import {
  type QuoteTerms,
  quoteFingerprint,
  quoteTermsOf,
  type RfqRequest,
} from "@day-one/server/quotes";
import type { QuoteSpec } from "@day-one/server/seed/quotes";
import { eq } from "drizzle-orm";
import type { Forecast } from "./forecast.ts";

const DAY_MS = 86_400_000;

/** Base units for a quantity in mg (or each) at a price per inventory unit, rounded half up. */
export function extendedUsdc(qtyBase: number, unitPriceUsdc: number, baseUnitsPerUnit: number) {
  const scaled = BigInt(qtyBase) * BigInt(unitPriceUsdc);
  const divisor = BigInt(baseUnitsPerUnit);
  return Number((scaled * 2n + divisor) / (divisor * 2n));
}

const usd = (units: number) => formatUsd(BigInt(units));

function baseUnitsPerUnit(dimension: string) {
  return dimension === "mass" ? 1_000_000 : 1;
}

/** An answer Kevin did not record as a quote, with the reason staff see. */
export interface IgnoredQuote {
  vendor: string;
  name: string | null;
  account: string | null;
  /** The listed vendor the sender imitates, when its name or account is a near copy. */
  imitates: { code: string; name: string; account: string | null } | null;
  reason: string;
}

/**
 * A quote as it reaches Kevin: the terms, and, from a supplier agent, the salt and fingerprint
 * it anchored with the anchor's outcome (agents/suppliers). Plain answers carry none of that.
 */
export interface QuoteAnswer extends QuoteSpec {
  salt?: string;
  hash?: string;
  anchor?: LoggedOutcome | null;
}

/** A quote Kevin recorded, with what a judge needs to verify its anchor. */
export interface RecordedQuote {
  quoteId: number;
  vendorCode: string;
  terms: QuoteTerms;
  salt: string;
  hash: string;
  anchor: LoggedOutcome | null;
}

export interface Rfq extends RfqRequest {
  materialId: number;
  facilityId: number;
  quotes: RecordedQuote[];
  ignored: IgnoredQuote[];
}

/**
 * A name or account reduced to what a reader sees: lower case, letters and digits only, and
 * the usual stand-ins folded (l and 1 for i, 0 for o, rn for m).
 */
export function skeleton(text: string) {
  return text
    .toLowerCase()
    .replace(/\.(testnet|near)$/, "")
    .replace(/rn/g, "m")
    .replace(/[l1|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** The listed vendor whose name or account the sender's is a near copy of (but not equal to). */
export function lookalikeOf(
  sender: { name?: string; account?: string },
  listed: readonly { code: string; name: string; nearAccountId: string | null }[],
) {
  const close = (a: string | undefined, b: string | null) => {
    if (!a || !b || a === b) return false;
    const [x, y] = [skeleton(a), skeleton(b)];
    return x === y || editDistance(x, y) <= 2;
  };
  const match = listed.find(
    (v) => close(sender.name, v.name) || close(sender.account, v.nearAccountId),
  );
  return match ? { code: match.code, name: match.name, account: match.nearAccountId } : null;
}

/** Opens an RFQ for the forecast's recommended quantity; the bus answers it. */
export function openRfq(db: Ledger, forecast: Forecast, rfqNo: string): Rfq {
  if (!forecast.recommendQtyBase || !forecast.needBy) {
    throw new Error(`${rfqNo}: the forecast recommends no order`);
  }
  const material = db
    .select({ code: materials.code })
    .from(materials)
    .where(eq(materials.id, forecast.materialId))
    .get();
  if (!material) throw new Error(`${rfqNo}: unknown material`);
  const rfq = db
    .insert(rfqs)
    .values({
      rfqNo,
      materialId: forecast.materialId,
      qtyBase: forecast.recommendQtyBase,
      needBy: forecast.needBy,
      facilityId: forecast.facilityId,
      createdBy: "kevin",
    })
    .returning()
    .get();
  return {
    id: rfq.id,
    rfqNo,
    material: material.code,
    materialId: rfq.materialId,
    facilityId: rfq.facilityId,
    qtyBase: rfq.qtyBase,
    needBy: rfq.needBy,
    quotes: [],
    ignored: [],
  };
}

/**
 * Records one quote per answering vendor. Only vendors listed for the material are asked;
 * `answers` are their replies. An answer from anyone else is not recorded: it lands in
 * `ignored` with the reason, and a sender whose name or account imitates a vendor on the list
 * is called out as a lookalike. A quote that no longer matches the fingerprint its sender
 * anchored is ignored too: the price changed after the supplier committed to it.
 */
export function recordQuotes(db: Ledger, rfq: Rfq, answers: readonly QuoteAnswer[]): Rfq {
  const listed = new Set(
    db
      .select({ code: vendors.code })
      .from(vendorMaterials)
      .innerJoin(vendors, eq(vendors.id, vendorMaterials.vendorId))
      .where(eq(vendorMaterials.materialId, rfq.materialId))
      .all()
      .map((v) => v.code),
  );
  const allVendors = db.select().from(vendors).all();
  const { ignored } = rfq;
  for (const answer of answers) {
    const vendor = allVendors.find((v) => v.code === answer.vendor);
    // A known code is not enough: the answer must also come from that vendor's account.
    const sameSender =
      vendor &&
      (!answer.account || answer.account === vendor.nearAccountId) &&
      (!answer.name || answer.name === vendor.name);
    if (!vendor || !sameSender || !listed.has(vendor.code)) {
      // Using a listed vendor's code from another account is imitation too, however unlike.
      const claimed =
        vendor && !sameSender
          ? { code: vendor.code, name: vendor.name, account: vendor.nearAccountId }
          : null;
      const imitates = lookalikeOf(answer, allVendors) ?? claimed;
      const who = answer.name ?? vendor?.name ?? answer.vendor;
      ignored.push({
        vendor: answer.vendor,
        name: answer.name ?? null,
        account: answer.account ?? null,
        imitates,
        reason: imitates
          ? `${who}${answer.account ? ` (${answer.account})` : ""} is not on the supplier list; ` +
            `it ${imitates === claimed ? "claims to be" : "looks like"} ${imitates.name}` +
            `${imitates.account ? ` (${imitates.account})` : ""}`
          : vendor && sameSender
            ? `${who} is not listed for this material`
            : `${who} is not on the supplier list`,
      });
      continue;
    }
    const terms = quoteTermsOf(rfq, vendor.nearAccountId ?? vendor.code, answer);
    const salt = answer.salt ?? "";
    const hash = quoteFingerprint(terms, salt);
    if (answer.hash && answer.hash !== hash) {
      ignored.push({
        vendor: answer.vendor,
        name: answer.name ?? null,
        account: answer.account ?? null,
        imitates: null,
        reason: `${vendor.name}'s quote does not match the fingerprint it sent`,
      });
      continue;
    }
    const anchor = answer.anchor ?? null;
    const quote = db
      .insert(quotes)
      .values({
        rfqId: rfq.id,
        vendorId: vendor.id,
        unitPriceUsdc: terms.unitPriceUsdc,
        freightUsdc: terms.freightUsdc,
        leadTimeDays: terms.leadTimeDays,
        status: "received",
        quoteHash: hash,
        chainTxId: anchor?.status === "success" ? anchor.id : null,
      })
      .returning({ id: quotes.id })
      .get();
    rfq.quotes.push({ quoteId: quote.id, vendorCode: vendor.code, terms, salt, hash, anchor });
  }
  return rfq;
}

/** Opens the RFQ and records the answers in one step, for callers with the answers in hand. */
export function requestQuotes(
  db: Ledger,
  forecast: Forecast,
  rfqNo: string,
  answers: readonly QuoteAnswer[],
): Rfq {
  return recordQuotes(db, openRfq(db, forecast, rfqNo), answers);
}

export interface RankedQuote {
  quoteId: number;
  vendorId: number;
  vendorCode: string;
  vendorName: string;
  unitPriceUsdc: number;
  freightUsdc: number;
  leadTimeDays: number;
  landedUsdc: number;
  needsApproval: boolean;
  outcome: "selected" | "runner-up" | "declined" | "excluded";
  reason: string;
}

export interface Ranking {
  rfq: Rfq;
  ranked: RankedQuote[];
  selected: RankedQuote | null;
  sentence: string;
}

/** A vendor's name as Kevin says it in a ranked line: "Northgate", "Ridgeway". */
const shortName = (name: string) => name.split(" ")[0] ?? name;

/** Ranks the RFQ's quotes as of `now` and writes each quote's status and exclusion reason. */
export function rankQuotes(db: Ledger, rfq: Rfq, now: string): Ranking {
  const material = db.select().from(materials).where(eq(materials.id, rfq.materialId)).get();
  if (!material) throw new Error(`${rfq.rfqNo}: unknown material`);
  const perUnit = baseUnitsPerUnit(material.dimension);
  const daysToNeed = Math.floor((Date.parse(rfq.needBy) - Date.parse(now.slice(0, 10))) / DAY_MS);

  const rows = db
    .select({ quote: quotes, vendor: vendors })
    .from(quotes)
    .innerJoin(vendors, eq(vendors.id, quotes.vendorId))
    .where(eq(quotes.rfqId, rfq.id))
    .all();
  const candidates: RankedQuote[] = rows.map(({ quote, vendor }) => {
    const excluded =
      vendor.qualificationStatus === "unqualified" || vendor.qualificationStatus === "suspended"
        ? `vendor not ${vendor.qualificationStatus === "suspended" ? "active" : "qualified"}`
        : quote.leadTimeDays > daysToNeed
          ? `${quote.leadTimeDays}-day lead time misses the ${rfq.needBy} need date`
          : null;
    return {
      quoteId: quote.id,
      vendorId: vendor.id,
      vendorCode: vendor.code,
      vendorName: vendor.name,
      unitPriceUsdc: quote.unitPriceUsdc,
      freightUsdc: quote.freightUsdc,
      leadTimeDays: quote.leadTimeDays,
      landedUsdc: extendedUsdc(rfq.qtyBase, quote.unitPriceUsdc, perUnit) + quote.freightUsdc,
      needsApproval: vendor.qualificationStatus === "conditional",
      outcome: excluded ? "excluded" : "declined",
      reason: excluded ?? "",
    };
  });

  const eligible = candidates
    .filter((c) => c.outcome !== "excluded")
    .sort((a, b) => a.landedUsdc - b.landedUsdc || a.leadTimeDays - b.leadTimeDays);
  const [first, second] = eligible;
  if (first) {
    first.outcome = "selected";
    first.reason = first.needsApproval
      ? "lowest landed cost; conditional vendor, needs director approval"
      : "qualified, lowest landed cost, arrives before the need date";
  }
  if (second) {
    second.outcome = "runner-up";
    second.reason = "next lowest landed cost";
  }
  for (const c of eligible.slice(2)) c.reason = "higher landed cost";

  for (const c of candidates) {
    db.update(quotes)
      .set({
        status:
          c.outcome === "excluded"
            ? "excluded"
            : c.outcome === "selected"
              ? "accepted"
              : "declined",
        exclusionReason: c.outcome === "excluded" ? c.reason : null,
      })
      .where(eq(quotes.id, c.quoteId))
      .run();
  }

  const unit = material.dimension === "mass" ? "kg" : "each";
  const excludedFirst = [...candidates.filter((c) => c.outcome === "excluded"), ...eligible];
  const parts = excludedFirst.map((c) =>
    c.outcome === "excluded"
      ? `${c.vendorName} ${usd(c.unitPriceUsdc)}/${unit} excluded: ${c.reason}.`
      : `${shortName(c.vendorName)} ${usd(c.unitPriceUsdc)}/${unit}, ${c.leadTimeDays} days${
          c.outcome === "selected" ? " — selected" : c.outcome === "runner-up" ? " — runner-up" : ""
        }.`,
  );
  return {
    rfq,
    ranked: excludedFirst,
    selected: first ?? null,
    sentence: [`${candidates.length} quote${candidates.length === 1 ? "" : "s"}.`, ...parts].join(
      " ",
    ),
  };
}

export interface PoLineInput {
  material: string;
  qtyBase: number;
  unitPriceUsdc: number;
  quoteId?: number;
}

export interface PoDraftInput {
  poNo: string;
  vendor: string;
  facilityId: number;
  lines: readonly PoLineInput[];
  freightUsdc?: number;
  needBy: string | null;
  /** Hex salt mixed into `po_hash` so its terms cannot be guessed from the hash. */
  salt: string;
}

export interface PoDraft {
  id: number;
  poNo: string;
  vendor: { code: string; name: string; account: string | null };
  category: typeof purchaseOrders.category._.data;
  totalUsdc: number;
  poHash: string;
  /** What the hash covers, in canonical order; stored with the PO for verification. */
  terms: Record<string, unknown>;
}

const CATEGORY_OF_MATERIAL = {
  active: "raw_material",
  excipient: "raw_material",
  packaging: "packaging",
  lab_chemical: "lab_chemical",
} as const;

/** Writes a draft PO with its lines and `po_hash` (DATA_MODEL §7). */
export function draftPo(db: Ledger, input: PoDraftInput): PoDraft {
  const vendor = db.select().from(vendors).where(eq(vendors.code, input.vendor)).get();
  if (!vendor) throw new Error(`${input.poNo}: unknown vendor ${input.vendor}`);
  const lines = input.lines.map((line, i) => {
    const material = db.select().from(materials).where(eq(materials.code, line.material)).get();
    if (!material) throw new Error(`${input.poNo}: unknown material ${line.material}`);
    return {
      lineNo: i + 1,
      material,
      qtyBase: line.qtyBase,
      unit: material.dimension === "mass" ? "kg" : "each",
      unitPriceUsdc: line.unitPriceUsdc,
      extendedUsdc: extendedUsdc(
        line.qtyBase,
        line.unitPriceUsdc,
        baseUnitsPerUnit(material.dimension),
      ),
      quoteId: line.quoteId ?? null,
    };
  });
  const categories = new Set(lines.map((l) => CATEGORY_OF_MATERIAL[l.material.category]));
  const [category] = categories;
  if (!category || categories.size > 1) {
    throw new Error(`${input.poNo}: a PO covers exactly one spend category`);
  }
  const freightUsdc = input.freightUsdc ?? 0;
  const totalUsdc = lines.reduce((sum, l) => sum + l.extendedUsdc, freightUsdc);
  const terms = {
    po: input.poNo,
    vendor: vendor.nearAccountId ?? vendor.code,
    lines: lines.map((l) => ({
      material: l.material.code,
      qtyBase: l.qtyBase,
      unit: l.unit,
      unitPriceUsdc: l.unitPriceUsdc,
      extendedUsdc: l.extendedUsdc,
    })),
    freightUsdc,
    totalUsdc,
    needBy: input.needBy,
    salt: input.salt,
  };
  const poHash = sha256Hex(canonicalJson(terms));
  const po = db
    .insert(purchaseOrders)
    .values({
      poNo: input.poNo,
      vendorId: vendor.id,
      shipToFacilityId: input.facilityId,
      category,
      freightUsdc,
      totalUsdc,
      status: "draft",
      poHash,
      createdBy: "kevin",
      needBy: input.needBy,
    })
    .returning()
    .get();
  db.insert(poLines)
    .values(
      lines.map((l) => ({
        poId: po.id,
        lineNo: l.lineNo,
        materialId: l.material.id,
        qtyBase: l.qtyBase,
        unit: l.unit,
        unitPriceUsdc: l.unitPriceUsdc,
        extendedUsdc: l.extendedUsdc,
        quoteId: l.quoteId,
      })),
    )
    .run();
  return {
    id: po.id,
    poNo: input.poNo,
    vendor: { code: vendor.code, name: vendor.name, account: vendor.nearAccountId },
    category,
    totalUsdc,
    poHash,
    terms,
  };
}

/** The PO for a ranking's selected quote, with Kevin's one-line reason. */
export function draftPoFromRanking(
  db: Ledger,
  ranking: Ranking,
  poNo: string,
  salt: string,
): PoDraft & { why: string } {
  const chosen = ranking.selected;
  if (!chosen) throw new Error(`${ranking.rfq.rfqNo}: no eligible quote`);
  const material = db
    .select()
    .from(materials)
    .where(eq(materials.id, ranking.rfq.materialId))
    .get();
  if (!material) throw new Error(`${ranking.rfq.rfqNo}: unknown material`);
  const draft = draftPo(db, {
    poNo,
    vendor: chosen.vendorCode,
    facilityId: ranking.rfq.facilityId,
    lines: [
      {
        material: material.code,
        qtyBase: ranking.rfq.qtyBase,
        unitPriceUsdc: chosen.unitPriceUsdc,
        quoteId: chosen.quoteId,
      },
    ],
    freightUsdc: chosen.freightUsdc,
    needBy: ranking.rfq.needBy,
    salt,
  });
  const cheaper = ranking.ranked.find(
    (q) => q.outcome === "excluded" && q.unitPriceUsdc < chosen.unitPriceUsdc,
  );
  const why =
    `${chosen.vendorName} is the lowest-cost qualified supplier at ${usd(draft.totalUsdc)} ` +
    `delivered in ${chosen.leadTimeDays} days, before the ${ranking.rfq.needBy} batch.` +
    (cheaper
      ? ` ${cheaper.vendorName} was cheaper but is ${cheaper.reason.replace(/^vendor /, "")}.`
      : "");
  return { ...draft, why };
}
