// A quote as it travels from a supplier agent to Kevin, and the fingerprint both sides compute
// from it. The supplier anchors the fingerprint on the spend-policy contract from its own
// account (CONTRACTS.md §6: kind "quote", ref_id "<rfq>/<account>") and sends Kevin the terms
// and the salt over the bus. The chain holds the hash alone, so a price can neither be read nor
// guessed from it, and a quote changed after the fact no longer matches its anchor.

import { canonicalJson } from "./canonical.ts";
import { parseUsd } from "./money.ts";
import { fingerprint } from "./records/anchors.ts";

/** What Kevin asks the bus for: an open RFQ from the ledger. */
export interface RfqRequest {
  /** The ledger id of the RFQ, for the chain log. */
  id: number;
  rfqNo: string;
  /** The material code. */
  material: string;
  qtyBase: number;
  needBy: string;
}

/** The terms a quote's fingerprint covers, in canonical order. */
export interface QuoteTerms {
  rfq: string;
  /** The supplier's account (the vendor code when it has none). */
  supplier: string;
  material: string;
  qtyBase: number;
  unitPriceUsdc: number;
  freightUsdc: number;
  leadTimeDays: number;
}

/** Dollars to USDC base units, as a number the ledger stores. */
const usdc = (dollars: number) => Number(parseUsd(dollars.toFixed(2)));

export function quoteTermsOf(
  rfq: Pick<RfqRequest, "rfqNo" | "material" | "qtyBase">,
  supplier: string,
  price: { unitPrice: number; freight: number; leadTimeDays: number },
): QuoteTerms {
  return {
    rfq: rfq.rfqNo,
    supplier,
    material: rfq.material,
    qtyBase: rfq.qtyBase,
    unitPriceUsdc: usdc(price.unitPrice),
    freightUsdc: usdc(price.freight),
    leadTimeDays: price.leadTimeDays,
  };
}

/** The anchor's id on chain: the contract lets a supplier anchor only ref_ids ending in its account. */
export function quoteRefId(rfqNo: string, account: string) {
  return `${rfqNo}/${account}`;
}

export function quoteFingerprint(terms: QuoteTerms, salt: string) {
  return fingerprint(terms, salt);
}

/** The record file `npm run verify` checks for a quote. */
export function quoteProof(terms: QuoteTerms, salt: string, anchoredTx: string | null) {
  return {
    kind: "quote",
    ref_id: quoteRefId(terms.rfq, terms.supplier),
    salt,
    record: terms,
    anchored_tx: anchoredTx,
  };
}

/**
 * The exact text a supplier seals in a sealed quote round and reveals after the deadline
 * (CONTRACTS.md §9). Its SHA-256 is the quote's fingerprint, so the contract can check a reveal
 * against its commitment by hashing the text alone.
 */
export function sealedQuoteText(terms: QuoteTerms, salt: string) {
  return canonicalJson({ record: terms, salt });
}

/** The terms and salt in a revealed quote, or null when the text is not a quote. */
export function parseSealedQuote(text: string): { terms: QuoteTerms; salt: string } | null {
  try {
    const parsed = JSON.parse(text) as { record?: QuoteTerms; salt?: unknown };
    const terms = parsed.record;
    if (!terms || typeof parsed.salt !== "string" || typeof terms.rfq !== "string") return null;
    return { terms, salt: parsed.salt };
  } catch {
    return null;
  }
}
