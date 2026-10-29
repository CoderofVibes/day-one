// The supplier agents in the demo (FICTIONAL_DATA §5): each has its own NEAR testnet account
// (CONTRACTS.md §1) and the price list it answers Kevin's RFQs from. Quotes are not seeded:
// Kevin's RFQ step collects them over the bus when it runs, and each agent anchors its quote's
// fingerprint from its own account. DEMO_QUOTES is the same ascorbic acid answer set as plain
// data, for tests and for replaying the Oct 28 recording, which was made before the agents
// anchored their quotes.

export interface PriceLine {
  /** Dollars per inventory unit (kg or each). */
  unitPrice: number;
  leadTimeDays: number;
  /** Dollars per order. */
  freight: number;
}

export interface SupplierSpec {
  /** The vendor code on Kevin's supplier list. */
  vendor: string;
  name: string;
  /** The account the agent signs from, and the escrow pays. */
  account: string;
  /** What it sells, by material code. */
  prices: Readonly<Record<string, PriceLine>>;
}

export const SUPPLIERS: readonly SupplierSpec[] = [
  {
    vendor: "QCD",
    name: "QuickChem Direct",
    account: "quickchem-direct.testnet",
    prices: { ASC: { unitPrice: 5.9, leadTimeDays: 4, freight: 0 } },
  },
  {
    vendor: "NGI",
    name: "Northgate Ingredients",
    account: "northgate-ingredients.testnet",
    prices: { ASC: { unitPrice: 7.1, leadTimeDays: 7, freight: 180 } },
  },
  {
    vendor: "RWA",
    name: "Ridgeway Ascorbics",
    account: "ridgeway-ascorbics.testnet",
    prices: { ASC: { unitPrice: 7.35, leadTimeDays: 5, freight: 165 } },
  },
  {
    vendor: "BLS",
    name: "Bayfront Lab Supply",
    account: "bayfront-labsupply.testnet",
    prices: {
      ACN: { unitPrice: 128, leadTimeDays: 2, freight: 0 },
      BUF: { unitPrice: 25, leadTimeDays: 2, freight: 0 },
    },
  },
];

export interface QuoteSpec extends PriceLine {
  /** The vendor code the answer claims; an unknown code is a sender not on the vendor list. */
  vendor: string;
  /** The sender's name and NEAR account as the answer gives them, when it gives them. */
  name?: string;
  account?: string;
}

/** The ascorbic acid answers as data, without the agents' fingerprints and anchors. */
export const DEMO_QUOTES: Readonly<Record<string, readonly QuoteSpec[]>> = {
  ASC: SUPPLIERS.flatMap((s) =>
    s.prices.ASC ? [{ vendor: s.vendor, name: s.name, account: s.account, ...s.prices.ASC }] : [],
  ),
};
