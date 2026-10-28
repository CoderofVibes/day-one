import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Erp, openErp } from "../db.ts";
import { usd } from "../money.ts";
import { inventoryBalances, inventoryMovements, items, locations, users } from "../schema.ts";
import { seedErp } from "../seed/index.ts";
import {
  lotBalance,
  postInventoryAdjustment,
  postInventoryStatusChange,
  postInventoryTransfer,
} from "./inventory.ts";
import { PostingError, trialBalance } from "./journal.ts";

const KG = 1_000_000;
let db: Erp;
let asc: number;
let plantA: number;
let plantB: number;
let kevin: number;
let n = 0;
const at = () => `2026-11-0${((n += 1)) % 9 || 1}T10:00:00.000Z`;

beforeEach(() => {
  db = openErp();
  seedErp(db);
  asc = db.select().from(items).where(eq(items.itemId, "ASC")).get()?.id ?? 0;
  plantA = db.select().from(locations).where(eq(locations.externalId, "A")).get()?.id ?? 0;
  plantB = db.select().from(locations).where(eq(locations.externalId, "B")).get()?.id ?? 0;
  kevin = db.select().from(users).where(eq(users.username, "kevin.dayone")).get()?.id ?? 0;
});

function sumMovements(itemId: number, locationId: number, status: string) {
  return db
    .select({
      qty: sql<number>`coalesce(sum(${inventoryMovements.quantityDeltaBase}), 0)`,
      value: sql<number>`coalesce(sum(${inventoryMovements.valueDeltaUsdc}), 0)`,
    })
    .from(inventoryMovements)
    .where(
      sql`${inventoryMovements.itemId} = ${itemId} and ${inventoryMovements.locationId} = ${locationId} and ${inventoryMovements.inventoryStatus} = ${status}`,
    )
    .get();
}

describe("inventory postings", () => {
  it("derives balances from movements and values stock in at standard cost", () => {
    const opening = postInventoryAdjustment(db, {
      externalId: "opening:ASC-260921-02",
      locationId: plantB,
      tranDate: "2026-09-21",
      reason: "opening",
      memo: "Cutover from Day One",
      lines: [{ itemId: asc, lotNumber: "ASC-260921-02", adjustQtyBase: 700 * KG }],
      userId: kevin,
      at: at(),
    });
    expect(opening.created).toBe(true);
    expect(opening.tranId).toBe("ADJ-1");
    const bal = db.select().from(inventoryBalances).where(eq(inventoryBalances.itemId, asc)).get();
    expect(bal?.quantityOnHandBase).toBe(700 * KG);
    expect(bal?.valueUsdc).toBe(usd(7.1 * 700));
    expect(sumMovements(asc, plantB, "good")).toEqual({ qty: 700 * KG, value: usd(4970) });
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.acctNumber === "1400")?.balanceUsdc).toBe(usd(4970));
    expect(tb.rows.find((r) => r.acctNumber === "3900")?.balanceUsdc).toBe(-usd(4970));
  });

  it("is idempotent on the external id", () => {
    const line = { itemId: asc, lotNumber: "L1", adjustQtyBase: 10 * KG };
    const input = {
      externalId: "x",
      locationId: plantB,
      tranDate: "2026-11-01",
      reason: "opening" as const,
      lines: [line],
      userId: kevin,
      at: at(),
    };
    const first = postInventoryAdjustment(db, input);
    const again = postInventoryAdjustment(db, input);
    expect(again).toMatchObject({ id: first.id, created: false });
    expect(db.select().from(inventoryMovements).all()).toHaveLength(1);
  });

  it("issues to production at the lot's own value, to the micro-dollar", () => {
    postInventoryAdjustment(db, {
      externalId: "opening:L1",
      locationId: plantB,
      tranDate: "2026-11-01",
      reason: "opening",
      lines: [{ itemId: asc, lotNumber: "L1", adjustQtyBase: 300 * KG, unitCostUsdc: usd(7.33) }],
      userId: kevin,
      at: at(),
    });
    // 300 kg at $7.33 = $2,199.00; issuing 187.450 kg carries 187.45/300 of it.
    const issue = postInventoryAdjustment(db, {
      externalId: "batch:BR-B-1045:L1",
      locationId: plantB,
      tranDate: "2026-11-09",
      reason: "production",
      memo: "BR-B-1045",
      lines: [{ itemId: asc, lotNumber: "L1", adjustQtyBase: -187_450_000 }],
      userId: kevin,
      at: at(),
    });
    expect(issue.created).toBe(true);
    const left = lotBalance(db, {
      itemId: asc,
      locationId: plantB,
      inventoryStatus: "good",
      lotNumber: "L1",
    });
    expect(left.quantityBase).toBe(112_550_000);
    const expectedOut = Math.round((2_199_000_000 * 187_450_000) / 300_000_000);
    expect(left.valueUsdc).toBe(2_199_000_000 - expectedOut);
    const tb = trialBalance(db);
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.acctNumber === "1500")?.balanceUsdc).toBe(expectedOut);
    // Issuing the rest takes the lot to exactly zero value: no rounding residue.
    postInventoryAdjustment(db, {
      externalId: "batch:BR-B-1047:L1",
      locationId: plantB,
      tranDate: "2026-11-17",
      reason: "production",
      lines: [{ itemId: asc, lotNumber: "L1", adjustQtyBase: -112_550_000 }],
      userId: kevin,
      at: at(),
    });
    expect(
      lotBalance(db, { itemId: asc, locationId: plantB, inventoryStatus: "good", lotNumber: "L1" }),
    ).toEqual({
      quantityBase: 0,
      valueUsdc: 0,
    });
  });

  it("refuses to take a lot below zero", () => {
    expect(() =>
      postInventoryAdjustment(db, {
        externalId: "bad",
        locationId: plantB,
        tranDate: "2026-11-01",
        reason: "waste",
        lines: [{ itemId: asc, lotNumber: "L9", adjustQtyBase: -1 }],
        userId: kevin,
        at: at(),
      }),
    ).toThrow(PostingError);
  });

  it("moves quantity and value between locations without touching the ledger", () => {
    postInventoryAdjustment(db, {
      externalId: "opening:A",
      locationId: plantA,
      tranDate: "2026-10-09",
      reason: "opening",
      lines: [{ itemId: asc, lotNumber: "ASC-261009-01", adjustQtyBase: 225 * KG }],
      userId: kevin,
      at: at(),
    });
    const before = trialBalance(db);
    const transfer = postInventoryTransfer(db, {
      externalId: "TR-A-B-261102",
      fromLocationId: plantA,
      toLocationId: plantB,
      tranDate: "2026-11-02",
      lines: [{ itemId: asc, lotNumber: "ASC-261009-01", quantityBase: 200 * KG }],
      userId: kevin,
      at: at(),
    });
    expect(transfer.tranId).toBe("TRF-1");
    expect(sumMovements(asc, plantA, "good")).toEqual({ qty: 25 * KG, value: usd(7.1 * 25) });
    expect(sumMovements(asc, plantB, "good")).toEqual({ qty: 200 * KG, value: usd(7.1 * 200) });
    expect(trialBalance(db)).toEqual(before);
  });

  it("changes status on QC with the value following the stock", () => {
    postInventoryAdjustment(db, {
      externalId: "q",
      locationId: plantB,
      tranDate: "2026-11-16",
      reason: "opening",
      lines: [
        {
          itemId: asc,
          lotNumber: "ASC-261116-01",
          inventoryStatus: "quarantine",
          adjustQtyBase: 700 * KG,
        },
      ],
      userId: kevin,
      at: at(),
    });
    const change = postInventoryStatusChange(db, {
      externalId: "qc:ASC-261116-01",
      locationId: plantB,
      tranDate: "2026-11-16",
      lines: [
        {
          itemId: asc,
          lotNumber: "ASC-261116-01",
          previousStatus: "quarantine",
          revisedStatus: "good",
        },
      ],
      userId: kevin,
      at: at(),
    });
    expect(change.tranId).toBe("ISC-1");
    expect(sumMovements(asc, plantB, "quarantine")).toEqual({ qty: 0, value: 0 });
    expect(sumMovements(asc, plantB, "good")).toEqual({ qty: 700 * KG, value: usd(4970) });
    expect(
      db
        .select()
        .from(inventoryBalances)
        .all()
        .filter((b) => b.quantityOnHandBase !== 0),
    ).toHaveLength(1);
  });
});
