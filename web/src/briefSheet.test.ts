import { describe, expect, it } from "vitest";
import { briefSheet } from "./briefSheet.ts";
import pages from "./data/pages.json";
import type { Brief } from "./reads.ts";

const brief = pages.brief.B as Brief;

describe("the brief as a morning sheet", () => {
  const sheet = briefSheet(brief);

  it("splits the greeting from the summary", () => {
    expect(sheet.greeting).toBe("Good morning, Ray.");
    expect(sheet.lede).toBe("1 thing waits on a person, and 3 materials need ordering.");
  });

  it("puts what needs a person first and what moved last", () => {
    expect(sheet.sections.map((s) => s.key)).toEqual(["waiting", "buying", "watch", "moved"]);
    expect(sheet.sections.map((s) => s.title)).toEqual([
      "Needs a person",
      "To buy or move",
      "Worth a look",
      "Since Friday",
    ]);
  });

  it("folds each move from another plant under the material it would stand in for", () => {
    const buying = sheet.sections.find((s) => s.key === "buying");
    expect(buying?.items.map((i) => [i.line.ref, i.instead?.ref ?? null])).toEqual([
      ["PO-1041", null],
      ["ASC", null],
      ["BTL", "BTL:C-B"],
      ["CAP", "CAP:C-B"],
    ]);
    expect(sheet.tally).toEqual([
      { label: "needs a person", count: 1 },
      { label: "to buy, move or receive", count: 4 },
      { label: "worth a look", count: 1 },
      { label: "stock movements since then", count: 1 },
    ]);
  });

  it("keeps a move whose material has no line of its own", () => {
    const lone = briefSheet({
      ...brief,
      sections: [
        {
          key: "buying",
          title: "Buying",
          empty: "",
          lines: [{ ref: "CAC:B-A", text: "Before you buy: …" }],
        },
      ],
    });
    expect(lone.sections[0]?.items).toHaveLength(1);
  });
});
