import { describe, expect, it } from "vitest";
import { amplitude, wavePath } from "./KevinPresence.tsx";
import {
  captionAt,
  FADE,
  FIRST_SHIFT_KEY,
  GUIDE_STOPS,
  INTRO_LINES,
  opensByItself,
  timeLeft,
} from "./shiftScript.ts";

const store = (items: Record<string, string>) => ({ getItem: (k: string) => items[k] ?? null });

describe("when Kevin's introduction opens by itself", () => {
  it("opens on a bare first visit, and on blocked storage", () => {
    expect(opensByItself("", "", store({}))).toBe(true);
    expect(opensByItself("", "", null)).toBe(true);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(opensByItself("", "", throwing)).toBe(true);
  });

  it("never opens over a screen someone asked for", () => {
    for (const q of [
      "?judge=1",
      "?video=1",
      "?page=approve&po=1042",
      "?page=inventory",
      "?plant=A",
      "?inspect=PO-1042",
    ])
      expect(opensByItself(q, "", store({})), q).toBe(false);
    expect(opensByItself("", "#top", store({}))).toBe(false);
  });

  it("does not open again for a returning visitor", () => {
    expect(opensByItself("", "", store({ [FIRST_SHIFT_KEY]: "{}" }))).toBe(false);
    expect(opensByItself("", "", store({ "day-one-guide-closed": "1" }))).toBe(false);
    expect(opensByItself("", "", store({ "day-one-clock": "2026-11-09T13:13Z" }))).toBe(false);
  });
});

describe("the introduction", () => {
  it("is three captions in about fifteen seconds, the desk fading in behind them", () => {
    expect(INTRO_LINES).toHaveLength(3);
    expect(FADE).toHaveLength(INTRO_LINES.length);
    expect(captionAt(0)).toBe(-1);
    expect(captionAt(6_000)).toBe(1);
    expect(captionAt(15_000)).toBe(2);
    expect(INTRO_LINES[0]?.text).toContain("Welcome to Acme's Day One program at Hollow Pine");
  });

  it("draws Kevin's line level at its ends and still when it rests", () => {
    const d = wavePath(800, 7);
    expect(d.startsWith("M8.0 24.00")).toBe(true);
    expect(d.endsWith("L232.0 24.00")).toBe(true);
    expect(amplitude(-1, 2_400)).toBe(0);
    expect(amplitude(1_000, 2_400)).toBe(7);
    expect(amplitude(2_500, 2_400)).toBe(0);
  });
});

describe("the walkthrough", () => {
  it("is Ray's morning in six stops, then three behind the curtain, in about two minutes", () => {
    expect(GUIDE_STOPS.filter((s) => s.part === "morning")).toHaveLength(6);
    expect(GUIDE_STOPS.filter((s) => s.part === "trust")).toHaveLength(3);
    expect(GUIDE_STOPS.findIndex((s) => s.part === "trust")).toBe(6);
    const total = GUIDE_STOPS.reduce((s, x) => s + x.seconds, 0) + 15;
    expect(total).toBeGreaterThanOrEqual(110);
    expect(total).toBeLessThanOrEqual(150);
    expect(timeLeft(GUIDE_STOPS.length - 1)).toMatch(/about \d+ s left/);
  });

  it("keeps the chain off Ray's screen and shows its proof behind the curtain", () => {
    for (const s of GUIDE_STOPS.filter((x) => x.part === "morning")) {
      expect(s.curtain, s.id).toBe(false);
      expect(s.links, s.id).toEqual([]);
      expect(s.line, s.id).not.toMatch(/\b(NEAR|chain|wallet|token|gas|hash|contract)\b/i);
    }
    for (const s of GUIDE_STOPS.filter((x) => x.part === "trust")) {
      expect(s.curtain, s.id).toBe(true);
      expect(s.links.length, s.id).toBeGreaterThan(0);
      for (const l of s.links) expect(l.url).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\//);
    }
  });

  it("says only what the recorded morning holds", () => {
    const line = (id: string) => GUIDE_STOPS.find((s) => s.id === id)?.line ?? "";
    expect(line("overnight")).toContain("ten messages");
    expect(line("overnight")).toContain("Three draft changes");
    expect(line("drafts")).toContain("never moves money");
    expect(line("limits")).toContain("$2,500");
    expect(line("limits")).toContain("$60,000");
    expect(line("books")).not.toMatch(/batch records? (go|pass)/i);
    expect(line("attacks")).toContain("20 attacks");
  });
});
