// The world's invariants (docs/UPGRADE_BRIEF.md §2.1.11), run on the frozen anchors in
// data/world/. scripts/lib/world-run.test.ts checks those anchors against a replay of the
// recorded run and the committed world file against a fresh generation.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QC_SAMPLE_MG } from "../seed/history.ts";
import { VENDORS } from "../seed/reference.ts";
import type { Anchors } from "./anchors.ts";
import { addDays, calendar, dates, month, productSpec } from "./calendar.ts";
import {
  LAKEVIEW_WORLD,
  RIVERSIDE_WORLD,
  RUSH,
  WORLD,
  WORLDS,
  type WorldConfig,
} from "./config.ts";
import { generateWorlds, type World } from "./index.ts";
import { anchorRecords } from "./splice.ts";

const load = (slug: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../data/world/${slug}.anchors.json`, import.meta.url), "utf8"),
  ) as Anchors;
const anchorsBy: Record<string, Anchors> = {
  B: load("hollow-pine"),
  A: load("riverside"),
  C: load("lakeview"),
};
const anchors = anchorsBy.B as Anchors;
const all = generateWorlds(WORLDS, anchorsBy);
const world = all.B as World;
const riverside = all.A as World;
const lakeview = all.C as World;
const otherConfigs: WorldConfig[] = WORLDS.map((c) => ({ ...c, seed: "another seed" }));
const otherAll = generateWorlds(otherConfigs, anchorsBy);
const hash = (w: World) => createHash("sha256").update(JSON.stringify(w)).digest("hex");
const day = (iso: string) => iso.slice(0, 10);
const usd = (n: number) => n * 1_000_000;

/** The invariants every seed must keep. */
function invariants(w: World, config: WorldConfig, anchors: Anchors) {
  // Mass balance per lot: the running sum of its movements never goes below zero.
  const balance = new Map<string, number>();
  for (const m of w.movements) {
    const next = (balance.get(m[1]) ?? 0) + m[3];
    expect(next, `${m[1]} at ${m[0]}`).toBeGreaterThanOrEqual(0);
    balance.set(m[1], next);
  }
  // Every receipt line is one received movement; every batch draw is one consumed movement.
  const received = new Map(w.movements.filter((m) => m[2] === "received").map((m) => [m[1], m[3]]));
  for (const r of w.receipts) for (const l of r.lines) expect(received.get(l.lot)).toBe(l.qtyBase);
  for (const b of w.batches.filter((x) => x.era !== "anchor")) {
    const drawn = w.movements
      .filter((m) => m[4] === `batch:${b.batchNo}`)
      .reduce((s, m) => s - m[3], 0);
    expect(drawn).toBe(b.consumption.reduce((s, c) => s + c.actualBase, 0));
    expect(b.wasteBase).toBeGreaterThanOrEqual(0);
  }
  // Per plant and month the sums close: month-end stock less the last month's is the month's movements.
  const s = w.snapshots;
  const months = [...new Set(s.days.map(month))];
  const lotMaterial = new Map(w.lots.map((l) => [l.lot, l.material]));
  for (let i = 1; i < months.length; i++) {
    const lastOf = (m: string) => s.days.findLastIndex((d) => month(d) === m);
    const a = lastOf(months[i - 1] ?? "");
    const b = lastOf(months[i] ?? "");
    s.materials.forEach((code, k) => {
      const moved = w.movements
        .filter((m) => month(m[0]) === months[i] && lotMaterial.get(m[1]) === code)
        .reduce((sum, m) => sum + m[3], 0);
      expect((s.onHand[b]?.[k] ?? 0) - (s.onHand[a]?.[k] ?? 0), `${code} in ${months[i]}`).toBe(
        moved,
      );
    });
  }

  // Money: payments are paid bills, PO totals are lines plus freight, escrow never goes below zero.
  const paidBills = new Set(w.payments.flatMap((p) => p.bills));
  expect(w.payments.reduce((t, p) => t + p.amountUsdc, 0)).toBe(
    w.bills.filter((b) => b.status === "paid").reduce((t, b) => t + b.amountUsdc, 0),
  );
  for (const b of w.bills) expect(paidBills.has(b.billNo)).toBe(b.status === "paid");
  for (const po of w.pos) {
    expect(po.totalUsdc).toBe(po.lines.reduce((t, l) => t + l.extendedUsdc, 0) + po.freightUsdc);
  }
  let escrow = 0;
  for (const e of [...w.escrow].sort((x, y) => (x.at < y.at ? -1 : 1))) {
    escrow += e.deltaUsdc;
    expect(escrow).toBeGreaterThanOrEqual(0);
  }
  for (const v of s.escrowUsdc) expect(v).toBeGreaterThanOrEqual(0);
  const lastDay = s.days.length - 1;
  expect(s.escrowUsdc[lastDay]).toBe(w.escrow.reduce((t, e) => t + e.deltaUsdc, 0));

  // Three-way match: every Kevin-era payment has its PO, a receipt and a matched bill.
  for (const p of w.payments.filter((x) => x.era === "simulated")) {
    expect(p.rail).toBe("escrow_release");
    expect(p.chain).toBe("Simulated · would anchor");
    for (const no of p.bills) {
      const bill = w.bills.find((b) => b.billNo === no);
      expect(bill?.match, no).toBe("matched");
      expect(w.pos.some((po) => po.poNo === bill?.poNo)).toBe(true);
      expect(w.receipts.some((r) => r.receiptNo === bill?.receiptNo && r.poNo === bill?.poNo)).toBe(
        true,
      );
    }
  }

  // Policy: Kevin's per-PO limit, his monthly limit, and never an unqualified supplier.
  const { perPoLimitUsd, monthlyLimitUsd } = config.plant.kevin;
  const kevinPos = w.pos.filter((p) => p.era === "simulated" || (p.era === "anchor" && p.approval));
  for (const po of w.pos.filter((p) => p.era === "simulated")) {
    if (po.totalUsdc > usd(perPoLimitUsd)) expect(po.approval?.path, po.poNo).toBe("director_text");
    if (po.approval?.path === "auto") expect(po.totalUsdc).toBeLessThanOrEqual(usd(perPoLimitUsd));
  }
  for (const m of new Set(kevinPos.map((p) => month(p.orderedAt)))) {
    const committed = kevinPos
      .filter((p) => month(p.orderedAt) === m)
      .reduce((t, p) => t + p.totalUsdc, 0);
    expect(committed, m).toBeLessThanOrEqual(usd(monthlyLimitUsd));
  }
  const barred = new Set(
    VENDORS.filter((v) => v.qualification === "unqualified" || v.qualification === "suspended").map(
      (v) => v.code,
    ),
  );
  for (const r of w.rfqs) expect(barred.has(r.winner), r.rfqNo).toBe(false);
  for (const po of w.pos.filter((p) => p.era === "simulated"))
    expect(barred.has(po.vendor)).toBe(false);

  // Simulated chain activity is labeled and never carries a hash.
  for (const e of w.simulatedChain) {
    expect(e.label).toBe("Simulated · would anchor");
    expect(Object.keys(e).sort()).toEqual(["at", "label", "method", "ref"]);
  }
  expect(JSON.stringify(w.simulatedChain)).not.toMatch(/txHash|explorer/);

  // The splice: no legacy record inside the anchor window, no simulated one inside the run.
  const { spliceIn, recordedEnd } = config.calendar;
  for (const m of w.movements) {
    const era = w.lots.find((l) => l.lot === m[1])?.era;
    if (m[4].startsWith("receipt:") || m[4].startsWith("batch:")) {
      if (day(m[0]) >= spliceIn && day(m[0]) <= recordedEnd) expect(era).toBe("anchor");
    }
  }
  for (const b of w.batches) {
    if (b.date >= spliceIn && b.date <= recordedEnd) expect(b.era).toBe("anchor");
  }
  // On-hand meets the anchors exactly: the plant's stock at the end of the recorded run is the ledger's.
  const end = s.days.indexOf(recordedEnd);
  const anchoredStock = new Map<string, number>();
  const anchorMaterial = new Map(anchors.lots.map((l) => [l.lot, l.material]));
  for (const bal of anchors.balances) {
    const code = anchorMaterial.get(bal.lot) ?? "";
    anchoredStock.set(code, (anchoredStock.get(code) ?? 0) + bal.onHandBase);
  }
  s.materials.forEach((code, k) => {
    expect(s.onHand[end]?.[k] ?? 0, code).toBe(anchoredStock.get(code) ?? 0);
  });
  // The cutover count leaves no legacy lot on the books on the splice day.
  const before = s.days.indexOf(addDays(spliceIn, -1));
  for (const lot of w.lots.filter((l) => l.era === "legacy")) {
    const left = w.movements
      .filter((m) => m[1] === lot.lot && day(m[0]) < spliceIn)
      .reduce((t, m) => t + m[3], 0);
    expect(left, lot.lot).toBe(0);
  }
  expect(before).toBeGreaterThan(0);

  // Finished goods: every lot is made once and never ships more than it holds; every shipment is
  // invoiced once; the genealogy reaches from a raw-material lot to the customers.
  const fg = new Map<string, number>();
  for (const m of w.fgMovements) {
    const next = (fg.get(m[1]) ?? 0) + m[2];
    expect(next, m[1]).toBeGreaterThanOrEqual(0);
    fg.set(m[1], next);
  }
  for (const b of w.batches) expect(w.indexes.batchToFgLot[b.batchNo]).toBe(`FG-${b.batchNo}`);
  // Transfers out are whole lot movements; nothing a plant stages runs it below zero (above).
  for (const t of w.transfers) {
    expect(w.movements).toContainEqual([
      t.at,
      t.lot,
      "transfer_out",
      -t.qtyBase,
      `transfer:${t.transferNo}`,
    ]);
  }
  expect(w.invoices.map((i) => i.shipmentNo)).toEqual(w.shipments.map((x) => x.shipmentNo));
  for (const sh of w.shipments) {
    for (const l of sh.lines) expect(w.indexes.fgLotToShipments[l.fgLot]).toContain(sh.shipmentNo);
  }
}

describe("the world generator", () => {
  it("is deterministic, and another seed still keeps every invariant", () => {
    const again = generateWorlds(WORLDS, anchorsBy);
    WORLDS.forEach((config, i) => {
      const f = config.plant.facility;
      expect(hash(again[f] as World)).toBe(hash(all[f] as World));
      expect(hash(otherAll[f] as World)).not.toBe(hash(all[f] as World));
      invariants(all[f] as World, config, anchorsBy[f] as Anchors);
      invariants(otherAll[f] as World, otherConfigs[i] as WorldConfig, anchorsBy[f] as Anchors);
    });
  });

  it("covers twelve months and six weeks around the anchors, inside the size budget", () => {
    expect(world.monthly.map((m) => m.month)[0]).toBe("2025-12");
    expect(world.snapshots.days.at(-1)).toBe("2026-12-28");
    for (const era of ["legacy", "anchor", "simulated"]) {
      expect(world.batches.some((b) => b.era === era)).toBe(true);
      expect(world.pos.some((p) => p.era === era)).toBe(true);
    }
    expect(JSON.stringify(world).length).toBeLessThan(8_000_000);
    expect(JSON.stringify(all).length).toBeLessThan(15_000_000);
  });

  it("generates Riverside and Lakeview with their own parameters around their own anchors", () => {
    // Riverside: a tablet plant, two thirds of Hollow Pine's batches, no legacy Cal-Mag.
    const perMonth = (w: World) => w.batches.length / w.monthly.length;
    expect(perMonth(riverside)).toBeGreaterThan(6);
    expect(perMonth(riverside)).toBeLessThan(perMonth(world));
    expect(riverside.meta.plant).toBe("Acme Riverside");
    expect(
      riverside.pos.filter((p) => p.era === "legacy").every((p) => p.poNo.startsWith("RV-PO-")),
    ).toBe(true);
    expect(
      riverside.pos.filter((p) => p.era === "simulated").every((p) => p.poNo.startsWith("PO-R-")),
    ).toBe(true);
    expect(riverside.batches.filter((b) => b.era === "legacy" && b.product === "P-CMD")).toEqual(
      [],
    );
    expect(riverside.shipments.length).toBeGreaterThan(300);
    for (const b of anchorRecords(anchorsBy.A as Anchors).batches)
      expect(riverside.batches.find((x) => x.batchNo === b.batchNo)).toEqual(b);
    // Riverside's simulated batches never take the numbers the group purchase and BR-A-2207 hold.
    expect(riverside.batches.some((b) => ["BR-A-2207", "BR-A-2210"].includes(b.batchNo))).toBe(
      false,
    );

    // The 115.199 kg gap: the anchored Cal-Mag batches issue more than their tablets and waste.
    const gap = ["BR-A-2201", "BR-A-2204"].reduce((t, no) => {
      const b = riverside.batches.find((x) => x.batchNo === no);
      const issued = b?.consumption.reduce((s, c) => s + c.actualBase, 0) ?? 0;
      const weight = productSpec("P-CMD").tabletWeightMg;
      return t + issued - (b?.actualUnits ?? 0) * weight - (b?.wasteBase ?? 0) - QC_SAMPLE_MG;
    }, 0);
    expect(gap).toBe(115_199_028);
    expect(riverside.incidents.find((i) => i.id === "INC-07")).toMatchObject({
      unaccountedBase: gap,
    });

    // Lakeview: no batches; it stages the packaging of the other plants' batches.
    expect(lakeview.batches).toEqual([]);
    expect(lakeview.meta.calendar.start).toBe("2025-12-01");
    expect(LAKEVIEW_WORLD.calendar.spliceIn).toBe("2026-09-05");
    expect(lakeview.pos.every((p) => p.category === "packaging")).toBe(true);
    expect(lakeview.pullShort).toEqual([]);
    const sentTo = new Set(lakeview.transfers.map((t) => t.to));
    expect([...sentTo].sort()).toEqual(["A", "B"]);
    // Every Hollow Pine Vitamin C batch outside Lakeview's anchor window has its bottles staged.
    for (const b of world.batches.filter(
      (x) => x.product === "P-VC500" && x.era === "legacy" && x.date > "2025-12-05",
    )) {
      const bottles = lakeview.transfers.filter(
        (t) => t.to === "B" && t.material === "BTL" && t.at.slice(0, 10) < b.date,
      );
      expect(bottles.length, b.batchNo).toBeGreaterThan(0);
    }
    // Generated lot codes never repeat across plants, except a lot sent from one to the other
    // (the seed's own transfers list their lots at both plants).
    const codes = [world, riverside, lakeview].flatMap((w) =>
      w.lots.filter((l) => !l.transferNo && l.era !== "anchor").map((l) => l.lot),
    );
    expect(new Set(codes).size).toBe(codes.length);
    const bills = [world, riverside, lakeview].flatMap((w) => w.bills.map((b) => b.billNo));
    expect(new Set(bills).size).toBe(bills.length);
    expect(RIVERSIDE_WORLD.plant.kevin.approver).toBe("Dana Whitfield");
  });

  it("keeps every anchor exactly as the seed and the recorded run left it", () => {
    const expected = anchorRecords(anchors);
    for (const po of expected.pos) expect(world.pos.find((p) => p.poNo === po.poNo)).toEqual(po);
    for (const lot of expected.lots) expect(world.lots.find((l) => l.lot === lot.lot)).toEqual(lot);
    for (const b of expected.batches)
      expect(world.batches.find((x) => x.batchNo === b.batchNo)).toEqual(b);
    for (const r of expected.receipts) {
      expect(world.receipts.find((x) => x.receiptNo === r.receiptNo)).toEqual(r);
    }
    const anchored = new Set(expected.movements.map((m) => JSON.stringify(m)));
    expect(world.movements.filter((m) => anchored.has(JSON.stringify(m)))).toHaveLength(
      expected.movements.length,
    );
    // The proof points behind the demo: PO-1042 and its recorded transactions, BR-B-1045, ASC-261116-01.
    const po1042 = world.pos.find((p) => p.poNo === "PO-1042");
    expect(po1042?.totalUsdc).toBe(usd(5_150));
    expect(po1042?.approval?.path).toBe("director_text");
    expect(world.batches.find((b) => b.batchNo === "BR-B-1045")?.era).toBe("anchor");
    expect(world.lots.find((l) => l.lot === "ASC-261116-01")?.qtyBase).toBe(700_000_000);
    expect(anchors.chain.filter((t) => t.txHash)).toHaveLength(13);
    // Escrow as the recorded run left it: PO-1041 ($612.00) and PO-1042 ($5,150.00) funded on
    // Nov 9, PO-1042 paid out on Nov 16, PO-1041 still held; nothing before T0.
    const escrowOn = (d: string) => world.snapshots.escrowUsdc[world.snapshots.days.indexOf(d)];
    expect(world.pos.find((p) => p.poNo === "PO-1041")?.status).toBe("funded");
    expect(escrowOn("2026-11-08")).toBe(0);
    expect(escrowOn("2026-11-09")).toBe(usd(5_762));
    expect(escrowOn("2026-11-16")).toBe(usd(612));
  });

  it("finds any day's state by index, fast enough to scrub a year", () => {
    const s = world.snapshots;
    const t = performance.now();
    for (let i = 0; i < 1_000; i++) {
      const d = s.days.indexOf(s.days[(i * 37) % s.days.length] ?? "");
      expect(s.onHand[d]?.length).toBe(s.materials.length);
    }
    expect(performance.now() - t).toBeLessThan(150);
    // A trace: a historical ascorbic acid lot to its batches, finished goods and customers.
    const lot = world.lots.find((l) => l.era === "legacy" && l.material === "ASC" && l.poNo);
    const batches = world.indexes.lotToBatches[lot?.lot ?? ""] ?? [];
    const shipments = batches.flatMap(
      (b) => world.indexes.fgLotToShipments[world.indexes.batchToFgLot[b] ?? ""] ?? [],
    );
    expect(batches.length).toBeGreaterThan(0);
    expect(shipments.length).toBeGreaterThan(0);
  });

  it("builds Vitamin C ahead of winter: January runs at least 25% over July", () => {
    const units = (m: string) =>
      world.batches
        .filter((b) => b.product === "P-VC500" && month(b.date) === m)
        .reduce((t, b) => t + b.actualUnits, 0);
    expect(units("2026-01")).toBeGreaterThanOrEqual(units("2026-07") * 1.25);
  });

  it("puts each named incident on its date with the records it touched", () => {
    const cal = calendar(WORLD);
    const inc = (id: string) => world.incidents.find((i) => i.id === id);

    // INC-01: Northgate's late truck, the batch short of ascorbic acid, two days' wait, rush freight.
    const stockout = inc("INC-01");
    expect(stockout?.date).toBe("2026-01-15");
    const short = world.shortages.find((x) => x.date === "2026-01-15");
    expect(short?.materials).toContain("ASC");
    const slipped = world.batches.find((b) => b.batchNo === short?.batchNo);
    expect(slipped?.plannedFor).toBe("2026-01-15");
    expect(slipped?.date).toBe(cal.after(cal.after("2026-01-15")));
    const rush = world.pos.filter((p) => p.rush && p.incidents.includes("INC-01"));
    expect(rush.map((p) => [p.vendor, p.freightUsdc, day(p.orderedAt)])).toEqual([
      ["RWA", usd(RUSH.freightUsd), "2026-01-15"],
    ]);
    expect(
      world.pos.some((p) => p.vendor === "NGI" && !p.rush && p.incidents.includes("INC-01")),
    ).toBe(true);
    expect(world.lookBack.rushFreight.map((r) => r.poNo)).toContain(rush[0]?.poNo);

    // INC-03: one Pacific Excipient invoice keyed twice and paid twice; the ERP's rule finds it.
    const dup = inc("INC-03");
    expect(dup?.affected.bills).toHaveLength(2);
    const pair = world.bills.filter((b) => dup?.affected.bills.includes(b.billNo));
    expect(new Set(pair.map((b) => `${b.poNo}|${b.amountUsdc}|${b.status}`)).size).toBe(1);
    expect((pair[0]?.billDate ?? "") >= "2026-04-13").toBe(true);
    expect(world.lookBack.duplicates.map((d) => d.billNo)).toEqual([pair[1]?.billNo]);
    expect(world.lookBack.recoverableUsdc).toBe(pair[1]?.amountUsdc);

    // INC-09: the packaging surcharge, only inside its months.
    for (const po of world.pos.filter((p) => p.era === "legacy" && p.category === "packaging")) {
      const inside = day(po.orderedAt) >= "2026-05-01" && day(po.orderedAt) <= "2026-07-31";
      expect(po.incidents.includes("INC-09"), po.poNo).toBe(inside);
    }
    expect(inc("INC-09")?.affected.pos.length).toBeGreaterThan(0);

    // INC-10: two quiet days each December, no batches, trucks or payments.
    for (const d of [...dates("2025-12-24", "2025-12-25"), ...dates("2026-12-24", "2026-12-25")]) {
      expect(world.batches.some((b) => b.date === d)).toBe(false);
      expect(world.receipts.some((r) => day(r.receivedAt) === d)).toBe(false);
      expect(world.payments.some((p) => day(p.paidAt) === d)).toBe(false);
    }

    // The look-back's price drift is the legacy steps of config.ts PRICES.legacySteps.
    expect(world.lookBack.priceDrift.map((d) => d.material).sort()).toEqual(["SIO", "SUC"]);
  });

  it("puts the M3 incidents on their dates and entities", () => {
    const inc = (w: World, id: string) => {
      const found = w.incidents.find((i) => i.id === id);
      if (!found) throw new Error(`no ${id}`);
      return found;
    };
    const poOf = (no: string) => world.pos.find((p) => p.poNo === no);

    // INC-02: Sierra's March calcium carbonate, nine days past its promised day.
    const late = inc(world, "INC-02");
    expect(late.affected.suppliers).toEqual(["SMS"]);
    const latePo = poOf(late.affected.pos[0] ?? "");
    expect(latePo?.vendor).toBe("SMS");
    expect(latePo?.lines.some((l) => l.material === "CAC")).toBe(true);
    const lateReceipt = world.receipts.find((r) => r.poNo === latePo?.poNo);
    expect(lateReceipt?.daysLate).toBeGreaterThanOrEqual(9);
    expect(lateReceipt?.receivedAt.slice(0, 7)).toBe("2026-03");

    // INC-04: Fennimore's sorbitol fails moisture in June, goes back, a replacement follows.
    const fpo = inc(world, "INC-04");
    const rejected = world.lots.find((l) => l.lot === fpo.affected.lots[0]);
    expect(rejected).toMatchObject({ vendor: "FPO", material: "SOR", qc: { result: "rejected" } });
    expect((rejected?.receivedAt ?? "") >= "2026-06-01").toBe(true);
    const replaced = world.lots.filter(
      (l) => l.poNo === rejected?.poNo && l.lot !== rejected?.lot && l.material === "SOR",
    );
    expect(replaced.some((l) => l.qc?.result === "released")).toBe(true);

    // INC-05: QuickChem's two trial lots, both rejected, nothing billed or paid; never qualified,
    // so Kevin's RFQs exclude it (RFQ-2611-01 in the anchors says the same).
    const qcd = inc(world, "INC-05");
    const trial = world.lots.filter((l) => l.vendor === "QCD");
    expect(trial.map((l) => l.qc?.result)).toEqual(["rejected", "rejected"]);
    expect(qcd.affected.lots).toEqual(trial.map((l) => l.lot));
    for (const no of qcd.affected.pos) expect(poOf(no)?.status).toBe("cancelled");
    expect(world.bills.some((b) => b.vendor === "QCD")).toBe(false);
    const rfq2611 = anchors.rfqs.find((r) => r.rfqNo === "RFQ-2611-01");
    expect(rfq2611?.quotes.find((q) => q.vendor === "QCD")?.reason).toBe("vendor not qualified");
    for (const r of world.rfqs)
      expect(r.quotes.find((q) => q.vendor === "QCD")?.status ?? "excluded").toBe("excluded");

    // INC-06: $6.40 before, $7.10 on PO-1042 and every order after.
    const hike = inc(world, "INC-06");
    const ascPrices = world.pos
      .filter((p) => p.vendor !== "QCD")
      .flatMap((p) =>
        p.lines
          .filter((l) => l.material === "ASC")
          .map((l) => [day(p.orderedAt), l.unitPriceUsdc] as const),
      );
    for (const [d, price] of ascPrices) expect(price, d).toBe(d < hike.date ? usd(6.4) : usd(7.1));
    expect(poOf("PO-1042")?.lines[0]?.unitPriceUsdc).toBe(usd(7.1));

    // INC-08: one Ridgeway lot, Vitamin C batches at both plants, received months before T0.
    const recall = inc(world, "INC-08");
    const lot = recall.affected.lots[0] ?? "";
    expect(lot).not.toBe("ASC-261116-01");
    expect(world.lots.find((l) => l.lot === lot)).toMatchObject({ vendor: "RWA", material: "ASC" });
    expect(inc(riverside, "INC-08").affected.lots).toEqual([lot]);
    const usedIn = [world, riverside].flatMap((w) =>
      w.batches.filter((b) => b.consumption.some((c) => c.lot === lot)),
    );
    expect(new Set(usedIn.map((b) => b.batchNo.slice(0, 4)))).toEqual(new Set(["BR-B", "BR-A"]));
    expect(usedIn.every((b) => b.product === "P-VC500")).toBe(true);
    // It is the bought-in ascorbic acid lot in the most batches, at any plant.
    const count = new Map<string, number>();
    for (const w of [world, riverside])
      for (const b of w.batches)
        for (const c of new Set(
          b.consumption.filter((x) => x.material === "ASC").map((x) => x.lot),
        ))
          count.set(c, (count.get(c) ?? 0) + 1);
    const most = [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    expect(most?.[0]).toBe(lot);
  });
});
