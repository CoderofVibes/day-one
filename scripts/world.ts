// npm run world: regenerates the three plants' twelve-month worlds (docs/UPGRADE_BRIEF.md §2.1)
// into data/world/{hollow-pine,riverside,lakeview}.json from server/src/world/config.ts and the
// frozen anchors. No keys, no network: the anchors are read from a replay of the recorded run and
// must equal the frozen copies in data/world/*.anchors.json, or nothing is written.
//   --check    regenerate in memory and exit 1 if a committed file differs
//   --freeze   rewrite the frozen anchors from the replay (only when an anchor changed on purpose)
//   --json     print one JSON line after the summary

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { World } from "../server/src/world/index.ts";
import {
  frozenAnchors,
  liveAnchors,
  PLANTS,
  serialize,
  sha256,
  WORLD_FILES,
  worldTexts,
} from "./lib/world-run.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
mkdirSync(dirname(WORLD_FILES(root).world), { recursive: true });
const rel = (path: string) => relative(root, path).replaceAll("\\", "/");

const live = await liveAnchors(root);
if (args.includes("--freeze")) {
  for (const p of PLANTS) {
    const a = live[p.facility];
    writeFileSync(WORLD_FILES(root, p.facility).anchors, serialize(a));
    console.log(
      `Froze ${p.facility}: ${a.lots.length} anchor lots, ${a.batches.length} batches, ${a.pos.length} POs and ${a.chain.length} recorded transactions.`,
    );
  }
}
for (const p of PLANTS) {
  const file = WORLD_FILES(root, p.facility).anchors;
  if (!existsSync(file)) fail(`No frozen anchors for ${p.slug} yet: npm run world -- --freeze`);
}
const frozen = frozenAnchors(root);
for (const p of PLANTS) {
  if (!isDeepStrictEqual(live[p.facility], frozen[p.facility]))
    fail(
      `The seed or the recorded run no longer gives the frozen anchors (${rel(WORLD_FILES(root, p.facility).anchors)}).`,
    );
}

const texts = worldTexts(frozen);
const count = (era: string, list: readonly { era: string }[]) =>
  list.filter((x) => x.era === era).length;
const summary = PLANTS.map((p) => {
  const text = texts[p.facility];
  const file = WORLD_FILES(root, p.facility).world;
  const hash = sha256(text);
  if (check) {
    const committed = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (committed !== text)
      fail(`${rel(file)} is stale: npm run world (expected ${hash.slice(0, 12)}).`);
  } else {
    writeFileSync(file, text);
  }
  const world = JSON.parse(text) as World;
  console.log(
    `${world.meta.plant}, ${world.meta.calendar.start} to ${world.meta.calendar.end}: ` +
      `${world.batches.length} batches (${count("legacy", world.batches)} legacy, ${count("anchor", world.batches)} anchored, ${count("simulated", world.batches)} simulated), ` +
      `${world.pos.length} POs, ${world.lots.length} lots, ${world.bills.length} bills, ${world.transfers.length} transfer lines, ${world.shipments.length} shipments, ${world.incidents.length} incidents ` +
      `(sha256 ${hash.slice(0, 12)}, ${(Buffer.byteLength(text) / 1e6).toFixed(1)} MB).`,
  );
  return {
    file: rel(file),
    sha256: hash,
    bytes: Buffer.byteLength(text),
    months: world.monthly.length,
    batches: {
      legacy: count("legacy", world.batches),
      anchor: count("anchor", world.batches),
      simulated: count("simulated", world.batches),
    },
    pos: {
      legacy: count("legacy", world.pos),
      anchor: count("anchor", world.pos),
      simulated: count("simulated", world.pos),
    },
    lots: world.lots.length,
    bills: world.bills.length,
    shipments: world.shipments.length,
    incidents: world.incidents.map((i) => i.id),
  };
});
console.log(
  `Anchors match the frozen copies. ${check ? "Committed files are current." : "Wrote data/world/."}`,
);
if (args.includes("--json")) console.log(JSON.stringify(summary));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
