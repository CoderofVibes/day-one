import { canonicalJson, sha256Hex } from "@day-one/server/canonical";
import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { facilities, poLines, purchaseOrders, quotes } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { DEMO_QUOTES } from "@day-one/server/seed/quotes";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Forecast, forecastMaterial } from "./forecast.ts";
import {
  draftPo,
  draftPoFromRanking,
  extendedUsdc,
  rankQuotes,
  requestQuotes,
} from "./purchasing.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const SALT = "5a17".repeat(8);
const USD = 1_000_000;

let db: Ledger;
let forecast: Forecast;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
  confirmBr1045(db);
  forecast = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
});

const quotesFor = () => requestQuotes(db, forecast, "RFQ-2611-01", DEMO_QUOTES.ASC ?? []);

describe("quotes and ranking", () => {
  it("prints DEMO_SCRIPT step 5 and records each quote's outcome", () => {
    const ranking = rankQuotes(db, quotesFor(), NOW);
    expect(ranking.sentence).toBe(
      "3 quotes. QuickChem Direct $5.90/kg excluded: vendor not qualified. Northgate $7.10/kg, 7 days — selected. Ridgeway $7.35/kg, 5 days — runner-up.",
    );
    const rows = db.select().from(quotes).all();
    expect(rows.map((q) => [q.status, q.exclusionReason])).toEqual([
      ["excluded", "vendor not qualified"],
      ["accepted", null],
      ["declined", null],
    ]);
    expect(rows.every((q) => /^[0-9a-f]{64}$/.test(q.quoteHash ?? ""))).toBe(true);
  });

  it("asks only vendors listed for the material", () => {
    const rfq = requestQuotes(db, forecast, "RFQ-2611-02", [
      ...(DEMO_QUOTES.ASC ?? []),
      { vendor: "BLS", unitPrice: 1, leadTimeDays: 1, freight: 0 },
    ]);
    expect(rankQuotes(db, rfq, NOW).ranked.map((q) => q.vendorCode)).toEqual(["QCD", "NGI", "RWA"]);
  });

  it("excludes a quote that cannot arrive by the need date", () => {
    // Three days later Northgate's 7 days miss Nov 17; Ridgeway's 5 still make it.
    const ranking = rankQuotes(db, quotesFor(), "2026-11-12T09:00:00.000Z");
    expect(ranking.selected?.vendorCode).toBe("RWA");
    expect(ranking.ranked.find((q) => q.vendorCode === "NGI")?.reason).toBe(
      "7-day lead time misses the 2026-11-17 need date",
    );
  });

  it("refuses to open an RFQ when the forecast recommends nothing", () => {
    const none = forecastMaterial(db, { facility: "B", material: "VD3", now: NOW });
    expect(() => requestQuotes(db, none, "RFQ-X", [])).toThrow(/recommends no order/);
  });
});

describe("PO draft", () => {
  it("drafts PO-1042 at $5,150.00 with freight and a reproducible po_hash", () => {
    const po = draftPoFromRanking(db, rankQuotes(db, quotesFor(), NOW), "PO-1042", SALT);
    expect(po.totalUsdc).toBe(5_150 * USD);
    expect(po.category).toBe("raw_material");
    expect(po.vendor.account).toBe("northgate-ingredients.testnet");
    expect(po.terms).toEqual({
      po: "PO-1042",
      vendor: "northgate-ingredients.testnet",
      lines: [
        {
          material: "ASC",
          qtyBase: 700_000_000,
          unit: "kg",
          unitPriceUsdc: 7_100_000,
          extendedUsdc: 4_970 * USD,
        },
      ],
      freightUsdc: 180 * USD,
      totalUsdc: 5_150 * USD,
      needBy: "2026-11-17",
      salt: SALT,
    });
    expect(po.poHash).toBe(sha256Hex(canonicalJson(po.terms)));
    expect(po.why).toBe(
      "Northgate Ingredients is the lowest-cost qualified supplier at $5,150.00 delivered in 7 days, before the 2026-11-17 batch. QuickChem Direct was cheaper but is not qualified.",
    );
    const row = db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)).get();
    expect(row).toMatchObject({ status: "draft", freightUsdc: 180 * USD, poHash: po.poHash });
    expect(db.select().from(poLines).where(eq(poLines.poId, po.id)).get()?.quoteId).not.toBeNull();
  });

  it("changes the hash when any term or the salt changes", () => {
    const plantB = db.select().from(facilities).where(eq(facilities.code, "B")).get()?.id ?? 0;
    const base = {
      vendor: "BLS",
      facilityId: plantB,
      lines: [{ material: "BUF", qtyBase: 2, unitPriceUsdc: 9_500_000 }],
      needBy: "2026-11-16",
      salt: SALT,
    };
    const a = draftPo(db, { ...base, poNo: "PO-1047" });
    const b = draftPo(db, { ...base, poNo: "PO-1048", salt: "00".repeat(16) });
    const c = draftPo(db, {
      ...base,
      poNo: "PO-1049",
      lines: [{ material: "BUF", qtyBase: 3, unitPriceUsdc: 9_500_000 }],
    });
    expect(new Set([a.poHash, b.poHash, c.poHash]).size).toBe(3);
    expect(a.totalUsdc).toBe(19 * USD);
  });

  it("drafts PO-1041 for lab chemicals at $612.00", () => {
    const plantB = db.select().from(facilities).where(eq(facilities.code, "B")).get()?.id ?? 0;
    const po = draftPo(db, {
      poNo: "PO-1041",
      vendor: "BLS",
      facilityId: plantB,
      lines: [
        { material: "ACN", qtyBase: 4, unitPriceUsdc: 128 * USD },
        { material: "BUF", qtyBase: 4, unitPriceUsdc: 25 * USD },
      ],
      needBy: null,
      salt: SALT,
    });
    expect(po).toMatchObject({ totalUsdc: 612 * USD, category: "lab_chemical" });
  });

  it("keeps one spend category per PO, as the contract checks one category per PO", () => {
    const plantB = db.select().from(facilities).where(eq(facilities.code, "B")).get()?.id ?? 0;
    expect(() =>
      draftPo(db, {
        poNo: "PO-1050",
        vendor: "BLS",
        facilityId: plantB,
        lines: [
          { material: "BUF", qtyBase: 1, unitPriceUsdc: USD },
          { material: "ASC", qtyBase: 1_000_000, unitPriceUsdc: USD },
        ],
        needBy: null,
        salt: SALT,
      }),
    ).toThrow(/one spend category/);
  });

  it("rounds a line half up in base units", () => {
    // 0.5 kg at $0.000001/kg is half a base unit: rounds up to 1.
    expect(extendedUsdc(500_000, 1, 1_000_000)).toBe(1);
    expect(extendedUsdc(499_999, 1, 1_000_000)).toBe(0);
    expect(extendedUsdc(700_000_000, 7_100_000, 1_000_000)).toBe(4_970 * USD);
  });
});
