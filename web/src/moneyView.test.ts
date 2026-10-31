import { describe, expect, it } from "vitest";
import { recordPage, SAVINGS, tally } from "./moneyView.ts";

const $ = (n: number) => Math.round(n * 1_000_000);

describe("the header's counter", () => {
  it("counts nothing before Day One and the held duplicate after it", () => {
    expect(tally("B", "2026-11-08T20:00:00.000Z").paid.valueUsdc).toBe(0);
    const end = tally("B", "2026-11-16T23:00:00.000Z");
    expect(end.paid.valueUsdc).toBe($(1_150));
    expect(end.paid.ratio).toBeGreaterThan(1);
  });

  it("adds the group buy's share when its delivery is released", () => {
    expect(tally("B", "2026-11-17T16:00:00.000Z").paid.valueUsdc).toBe($(1_555));
  });

  it("shows identified savings only when asked", () => {
    const at = "2026-11-16T23:00:00.000Z";
    expect(tally("B", at, true).paid.valueUsdc).toBeGreaterThan(tally("B", at).paid.valueUsdc);
  });

  it("charges Kevin's fee for every plant he runs at under All", () => {
    const at = "2026-11-16T23:00:00.000Z";
    expect(tally("all", at).cost.plants).toBe(SAVINGS.kevinPlants.length);
    expect(tally("C", at).cost.inferenceUsdc).toBe(0);
  });
});

describe("evidence links", () => {
  it("open the page that lists each record", () => {
    expect(recordPage("PO-G-2001 · Hollow Pine Tablet Co. share")).toBe("group");
    expect(recordPage("RFQ-2611-02")).toBe("sealed");
    expect(recordPage("RFQ-2611-01")).toBe("purchasing");
    expect(recordPage("BR-B-0976")).toBe("lots");
    expect(recordPage("BTL-260905-01")).toBe("lots");
    expect(recordPage("OFH-3317-R")).toBe("invoices");
  });
});
