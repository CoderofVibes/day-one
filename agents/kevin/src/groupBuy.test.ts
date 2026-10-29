import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ChainClient } from "@day-one/server/chain/client";
import { ReplayTransport } from "@day-one/server/chain/replay";
import { openLedger } from "@day-one/server/ledger/db";
import { approvals, chainTx, productionPlan, staff } from "@day-one/server/ledger/schema";
import { seedLedger } from "@day-one/server/seed";
import { SUPPLIERS } from "@day-one/server/seed/quotes";
import { demoBus } from "@day-one/suppliers/bus";
import { acceptAndShip } from "@day-one/suppliers/shipping";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { forecastMaterial } from "./forecast.ts";
import {
  allocateShares,
  aloneCost,
  formatGroupTranscript,
  GROUP_CLOCK,
  GROUP_PLANNED_BATCH,
  GROUP_PO,
  GROUP_POOL,
  type GroupDeps,
  type GroupSalts,
  runGroupDemo,
  seedGroupBuy,
} from "./groupBuy.ts";

const ROOT = "acme-holdings.testnet";
const POLICY = `spend-policy.${ROOT}`;
const REPLAY = resolve(import.meta.dirname, "../../../data/replay");
const KG = 1_000_000;

describe("allocation", () => {
  it("splits the total by quantity and the shares add up exactly", () => {
    const plants = [
      { plant: "B", plantName: "Hollow Pine", agent: "kevin.plant-b", qtyBase: 700 * KG },
      { plant: "A", plantName: "Riverside", agent: "kevin.plant-a", qtyBase: 700 * KG },
    ];
    expect(allocateShares(9_490_000_000, plants).map((s) => s.amount)).toEqual([
      4_745_000_000, 4_745_000_000,
    ]);
    // An odd split: the remainder lands on the first (hub) line, never lost or doubled.
    const uneven = allocateShares(10_000_000_001, [
      { ...plants[0], qtyBase: 300 * KG } as (typeof plants)[number],
      { ...plants[1], qtyBase: 700 * KG } as (typeof plants)[number],
    ]);
    expect(uneven.reduce((sum, s) => sum + s.amount, 0)).toBe(10_000_000_001);
    expect(uneven[1]?.amount).toBe(Math.floor((10_000_000_001 * 7) / 10));
  });

  it("caps a pledge at what the plant would pay alone at the price on file", () => {
    expect(aloneCost("ASC", 700 * KG, "mass")).toBe(5_150_000_000);
    expect(() => aloneCost("XYZ", 1, "count")).toThrow(/no price on file/);
  });
});

describe("the group scenario on the seed", () => {
  it("adds the other plants' directors and Plant A's VC500 batch, which gives Plant A a need", () => {
    const db = openLedger();
    seedLedger(db);
    seedGroupBuy(db, ROOT);
    const dana = db.select().from(staff).where(eq(staff.name, "Dana Whitfield")).get();
    expect(dana?.nearAccountId).toBe(`director.plant-a.${ROOT}`);
    expect(
      db
        .select()
        .from(productionPlan)
        .where(eq(productionPlan.batchNo, GROUP_PLANNED_BATCH.batchNo))
        .get()?.plannedFor,
    ).toBe("2026-11-19");
    const a = forecastMaterial(db, { facility: "A", material: "ASC", now: GROUP_CLOCK.start });
    expect(a.needBase).toBeGreaterThan(0);
    expect(a.recommendQtyBase).toBe(700 * KG);
    const c = forecastMaterial(db, { facility: "C", material: "ASC", now: GROUP_CLOCK.start });
    expect(c.needBase).toBe(0);
  });
});

describe("the recorded group buy", () => {
  it("replays from the fixture with no keys and matches the committed transcript", async () => {
    const db = openLedger();
    seedLedger(db);
    seedGroupBuy(db, ROOT);
    const replay = ReplayTransport.fromFile(resolve(REPLAY, "group-chain.json"));
    const salts = JSON.parse(
      readFileSync(resolve(REPLAY, "group-salts.json"), "utf8"),
    ) as GroupSalts;
    let clock: string = GROUP_CLOCK.start;
    const chain = new ChainClient(db, replay, () => clock);
    const bus = demoBus(chain, {
      policyContract: POLICY,
      salt: (account) => salts.quotes[account] ?? "",
    });
    const deps: GroupDeps = {
      db,
      chain,
      setClock: (iso) => {
        clock = iso;
      },
      policyContract: POLICY,
      relayer: "dayone-relayer.testnet",
      tokenSymbol: "DTUSD",
      agents: {
        A: `kevin.plant-a.${ROOT}`,
        B: `kevin.plant-b.${ROOT}`,
        C: `kevin.plant-c.${ROOT}`,
      },
      hub: "B",
      quotes: (rfq) => bus.requestQuotes(rfq),
      ship: (shipment) => acceptAndShip(chain, shipment, { policyContract: POLICY }),
      salts,
    };
    const result = await runGroupDemo(deps);
    replay.assertDone();
    expect(result.ok).toBe(true);
    expect(formatGroupTranscript(db, result.steps, replay.network)).toBe(
      readFileSync(resolve(REPLAY, "group-transcript.txt"), "utf8"),
    );

    // Two plants pooled, one stayed out; the shares add up to the PO; each plant is charged its own.
    expect(result.pool.poolId).toBe(GROUP_POOL);
    expect(result.pool.shares.map((s) => s.plant)).toEqual(["B", "A"]);
    expect(result.pool.declined).toEqual(["C"]);
    expect(result.po?.poNo).toBe(GROUP_PO);
    expect(result.pool.shares.reduce((sum, s) => sum + s.amount, 0)).toBe(result.po?.totalUsdc);
    expect(result.pool.shares.map((s) => s.approvedBy)).toEqual(["Linda Park", "Dana Whitfield"]);
    expect(result.spent).toEqual({ A: 4_745_000_000, B: 4_745_000_000, C: 0 });
    expect(result.po?.savingsUsdc).toBe(810_000_000);
    expect(result.po?.status).toBe("paid");

    // One approval text per waiting plant, each answered by its own director.
    const texts = db.select().from(approvals).all();
    expect(texts.map((t) => [t.state, t.responseText])).toEqual([
      ["approved", "YES G2001"],
      ["approved", "YES G2001"],
    ]);
    expect(texts[0]?.requestText).toContain(
      "Plant B's $4,745.00 share of a $9,490.00 pooled order",
    );
    // The chain log: the refusal by design, QuickChem's refused anchor, nothing failed.
    const rows = db.select().from(chainTx).all();
    expect(rows.filter((r) => r.status === "failed")).toEqual([]);
    expect(rows.filter((r) => r.status === "refused").map((r) => r.method)).toEqual([
      "anchor",
      "submit_pooled_po",
    ]);
    expect(rows.filter((r) => r.method === "approve_po").map((r) => r.signerId)).toEqual([
      `director.plant-b.${ROOT}`,
      `director.plant-a.${ROOT}`,
    ]);
    expect(SUPPLIERS.map((s) => s.account).every((a) => salts.quotes[a])).toBe(true);
  });
});
