// The worlds against the repo: the frozen anchors are what the seed and a replay of the recorded
// run leave at each plant today (every hand-authored record and every proof-point transaction),
// and the committed world files are what `npm run world` generates from them.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  frozenAnchors,
  liveAnchors,
  PLANTS,
  sha256,
  WORLD_FILES,
  worldTexts,
} from "./world-run.ts";

const root = resolve(import.meta.dirname, "../..");

describe("the committed worlds", () => {
  it("anchors equal a fresh replay of the seed and the recorded run", async () => {
    const live = await liveAnchors(root);
    expect(live).toEqual(frozenAnchors(root));
    // Proof points: BR-B-1045's anchored record hash and PO-1042's refused-then-approved path.
    const br1045 = live.B.batches.find((b) => b.batchNo === "BR-B-1045");
    expect(br1045?.recordHash).toBeTruthy();
    expect(
      live.B.chain.filter((t) => t.poNo === "PO-1042").map((t) => `${t.method}:${t.status}`),
    ).toEqual([
      "submit_po:refused",
      "approve_po:success",
      "submit_po:success",
      "accept_po:success",
      "mark_shipped:success",
      "confirm_receipt:success",
      "qc_release:success",
    ]);
    // Riverside's Cal-Mag batches behind the 115.199 kg flag, and Lakeview's packaging stock.
    expect(live.A.batches.map((b) => b.batchNo)).toEqual(
      expect.arrayContaining(["BR-A-2201", "BR-A-2204"]),
    );
    expect(live.C.lots.map((l) => l.lot)).toContain("BTL-260905-01");
  }, 60_000);

  it("are what npm run world generates, byte for byte", () => {
    const texts = worldTexts(frozenAnchors(root));
    for (const p of PLANTS) {
      const committed = readFileSync(WORLD_FILES(root, p.facility).world, "utf8");
      expect(sha256(texts[p.facility]), p.slug).toBe(sha256(committed));
    }
  }, 60_000);
});
