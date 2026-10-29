import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { lots } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { suggestTransfers } from "./transferSuggestions.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const KG = 1_000_000;

let db: Ledger;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

const bottles = () => suggestTransfers(db, { now: NOW, material: "BTL" });

describe("transfer suggestions", () => {
  it("proposes Lakeview's spare bottles to Hollow Pine before a reorder", () => {
    const [s, ...rest] = bottles();
    expect(rest).toEqual([]);
    // Hollow Pine holds 24,000 against a reorder point of 40,000; Lakeview holds 136,000.
    expect(s).toMatchObject({
      from: "C",
      to: "B",
      qtyBase: 16_000,
      shortBase: 16_000,
      surplusBase: 96_000,
      avoidedOrderBase: 100_000,
      lots: [{ lotCode: "BTL-260905-01", qtyBase: 16_000 }],
      // PO-1037 paid $2,100.00 for 100,000 bottles.
      valueUsdc: 336 * 1_000_000,
    });
    expect(s?.sentence).toBe(
      "Before you buy: Acme Lakeview has 96,000 of 150 cc HDPE bottle (BTL) above its own need and reorder point. " +
        "Moving 16,000 (BTL-260905-01) to Hollow Pine Tablet Co. keeps it at its reorder point instead of ordering 100,000. " +
        "That is about $336.00 of stock at the last price paid.",
    );
  });

  it("proposes nothing for ascorbic acid: Riverside's 12.55 kg is below its own reorder point", () => {
    expect(suggestTransfers(db, { now: NOW, material: "ASC" })).toEqual([]);
  });

  it("never moves more than the surplus above the sender's need and reorder point", () => {
    // Riverside lacks about 550 kg of calcium carbonate; Hollow Pine holds 875 kg against 800.
    const [s] = suggestTransfers(db, { now: NOW, material: "CAC" });
    expect(s).toMatchObject({ from: "B", to: "A", qtyBase: 75 * KG, avoidedOrderBase: null });
    expect(s?.sentence).toContain("covers 75 kg of the 550 kg it lacks");
  });

  it("skips a lot that expires inside the horizon", () => {
    db.update(lots).set({ expiresOn: "2026-11-15" }).where(eq(lots.lotCode, "BTL-260905-01")).run();
    const [s] = bottles();
    expect(s?.lots).toEqual([{ lotCode: "BTL-261007-01", qtyBase: 16_000, expiresOn: null }]);
  });

  it("takes the earliest-expiring lot first", () => {
    db.update(lots).set({ expiresOn: "2027-06-30" }).where(eq(lots.lotCode, "BTL-260905-01")).run();
    db.update(lots).set({ expiresOn: "2027-03-31" }).where(eq(lots.lotCode, "BTL-261007-01")).run();
    expect(bottles()[0]?.lots.map((l) => l.lotCode)).toEqual(["BTL-261007-01"]);
  });

  it("never moves quarantined stock", () => {
    db.update(lots).set({ state: "quarantine" }).where(eq(lots.lotCode, "BTL-261007-01")).run();
    db.update(lots).set({ state: "quarantine" }).where(eq(lots.lotCode, "BTL-260905-01")).run();
    expect(bottles()).toEqual([]);
  });

  it("writes no forecast rows", () => {
    const count = () =>
      db.$client.prepare("select count(*) as n from forecasts").get() as { n: number };
    const before = count().n;
    suggestTransfers(db, { now: NOW });
    expect(count().n).toBe(before);
  });
});
