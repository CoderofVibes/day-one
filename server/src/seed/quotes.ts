// The quotes the supplier agents answer Kevin's ascorbic acid RFQ with at the demo
// (FICTIONAL_DATA §5). They are not seeded: Kevin's RFQ step writes them when it runs. Tier 1
// supplier agents will compute and sign the same figures from their own accounts.

export interface QuoteSpec {
  /** The vendor code the answer claims; an unknown code is a sender not on the vendor list. */
  vendor: string;
  /** The sender's name and NEAR account as the answer gives them, when it gives them. */
  name?: string;
  account?: string;
  /** Dollars per inventory unit (kg). */
  unitPrice: number;
  leadTimeDays: number;
  /** Dollars per order. */
  freight: number;
}

export const DEMO_QUOTES: Readonly<Record<string, readonly QuoteSpec[]>> = {
  ASC: [
    { vendor: "QCD", unitPrice: 5.9, leadTimeDays: 4, freight: 0 },
    { vendor: "NGI", unitPrice: 7.1, leadTimeDays: 7, freight: 180 },
    { vendor: "RWA", unitPrice: 7.35, leadTimeDays: 5, freight: 165 },
  ],
};
