// The savings ledger and the money book over the committed world and recordings: no evidence
// counted twice, the group buy's saving from quotes (never the PO total), refused attacks kept out
// of savings, the recorded escrow equal to the contract's, and the proof-point amounts unchanged.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { moneyData } from "./load.ts";
import {
  apAging,
  cashFlow,
  doubleCounted,
  endOf,
  escrowAt,
  kevinCostAt,
  type MoneyBook,
  paidForHimself,
  poSizeHistogram,
  savingsAt,
} from "./money.ts";

const root = resolve(import.meta.dirname, "../../..");
const data = moneyData(root);
const book = data.books.B as MoneyBook;
const byId = (id: string) => data.entries.find((e) => e.id === id);
const $ = (n: number) => Math.round(n * 1_000_000);

describe("the savings ledger", () => {
  it("never backs two entries with the same record", () => {
    expect(data.entries.length).toBeGreaterThan(5);
    expect(doubleCounted(data.entries)).toEqual([]);
  });

  it("derives the group buy from the recorded standalone quote, never the PO total", () => {
    const g = byId("group:PO-G-2001:B");
    // RFQ-2611-01: 700 kg × $7.10 + $180 = $5,150; Hollow Pine's share of PO-G-2001 is $4,745.
    expect(g).toMatchObject({ amountUsdc: $(405), status: "realized" });
    expect(g?.evidence).toContain("RFQ-2611-01");
    expect(g?.amountUsdc).not.toBe($(9_490));
    // Riverside has no standalone quote on record: left out, and said so.
    expect(byId("group:PO-G-2001:A")).toBeUndefined();
    expect(data.notCounted.some((n) => n.type === "group_buy" && n.plant === "A")).toBe(true);
  });

  it("prices the sealed round on landed quotes, conservatively, and leaves it identified", () => {
    // Ridgeway $7.35 × 700 + $165 = $5,310 against Northgate's $5,150.
    expect(byId("sealed:RFQ-2611-02")).toMatchObject({ amountUsdc: $(160), status: "identified" });
  });

  it("realizes the duplicate held at cutover and keeps the legacy one recoverable", () => {
    expect(byId("duplicate:OFH-3317-R")).toMatchObject({
      amountUsdc: $(1_150),
      status: "realized",
    });
    const legacy = data.entries.find((e) => e.type === "duplicate_invoice" && e.era === "legacy");
    expect(legacy?.status).toBe("identified");
    expect(legacy?.formula).toContain("recoverable");
  });

  it("prices drift and over-consumption from the records, all positive", () => {
    expect(byId("drift:PO-1040:MGS")?.amountUsdc).toBe($(57.5));
    for (const e of data.entries) expect(e.amountUsdc).toBeGreaterThan(0);
  });

  it("counts no rush freight while the continuation has its own rush order", () => {
    expect(data.entries.some((e) => e.type === "rush_freight")).toBe(false);
    expect(data.notCounted.find((n) => n.type === "rush_freight")?.reason).toContain("PO-1089");
  });

  it("keeps refused attacks out of savings, as payments protected", () => {
    const evidence = new Set(data.entries.flatMap((e) => e.evidence));
    for (const id of ["NG-INV-24190", "NG-INV-24190-R", "PO-T9001", "PO-T9201"]) {
      expect(evidence.has(id)).toBe(false);
    }
    expect(data.protected.totalUsdc).toBeGreaterThan(0);
    const keys = data.protected.items.map((i) => i.attack);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the money book", () => {
  it("holds the recorded escrow the contract showed: $612 before PO-1042, $5,762 at the end of Nov 9", () => {
    expect(escrowAt(book, "2026-11-09T13:20:00.000Z").heldUsdc).toBe($(612));
    expect(escrowAt(book, "2026-11-09").heldUsdc).toBe($(5_762));
    expect(escrowAt(book, "2026-11-16").heldUsdc).toBe($(612));
    for (const e of book.escrow.filter((x) => x.at <= endOf("2026-11-16"))) {
      expect(e.source).toBe("recorded");
    }
  });

  it("reconciles cash out to vendor payments plus modeled overhead", () => {
    const overhead = data.config.overhead.B;
    if (!overhead) throw new Error("no overhead for B");
    const flow = cashFlow(
      book,
      { from: book.calendar.start, to: endOf(book.calendar.end) },
      overhead,
    );
    const paid = book.payments.reduce((s, p) => s + p.amountUsdc, 0);
    expect(flow.reduce((s, m) => s + m.vendorPaymentsUsdc, 0)).toBe(paid);
    expect(flow.reduce((s, m) => s + m.cashOutUsdc, 0)).toBe(
      paid + flow.reduce((s, m) => s + m.overheadUsdc, 0),
    );
  });

  it("pays every bill but the held duplicate, and shows late bills only before Kevin", () => {
    const end = apAging(book, book.calendar.end);
    expect(end.held.map((b) => b.billNo)).toEqual(["OFH-3317-R"]);
    const late = book.bills.filter((b) => b.paidAt && b.paidAt.slice(0, 10) > b.dueDate);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every((b) => b.era === "legacy")).toBe(true);
  });

  it("shows PO-1042 over the per-PO limit on the histogram", () => {
    const h = poSizeHistogram(book, { from: "2026-11-01", to: endOf("2026-11-30") }, 500, 2_500);
    expect(h.overLimitKevin).toContain("PO-1042");
  });

  it("starts paying for Kevin on T0", () => {
    const before = kevinCostAt(
      "2026-11-08",
      data.config.t0,
      1,
      data.answers,
      data.config.kevinCost,
    );
    expect(before.totalUsdc).toBe(0);
    const s = savingsAt(data.entries, "2026-11-16", ["B"], data.config.t0);
    const cost = kevinCostAt("2026-11-16", data.config.t0, 1, data.answers, data.config.kevinCost);
    expect(cost.metered).toBe(data.answers.length);
    const p = paidForHimself(s, cost, data.config.t0, false);
    expect(p.valueUsdc).toBe($(1_150));
    expect(p.ratio).toBeGreaterThan(1);
  });
});

describe("the proof-point amounts", () => {
  const read = (file: string) => readFileSync(resolve(root, file), "utf8");

  it("leaves PO-G-2001, PO-1042 and PO-1047 as recorded", () => {
    const group = JSON.parse(read("web/src/data/group-buy.json"));
    expect(group.po).toMatchObject({ poNo: "PO-G-2001", totalUsdc: $(9_490) });
    expect(group.pool.shares.map((s: { amount: number }) => s.amount)).toEqual([
      $(4_745),
      $(4_745),
    ]);
    expect(book.pos.find((p) => p.poNo === "PO-1042")?.totalUsdc).toBe($(5_150));
    expect(read("data/usdc/transcript.txt")).toContain("19.00 USDC");
  });
});
