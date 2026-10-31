// Shared by `npm run world` and its test: read the anchors from a replay of the recorded run,
// generate Hollow Pine's world from the frozen anchors, and serialize it the one way the
// committed file is written.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runDemo } from "../../agents/kevin/src/demo.ts";
import { openDemoEnv } from "../../api/src/env.ts";
import { type Anchors, readAnchors } from "../../server/src/world/anchors.ts";
import { WORLD, type WorldConfig } from "../../server/src/world/config.ts";
import { generateWorld } from "../../server/src/world/index.ts";

export const WORLD_FILES = (root: string) => ({
  anchors: resolve(root, "data/world/hollow-pine.anchors.json"),
  world: resolve(root, "data/world/hollow-pine.json"),
});

/** The anchors as the seed and the replayed recorded run leave them at Hollow Pine. */
export async function liveAnchors(root: string): Promise<Anchors> {
  const env = await openDemoEnv({ root });
  const run = await runDemo(env.deps);
  if (!run.ok) throw new Error("world: the recorded run did not replay");
  const anchors = readAnchors(env.db, "B");
  env.db.$client.close();
  return anchors;
}

export const serialize = (value: unknown) => `${JSON.stringify(value, null, 1)}\n`;
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function frozenAnchors(root: string): Anchors {
  return JSON.parse(readFileSync(WORLD_FILES(root).anchors, "utf8")) as Anchors;
}

export function worldText(anchors: Anchors, config: WorldConfig = WORLD) {
  return serialize(generateWorld(config, anchors));
}
