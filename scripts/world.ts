// npm run world: regenerates Hollow Pine's twelve-month world (docs/UPGRADE_BRIEF.md §2.1) into
// data/world/hollow-pine.json from server/src/world/config.ts and the frozen anchors. No keys,
// no network: the anchors are read from a replay of the recorded run and must equal the frozen
// copy in data/world/hollow-pine.anchors.json, or nothing is written.
//   --check    regenerate in memory and exit 1 if the committed file differs
//   --freeze   rewrite the frozen anchors from the replay (only when an anchor changed on purpose)
//   --json     print one JSON line after the summary

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { World } from "../server/src/world/index.ts";
import {
  frozenAnchors,
  liveAnchors,
  serialize,
  sha256,
  WORLD_FILES,
  worldText,
} from "./lib/world-run.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const files = WORLD_FILES(root);
mkdirSync(dirname(files.world), { recursive: true });

const live = await liveAnchors(root);
if (args.includes("--freeze")) {
  writeFileSync(files.anchors, serialize(live));
  console.log(
    `Froze ${live.lots.length} anchor lots, ${live.batches.length} batches, ${live.pos.length} POs and ${live.chain.length} recorded transactions.`,
  );
}
if (!existsSync(files.anchors)) fail("No frozen anchors yet: npm run world -- --freeze");
const frozen = frozenAnchors(root);
if (!isDeepStrictEqual(live, frozen)) {
  fail(
    "The seed or the recorded run no longer gives the frozen anchors (data/world/hollow-pine.anchors.json).",
  );
}

const text = worldText(frozen);
const world = JSON.parse(text) as World;
const hash = sha256(text);
if (args.includes("--check")) {
  const committed = existsSync(files.world) ? readFileSync(files.world, "utf8") : "";
  if (committed !== text)
    fail(`data/world/hollow-pine.json is stale: npm run world (expected ${hash.slice(0, 12)}).`);
} else {
  writeFileSync(files.world, text);
}

const count = (era: string, list: readonly { era: string }[]) =>
  list.filter((x) => x.era === era).length;
const summary = {
  file: "data/world/hollow-pine.json",
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
  incidents: world.incidents.map((i) => i.id),
};
console.log(
  `Hollow Pine, ${world.meta.calendar.start} to ${world.meta.calendar.end}: ` +
    `${world.batches.length} batches (${summary.batches.legacy} legacy, ${summary.batches.anchor} anchored, ${summary.batches.simulated} simulated), ` +
    `${world.pos.length} POs, ${world.lots.length} lots, ${world.bills.length} bills, ${world.incidents.length} incidents.`,
);
console.log(
  `Anchors match the frozen copy. ${args.includes("--check") ? "Committed file is current" : "Wrote data/world/hollow-pine.json"} (sha256 ${hash.slice(0, 12)}, ${(summary.bytes / 1e6).toFixed(1)} MB).`,
);
if (args.includes("--json")) console.log(JSON.stringify(summary));

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
