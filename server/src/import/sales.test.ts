import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INVENTORY_FILE } from "../seed/inventorySheet.ts";
import { analyzeSalesSheets } from "./sales.ts";
import { readXlsx } from "./xlsx.ts";

const sheets = readXlsx(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "data", "imports", INVENTORY_FILE)),
);

describe("the Sales by customer tab (FICTIONAL_DATA §14)", () => {
  const sales = analyzeSalesSheets(sheets);

  it("maps every customer SKU to VC500 and its pack count", () => {
    expect(sales.product).toBe("P-VC500");
    expect(sales.months).toEqual(["Aug", "Sep", "Oct"]);
    expect(sales.lines.map((l) => [l.sku.split(" ")[0], l.count])).toEqual([
      ["CM-448120", 60],
      ["CM-448121", 120],
      ["PB-7731-06", 100],
      ["BW-20-0915", 60],
      ["HP-E216", 216],
      ["HP-E256", 256],
      ["EU-VC500-90", 90],
    ]);
  });

  it("counts October's tablets and the ascorbic acid in them", () => {
    expect(sales.lines.map((l) => l.tablets[2])).toEqual([
      289_200, 258_000, 330_000, 116_400, 131_760, 116_480, 108_000,
    ]);
    expect(sales.tabletsByMonth[2]).toBe(1_349_840);
    const asc = sales.actives.find((a) => a.material === "ASC");
    expect(asc?.mgPerTablet).toBe(515);
    expect(sales.actives.map((a) => a.material)).toEqual(["ASC", "CTA"]);
    expect(Math.round((asc?.inTabletsMg[2] ?? 0) / 1_000)).toBe(695_168);
    expect(Math.round((asc?.issuedMg[2] ?? 0) / 1_000)).toBe(772_408);
  });

  it("asks about the retyped Summary figure and uses neither", () => {
    expect(sales.mismatches).toHaveLength(1);
    expect(sales.mismatches[0]?.message).toBe(
      "Cardinal Mart 60 ct for October is 4,820 on the customer tab and 4,280 on Summary. That is 540 bottles, 32,400 tablets, about 16.7 kg of ascorbic acid. Which one is right?",
    );
    expect(sales.message).toBe(
      "October: 1,349,840 tablets of P-VC500 sold across 7 customer SKUs, carrying 695.168 kg of ascorbic acid; at the 90% expected yield that is 772.408 kg issued. One figure on Summary disagrees with the customer tab; I use neither until you say which is right.",
    );
  });
});
