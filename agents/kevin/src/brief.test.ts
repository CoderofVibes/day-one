import { type Ledger, openLedger } from "@day-one/server/ledger/db";
import { seedLedger } from "@day-one/server/seed";
import { beforeEach, describe, expect, it } from "vitest";
import { briefHtml, formatBrief, morningBrief, previousWorkingDay } from "./brief.ts";
import { saveBatchDraft } from "./extraction.ts";
import { BR_1045_EXTRACTION } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:00:00.000Z";

let db: Ledger;

beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

const texts = (brief: ReturnType<typeof morningBrief>, key: string) =>
  brief.sections.find((s) => s.key === key)?.lines.map((l) => l.text) ?? [];

describe("Kevin's morning brief", () => {
  it("tells Ray what moved, what waits on QC and what to buy at the demo's start", () => {
    const brief = morningBrief(db, { now: NOW });
    expect(brief.facility).toBe("B");
    expect(brief.since).toBe("2026-11-06T13:00:00.000Z");
    expect(brief.headline).toBe(
      "Good morning, Ray. 1 thing waits on a person, and 4 materials need ordering.",
    );
    expect(texts(brief, "moved")).toEqual([
      "Nov 6: MGS-261106-01, magnesium stearate, received, put in quarantine (+50 kg).",
    ]);
    expect(texts(brief, "waiting")).toEqual([
      "MGS-261106-01, magnesium stearate, has been in quarantine for 3 days; it waits on QC " +
        "(Priya Natarajan) before production can use it.",
    ]);
    const buying = texts(brief, "buying");
    expect(buying[0]).toBe(
      "Ascorbic acid: Two more VC500 batches in the next 10 days need about 824 kg. " +
        "Short about 102 kg. Recommend ordering 700 kg. Needed by Nov 19.",
    );
    // A sister plant's spare bottles come right after the bottle reorder they would replace.
    const bottles = buying.findIndex((t) => t.startsWith("150 cc HDPE bottle:"));
    expect(buying[bottles + 1]).toMatch(/^Before you buy: Acme Lakeview has 96,000/);
    expect(texts(brief, "watch")).toEqual([expect.stringContaining("PO-1040, up 14.0%")]);
  });

  it("keeps each plant to its own materials, price alerts and mass balance", () => {
    const riverside = morningBrief(db, { now: NOW, facility: "A" });
    expect(riverside.for).toBeNull();
    expect(texts(riverside, "watch")).toEqual([expect.stringMatching(/^P-CMD at Riverside/)]);
    const lakeview = morningBrief(db, { now: NOW, facility: "C" });
    expect(lakeview.headline).toBe("Good morning. Nothing waits on a person.");
    expect(formatBrief(lakeview)).toContain("- Stock and open orders cover the plan.");
  });

  it("lists a batch record that is read but not yet confirmed", () => {
    saveBatchDraft(db, structuredClone(BR_1045_EXTRACTION), {
      file: "data/batch-records/BR-B-1045.jpg",
      sha256: "0".repeat(64),
      model: "nearai:z-ai/glm-5.3-flash",
    });
    const waiting = texts(morningBrief(db, { now: "2026-11-09T13:06:00.000Z" }), "waiting");
    expect(
      waiting.some((t) => t.startsWith("Batch record BR-B-1045 is read but not confirmed")),
    ).toBe(true);
  });

  it("looks back to Friday on a Monday and to the day before otherwise", () => {
    expect(previousWorkingDay("2026-11-09T13:00:00.000Z")).toBe("2026-11-06T13:00:00.000Z");
    expect(previousWorkingDay("2026-11-11T13:00:00.000Z")).toBe("2026-11-10T13:00:00.000Z");
  });

  it("prints as one self-contained page and refuses an unknown plant", () => {
    const html = briefHtml(morningBrief(db, { now: NOW }));
    expect(html).toContain("<h1>Good morning, Ray.");
    expect(html).not.toMatch(/<script|<link|https?:/);
    expect(() => morningBrief(db, { now: NOW, facility: "Z" })).toThrow("unknown plant Z");
  });
});
