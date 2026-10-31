// The world against the repo: the frozen anchors are what the seed and a replay of the recorded
// run leave at Hollow Pine today (every hand-authored record and every proof-point transaction),
// and the committed world file is what `npm run world` generates from them.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { frozenAnchors, liveAnchors, sha256, WORLD_FILES, worldText } from "./world-run.ts";

const root = resolve(import.meta.dirname, "../..");

describe("the committed world", () => {
  it("anchors equal a fresh replay of the seed and the recorded run", async () => {
    const live = await liveAnchors(root);
    expect(live).toEqual(frozenAnchors(root));
    // Proof points: BR-B-1045's anchored record hash and PO-1042's refused-then-approved path.
    const br1045 = live.batches.find((b) => b.batchNo === "BR-B-1045");
    expect(br1045?.recordHash).toBeTruthy();
    expect(
      live.chain.filter((t) => t.poNo === "PO-1042").map((t) => `${t.method}:${t.status}`),
    ).toEqual([
      "submit_po:refused",
      "approve_po:success",
      "submit_po:success",
      "accept_po:success",
      "mark_shipped:success",
      "confirm_receipt:success",
      "qc_release:success",
    ]);
  }, 60_000);

  it("is what npm run world generates, byte for byte", () => {
    const committed = readFileSync(WORLD_FILES(root).world, "utf8");
    expect(sha256(worldText(frozenAnchors(root)))).toBe(sha256(committed));
  }, 60_000);
});
