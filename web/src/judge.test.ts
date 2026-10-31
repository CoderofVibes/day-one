import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attacks,
  groupPurchase,
  JUDGE_STEPS,
  po1042,
  proofLinks,
  reconciliation,
  remaining,
  testCount,
} from "./judge.ts";
import { judgeStart } from "./judgeRoute.ts";

const root = resolve(import.meta.dirname, "../..");

/** Every recording under data/ (the chain fixtures the replays and the suite read), as one text. */
function recordings(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".json") || name.endsWith(".txt"))
        out.push(readFileSync(path, "utf8"));
    }
  };
  for (const dir of ["replay", "usdc", "attacks", "sealed"]) walk(join(root, "data", dir));
  return out.join("\n");
}

const TESTNET_TX = /^https:\/\/testnet\.nearblocks\.io\/txns\/([1-9A-HJ-NP-Za-km-z]{43,44})$/;

describe("judge mode", () => {
  it("links only well-formed testnet explorer URLs that the recordings hold", () => {
    const recorded = recordings();
    const links = [...JUDGE_STEPS.flatMap((s) => s.links), ...proofLinks()];
    expect(links.length).toBeGreaterThan(20);
    for (const l of links) {
      const hash = TESTNET_TX.exec(l.url)?.[1];
      expect(hash, l.url).toBeDefined();
      expect(recorded.includes(hash as string), `${l.label}: ${l.url}`).toBe(true);
      expect(l.label.trim()).not.toBe("");
    }
    expect(new Set(proofLinks().map((l) => l.url)).size).toBe(proofLinks().length);
  });

  it("holds every step's links in the summary", () => {
    const summary = new Set(proofLinks().map((l) => l.url));
    for (const s of JUDGE_STEPS) for (const l of s.links) expect(summary.has(l.url)).toBe(true);
  });

  it("tells the proof points as the recordings have them", () => {
    const titles = JUDGE_STEPS.map((s) => s.title);
    expect(JUDGE_STEPS).toHaveLength(10);
    expect(titles).toContain("15 of 15 attacks refused");
    expect(titles).toContain("Group buy PO-G-2001, $9,490.00");
    expect(titles).toContain("7 of 7 reconciliation checks agree");
    expect(titles).toContain("Real USDC: PO-1047, $19.00");
    const po = po1042();
    expect(po.refused?.tx.startsWith("FQepeewB")).toBe(true);
    expect(po.approved?.tx.startsWith("EW5A8qi3")).toBe(true);
    expect(po.approved?.signer).toBe("director.plant-b.acme-holdings.testnet");
    expect(po.funded?.method).toBe("submit_po");
    expect(po.funded?.status).toBe("success");
    expect(po.released?.tx.startsWith("2zwgaHgW")).toBe(true);
    const group = groupPurchase();
    expect(group.shares.map((s) => s.amount)).toEqual([4745, 4745]);
    expect(group.declined).toEqual(["Acme Lakeview"]);
    expect(group.released?.tx.startsWith("9XDEo3Dp")).toBe(true);
    expect(attacks()).toMatchObject({ total: 15, refused: 15 });
    expect(reconciliation().checks.filter((c) => c.ok)).toHaveLength(7);
    const usdc = JUDGE_STEPS.find((s) => s.id === "usdc");
    expect(usdc?.links).toHaveLength(5);
  });

  it("gives each step a recorded step, a reading time and a short body", () => {
    for (const s of JUDGE_STEPS) {
      expect(s.at).toBeGreaterThanOrEqual(0);
      expect(s.seconds).toBeGreaterThan(0);
      expect(s.body.length).toBeLessThan(320);
    }
    expect(remaining(0)).toMatch(/^about \d+ min left$/);
    expect(remaining(JUDGE_STEPS.length - 1)).toBe("under a minute left");
  });

  it("reads ?judge= and the last green test run", () => {
    expect(judgeStart("")).toBeNull();
    expect(judgeStart("?judge=1")).toBe(0);
    expect(judgeStart("?judge=4&page=map")).toBe(3);
    expect(judgeStart("?judge=summary")).toBe("summary");
    expect(judgeStart("?judge=x")).toBe(0);
    expect(testCount(undefined)).toBeNull();
    expect(testCount("null")).toBeNull();
    expect(testCount('{"tests":760,"files":99,"at":"2026-10-31T12:00:00Z"}')?.tests).toBe(760);
  });
});
