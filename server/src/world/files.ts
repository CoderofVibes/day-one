// Where the committed worlds live (data/world/, written by `npm run world`) and how to read them.
// The API and the web export read them; nothing here generates.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { World } from "./index.ts";

/** The plants in generation order, and the name each one's files go by in data/world/. */
export const PLANT_FILES = [
  { facility: "B", slug: "hollow-pine" },
  { facility: "A", slug: "riverside" },
  { facility: "C", slug: "lakeview" },
] as const;
export type WorldFacility = (typeof PLANT_FILES)[number]["facility"];

export function worldFile(root: string, facility: WorldFacility, kind: "world" | "anchors") {
  const slug = PLANT_FILES.find((p) => p.facility === facility)?.slug ?? "hollow-pine";
  return resolve(root, `data/world/${slug}${kind === "anchors" ? ".anchors" : ""}.json`);
}

const cache = new Map<string, World[]>();

/** The three committed worlds, in generation order; none when the files are missing. */
export function readWorlds(root: string): World[] {
  const hit = cache.get(root);
  if (hit) return hit;
  const files = PLANT_FILES.map((p) => worldFile(root, p.facility, "world"));
  const worlds = files.every(existsSync)
    ? files.map((f) => JSON.parse(readFileSync(f, "utf8")) as World)
    : [];
  cache.set(root, worlds);
  return worlds;
}
