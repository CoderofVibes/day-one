// The Money page's data (docs/UPGRADE_BRIEF.md §2.4), read from the committed recordings and the
// twelve-month worlds: each plant's book, the savings ledger, payments protected, the recorded
// answers' token counts and the assumptions. No keys, no network; `npm run web:data` writes it
// for the static replay and GET /api/money serves it live.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUTOVER_AT } from "../erp-connector/rebuild.ts";
import { priceDrift, type SettledPo } from "../ledger/books.ts";
import { MATERIALS, VENDORS } from "../seed/reference.ts";
import type { World } from "../world/index.ts";
import { moneyBook } from "./book.ts";
import {
  BUDGETS,
  DEAD_STOCK_DAYS,
  KEVIN_COST,
  KEVIN_POLICY,
  OPENING_CASH_USD,
  OVERHEAD,
  T0,
  TRANSFER_FREIGHT_USD,
} from "./config.ts";
import type { MoneyBook, RecordedAnswer, SavingEntry } from "./money.ts";
import {
  buildSavings,
  type ChainEntry,
  type NotCounted,
  protectedPayments,
  type Quote,
} from "./savings.ts";

export const PLANT_NAMES: Record<string, string> = {
  A: "Acme Riverside",
  B: "Hollow Pine Tablet Co.",
  C: "Acme Lakeview",
};

/** The page's assumptions, as the page shows them. */
export const MONEY_CONFIG = {
  t0: T0,
  overhead: OVERHEAD,
  openingCashUsd: OPENING_CASH_USD,
  budgets: BUDGETS,
  kevinCost: KEVIN_COST,
  kevinPolicy: KEVIN_POLICY,
  transferFreightUsd: TRANSFER_FREIGHT_USD,
  deadStockDays: DEAD_STOCK_DAYS,
};

/** Everything but the books: small, for the header's counter on every page. */
export interface SavingsData {
  config: typeof MONEY_CONFIG;
  /** The plants Kevin runs at (an account each on testnet): his fee is per plant. */
  kevinPlants: string[];
  entries: SavingEntry[];
  notCounted: NotCounted[];
  protected: ReturnType<typeof protectedPayments>;
  answers: RecordedAnswer[];
  incidents: {
    plant: string;
    id: string;
    title: string;
    date: string;
    endsAt: string;
    narrative: string;
  }[];
  /** Plants with a twelve-month world, and what the others lack. */
  plants: Record<string, { name: string; history: boolean; note: string | null }>;
}

export interface MoneyData extends SavingsData {
  books: Record<string, MoneyBook>;
}

const json = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

/** The worlds in data/world/ (one file per plant; the frozen anchors are not worlds). */
export function readWorlds(root: string): World[] {
  const dir = join(root, "data/world");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".anchors.json"))
    .sort()
    .map((f) => json<World>(join(dir, f)));
}

const vendorName = new Map(VENDORS.map((v) => [v.code, v.name]));
const materialOf = new Map(MATERIALS.map((m) => [m.code, m]));

/** The legacy months' drift with its trailing prices: books.ts priceDrift over the paid legacy POs. */
function legacyDrift(world: World) {
  const legacy = world.pos.filter((p) => p.era === "legacy" && p.status === "paid");
  const settled: SettledPo[] = legacy.map((p, i) => ({
    id: i + 1,
    poNo: p.poNo,
    vendor: vendorName.get(p.vendor) ?? p.vendor,
    vendorAccount: null,
    receivedOn: null,
    releasedOn: null,
    freightUsdc: p.freightUsdc,
    totalUsdc: p.totalUsdc,
    paymentRef: null,
    recordRef: null,
    lines: p.lines.map((l, n) => ({
      lineNo: n + 1,
      material: l.material,
      name: materialOf.get(l.material)?.name ?? l.material,
      dimension: materialOf.get(l.material)?.uom === "kg" ? "mass" : "count",
      qtyBase: l.qtyBase,
      unitPriceUsdc: l.unitPriceUsdc,
      extendedUsdc: l.extendedUsdc,
    })),
  }));
  return priceDrift(settled).map((d) => {
    const po = legacy.find((p) => p.poNo === d.poNo);
    const line = po?.lines.find((l) => l.material === d.material);
    return {
      plant: world.meta.facility,
      poNo: d.poNo,
      material: d.material,
      unitPriceUsdc: d.unitPriceUsdc,
      trailingUsdc: d.trailingUsdc,
      qtyBase: line?.qtyBase ?? 0,
      dimension: materialOf.get(d.material)?.uom === "kg" ? "mass" : "count",
      trailingPoNos: d.trailingPoNos,
      orderedAt: po?.orderedAt ?? "",
    };
  });
}

interface GroupBuyJson {
  pool: {
    poolId: string;
    material: string;
    shares: { plant: string; plantName: string; qtyBase: number; amount: number }[];
  };
  po: { poNo: string; totalUsdc: number; unitPriceUsdc: number };
  steps: { title: string }[];
}
interface PlantsJson {
  at: string;
  books: {
    alerts: {
      poNo: string;
      material: string;
      unitPriceUsdc: number;
      trailingUsdc: number;
      trailingPoNos: string[];
    }[];
  };
  transfers: {
    suggestions: {
      material: string;
      materialName: string;
      from: string;
      to: string;
      qtyBase: number;
      lots: { lotCode: string }[];
      valueUsdc: number | null;
    }[];
  };
}
interface SealedJson {
  round: {
    round_id: string;
    agent: string;
    awarded: string;
    awarded_at: string;
    bids: { supplier: string; quote: string }[];
  };
}
interface LlmJson {
  entries: { result: { usage?: { inputTokens: number; outputTokens: number } } }[];
}

/** The release of the pooled delivery (agents/kevin/src/groupBuy.ts GROUP_CLOCK.release). */
const GROUP_RELEASE = "2026-11-17T15:00:00.000Z";
/** Supplier accounts on testnet to the seed's vendor codes. */
const ACCOUNT_VENDOR: Record<string, string> = {
  "northgate-ingredients.testnet": "NGI",
  "ridgeway-ascorbics.testnet": "RWA",
};

export function moneyData(root: string): MoneyData {
  const worlds = readWorlds(root);
  const books: Record<string, MoneyBook> = {};
  for (const w of worlds) books[w.meta.facility] = moneyBook(w);
  const plantsJson = json<PlantsJson>(join(root, "web/src/data/plants.json"));
  const group = json<GroupBuyJson>(join(root, "web/src/data/group-buy.json"));
  const anchors = json<{
    rfqs: {
      rfqNo: string;
      material: string;
      qtyBase: number;
      quotes: (Quote & { status: string })[];
    }[];
  }>(join(root, "data/world/hollow-pine.anchors.json"));
  const sealed = json<SealedJson>(join(root, "data/sealed/RFQ-2611-02.round.json"));

  // Each plant's recorded standalone RFQ for the pooled material: Hollow Pine's RFQ-2611-01.
  const standalone: Record<
    string,
    { rfqNo: string; qtyBase: number; quotes: Quote[]; winner: string }
  > = {};
  const rfq = anchors.rfqs.find((r) => r.material === group.pool.material);
  const accepted = rfq?.quotes.find((q) => q.status === "accepted");
  if (rfq && accepted)
    standalone.B = {
      rfqNo: rfq.rfqNo,
      qtyBase: rfq.qtyBase,
      quotes: rfq.quotes,
      winner: accepted.vendor,
    };

  const sealedQuotes = sealed.round.bids.map((b) => {
    const r = (
      JSON.parse(b.quote) as {
        record: { unitPriceUsdc: number; freightUsdc: number; qtyBase: number };
      }
    ).record;
    return {
      vendor: ACCOUNT_VENDOR[b.supplier] ?? b.supplier,
      unitPriceUsdc: r.unitPriceUsdc,
      freightUsdc: r.freightUsdc,
      qtyBase: r.qtyBase,
    };
  });
  const awardedAt = new Date(Number(BigInt(sealed.round.awarded_at) / 1_000_000n)).toISOString();

  const bookB = books.B;
  const heldDuplicates = (bookB?.bills ?? [])
    .filter((b) => b.held)
    .map((b) => {
      const original = bookB?.bills.find(
        (o) => o !== b && !o.held && o.poNo === b.poNo && o.amountUsdc === b.amountUsdc,
      );
      return {
        plant: "B",
        billNo: b.billNo,
        duplicateOf: original?.billNo ?? "",
        amountUsdc: b.amountUsdc,
        heldAt: CUTOVER_AT,
      };
    });
  const worldB = worlds.find((w) => w.meta.facility === "B");
  const pack = bookB?.bills ?? [];
  const driftAlerts = plantsJson.books.alerts.map((a) => {
    const line = worldB?.pos
      .find((p) => p.poNo === a.poNo)
      ?.lines.find((l) => l.material === a.material);
    return {
      plant: "B",
      poNo: a.poNo,
      invoiceNo: pack.find((b) => b.poNo === a.poNo)?.billNo ?? a.poNo,
      material: a.material,
      unitPriceUsdc: a.unitPriceUsdc,
      trailingUsdc: a.trailingUsdc,
      qtyBase: line?.qtyBase ?? 0,
      dimension: materialOf.get(a.material)?.uom === "kg" ? "mass" : "count",
      trailingPoNos: a.trailingPoNos,
      at: CUTOVER_AT,
    };
  });

  const ledger = buildSavings({
    t0: T0,
    worlds: worlds.flatMap((w) => {
      const book = books[w.meta.facility];
      return book ? [{ world: w, book }] : [];
    }),
    group: {
      poNo: group.po.poNo,
      poolId: group.pool.poolId,
      material: group.pool.material,
      unitPriceUsdc: group.po.unitPriceUsdc,
      totalUsdc: group.po.totalUsdc,
      realizedAt: GROUP_RELEASE,
      shares: group.pool.shares.map((s) => ({
        plant: s.plant,
        plantName: s.plantName,
        qtyBase: s.qtyBase,
        amountUsdc: s.amount,
      })),
      standalone,
    },
    transfers: {
      at: plantsJson.at,
      suggestions: plantsJson.transfers.suggestions,
      freightUsd: TRANSFER_FREIGHT_USD,
    },
    sealed: {
      roundId: sealed.round.round_id,
      plant: "B",
      awardedAt,
      qtyBase: sealedQuotes[0]?.qtyBase ?? 0,
      quotes: sealedQuotes,
      winner: ACCOUNT_VENDOR[sealed.round.awarded] ?? sealed.round.awarded,
      poPlaced: false,
    },
    heldDuplicates,
    driftAlerts,
    legacyDrift: worlds.flatMap(legacyDrift),
  });

  const chainFiles = ["data/replay/attacks-chain.json", "data/attacks/credentials-testnet.json"];
  const invoices = json<{ invoices: { genuine: string; inflated: string; hidden: string } }>(
    join(root, "data/attacks/invoices.json"),
  ).invoices;
  const protectedFigure = protectedPayments(
    chainFiles.map((file) => ({
      file,
      entries: json<{ entries: ChainEntry[] }>(join(root, file)).entries,
    })),
    invoices,
  );

  const replay = join(root, "data/replay");
  const answers: RecordedAnswer[] = readdirSync(replay)
    .filter((f) => f.endsWith("-llm.json"))
    .sort()
    .flatMap((f) =>
      json<LlmJson>(join(replay, f)).entries.map((e) => ({
        file: `data/replay/${f}`,
        inputTokens: e.result.usage?.inputTokens ?? null,
        outputTokens: e.result.usage?.outputTokens ?? null,
      })),
    );

  const plants: SavingsData["plants"] = {};
  for (const code of ["B", "A", "C"]) {
    const has = Boolean(books[code]);
    plants[code] = {
      name: PLANT_NAMES[code] ?? code,
      history: has,
      note: has
        ? null
        : `${PLANT_NAMES[code]} has no twelve-month history yet (data/world/ holds ${worlds.map((w) => w.meta.plant).join(", ")}): cash, inventory, AP and spend wait for it; its savings and the group buy show here.`,
    };
  }
  const accounts = existsSync(join(root, "config/testnet-accounts.json"))
    ? Object.keys(
        json<{ accounts?: Record<string, unknown> }>(join(root, "config/testnet-accounts.json"))
          .accounts ?? {},
      )
    : [];
  const kevinPlants = ["A", "B", "C"].filter((p) =>
    accounts.some((a) => a.startsWith(`kevin.plant-${p.toLowerCase()}.`)),
  );

  return {
    config: MONEY_CONFIG,
    kevinPlants: kevinPlants.length ? kevinPlants : ["B"],
    entries: ledger.entries,
    notCounted: ledger.notCounted,
    protected: protectedFigure,
    answers,
    incidents: worlds.flatMap((w) =>
      w.incidents.map((i) => ({
        plant: w.meta.facility,
        id: i.id,
        title: i.title,
        date: i.date,
        endsAt: i.endsAt,
        narrative: i.narrative,
      })),
    ),
    plants,
    books,
  };
}

/** The data without the books, for the header's counter. */
export function savingsData(data: MoneyData): SavingsData {
  const { books: _, ...rest } = data;
  return rest;
}
