// The Money page's reads (docs/UPGRADE_BRIEF.md §2.4). The formulas are server/src/finance/
// money.ts, imported here as they are, so the page and the header compute every figure the way
// the tests check it. The ledger and Kevin's cost inputs (web/src/data/savings.json) ship with
// the app for the header's counter; the plants' books load with the page, live from
// GET /api/money or from the snapshot npm run web:data writes (web/src/data/money.json).

import { kevinTally, type MoneyBook, type SavingEntry } from "@day-one/server/finance/money";
import savingsJson from "./data/savings.json";
import { DAY_MS, MINUTE_MS, PLANT_UTC_OFFSET_MIN } from "./engine.ts";
import type { Source } from "./series.ts";

export type MoneyPlant = "all" | "A" | "B" | "C";

export interface SavingsData {
  config: {
    t0: string;
    overhead: Record<string, { laborUsd: number; utilitiesUsd: number; rentUsd: number }>;
    openingCashUsd: Record<string, number>;
    budgets: Record<string, Record<string, number>>;
    kevinCost: {
      feeUsdPerMonth: number;
      inputUsdPerMTok: number;
      outputUsdPerMTok: number;
      usdPerAnswer: number;
    };
    kevinPolicy: { perPoLimitUsd: number; monthlyLimitUsd: number };
    transferFreightUsd: number;
    deadStockDays: number;
  };
  kevinPlants: string[];
  entries: SavingEntry[];
  notCounted: {
    type: SavingEntry["type"];
    plant: string;
    title: string;
    reason: string;
    evidence: string[];
  }[];
  protected: {
    totalUsdc: number;
    items: { attack: string; amountUsdc: number; what: string; source: string }[];
  };
  answers: { file: string; inputTokens: number | null; outputTokens: number | null }[];
  incidents: {
    plant: string;
    id: string;
    title: string;
    date: string;
    endsAt: string;
    narrative: string;
  }[];
  plants: Record<string, { name: string; history: boolean; note: string | null }>;
}

export const SAVINGS = savingsJson as unknown as SavingsData;
/** The recorded answers are Hollow Pine's run's. */
const ANSWERS_PLANT = "B";

export type Books = Record<string, MoneyBook>;

let staticBooks: Promise<Books> | undefined;
export function readBooks(source: Source): Promise<Books> {
  if (source.live) {
    return fetch("api/money").then((res) => {
      if (!res.ok) throw new Error(`api/money: ${res.status}`);
      return res.json().then((d: { books: Books }) => d.books);
    });
  }
  staticBooks ??= import("./data/money.json").then((m) => m.default as unknown as Books);
  return staticBooks;
}

/** The clock's time as the formulas take it: the instant, to the minute. */
export function atOf(simNow: number): string {
  return new Date(Math.floor(simNow / MINUTE_MS) * MINUTE_MS).toISOString();
}
/** The plant's calendar day at the clock's time. */
export function plantDay(simNow: number): string {
  return new Date(simNow + PLANT_UTC_OFFSET_MIN * MINUTE_MS).toISOString().slice(0, 10);
}
export const dayMs = DAY_MS;

/** The counter's numbers for a plant (or all) at `at`. */
export function tally(plant: MoneyPlant, at: string, includeIdentified = false) {
  return kevinTally(
    {
      t0: SAVINGS.config.t0,
      entries: SAVINGS.entries,
      answers: SAVINGS.answers,
      kevinCost: SAVINGS.config.kevinCost,
      kevinPlants: SAVINGS.kevinPlants,
      answersPlant: ANSWERS_PLANT,
    },
    at,
    plant,
    includeIdentified,
  );
}

/** "$1,150" for the header; cents only under $100. */
export function usdShort(usdc: number) {
  const d = usdc / 1_000_000;
  return `$${d.toLocaleString("en-US", { maximumFractionDigits: Math.abs(d) < 100 ? 2 : 0 })}`;
}

export const TYPE_LABEL: Record<SavingEntry["type"], string> = {
  group_buy: "Group buy",
  transfer: "Inter-plant transfer",
  sealed_bid: "Sealed bid",
  over_consumption: "Over-consumption caught",
  duplicate_invoice: "Duplicate invoice caught",
  price_drift: "Price drift caught",
  rush_freight: "Rush freight avoided",
};

/** Where a record id opens: the page that lists it. */
export function recordPage(id: string): string {
  if (id.startsWith("PO-G-") || id.startsWith("RFQ-G-")) return "group";
  if (id.startsWith("RFQ-2611-02")) return "sealed";
  if (id.startsWith("RFQ-") || id.startsWith("PO-") || id.startsWith("HP-PO-")) return "purchasing";
  if (id.startsWith("BR-") || id.startsWith("BP-") || id.startsWith("BC-")) return "lots";
  if (/^[A-Z0-9]{3}-\d{6}-\d\d$/.test(id)) return "lots";
  return "invoices";
}
