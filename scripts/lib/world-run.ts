// Shared by `npm run world` and its test: read each plant's anchors from a replay of the recorded
// run, generate the three plants' worlds from the frozen anchors, and serialize them the one way
// the committed files are written.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runDemo } from "../../agents/kevin/src/demo.ts";
import { openDemoEnv } from "../../api/src/env.ts";
import { type Anchors, readAnchors } from "../../server/src/world/anchors.ts";
import { WORLDS, type WorldConfig } from "../../server/src/world/config.ts";
import { generateWorlds, type World } from "../../server/src/world/index.ts";

/** The plants in generation order, and the name each one's files go by in data/world/. */
export const PLANTS = [
  { facility: "B", slug: "hollow-pine" },
  { facility: "A", slug: "riverside" },
  { facility: "C", slug: "lakeview" },
] as const;
export type Facility = (typeof PLANTS)[number]["facility"];

export const WORLD_FILES = (root: string, facility: Facility = "B") => {
  const slug = PLANTS.find((p) => p.facility === facility)?.slug ?? "hollow-pine";
  return {
    anchors: resolve(root, `data/world/${slug}.anchors.json`),
    world: resolve(root, `data/world/${slug}.json`),
  };
};

/** Every plant's anchors as the seed and the replayed recorded run leave them. */
export async function liveAnchors(root: string): Promise<Record<Facility, Anchors>> {
  const env = await openDemoEnv({ root });
  const run = await runDemo(env.deps);
  if (!run.ok) throw new Error("world: the recorded run did not replay");
  const out = Object.fromEntries(
    PLANTS.map((p) => [p.facility, readAnchors(env.db, p.facility)]),
  ) as Record<Facility, Anchors>;
  env.db.$client.close();
  return out;
}

export const serialize = (value: unknown) => `${JSON.stringify(value, null, 1)}\n`;
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function frozenAnchors(root: string): Record<Facility, Anchors> {
  return Object.fromEntries(
    PLANTS.map((p) => [
      p.facility,
      JSON.parse(readFileSync(WORLD_FILES(root, p.facility).anchors, "utf8")) as Anchors,
    ]),
  ) as Record<Facility, Anchors>;
}

/** The three worlds, generated from the frozen anchors. */
export function worlds(
  anchors: Record<Facility, Anchors>,
  configs: readonly WorldConfig[] = WORLDS,
): Record<Facility, World> {
  return generateWorlds(configs, anchors) as Record<Facility, World>;
}

/** Each plant's world file, as committed. */
export function worldTexts(
  anchors: Record<Facility, Anchors>,
  configs: readonly WorldConfig[] = WORLDS,
): Record<Facility, string> {
  const w = worlds(anchors, configs);
  return Object.fromEntries(PLANTS.map((p) => [p.facility, serialize(w[p.facility])])) as Record<
    Facility,
    string
  >;
}

/** The committed worlds, read back. */
export function committedWorlds(root: string): Record<Facility, World> {
  return Object.fromEntries(
    PLANTS.map((p) => [
      p.facility,
      JSON.parse(readFileSync(WORLD_FILES(root, p.facility).world, "utf8")) as World,
    ]),
  ) as Record<Facility, World>;
}
