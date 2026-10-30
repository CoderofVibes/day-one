// npm run inbox — drops the demo scans into Kevin's watched folder (data/inbox/batch-records/)
// and shows each one land: what Kevin read, what he asks Ray, what he set aside (research 24
// §1). Replays the recorded vision answers: no keys, no network. With npm run api running, the
// same files show up on Ray's screen under "Waiting for you". The files stay in the folder, so
// an API started later finds them waiting, as Ray would at 5am.
//   --all            every bake-off record and the packing slip, not just the demo inbox
//   --json           print one JSON line after the readable text
//   --live --record  read the recordable scans on NEAR AI Cloud (NEARAI_API_KEY, a few cents)
//                    and rewrite data/replay/inbox-llm.json; run npm run attest after it
// Exit 0 when every dropped file landed and none failed to read.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DEMO_CLOCK } from "../agents/kevin/src/demo.ts";
import { type InboxItem, inboxLine, readInboxFile } from "../agents/kevin/src/inbox.ts";
import {
  ALL_SCANS,
  DEMO_INBOX,
  fixtureFiles,
  INBOX_DIR,
  inboxReplay,
  RECORDABLE_SCANS,
} from "../api/src/env.ts";
import { watchFolder } from "../api/src/watcher.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { createLlm, RecordingLlm } from "../server/src/llm/client.ts";
import type { LlmClient } from "../server/src/llm/types.ts";
import { seedLedger } from "../server/src/seed/index.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const live = args.includes("--live");
const record = args.includes("--record");
if (record && !live) {
  console.error("--record needs the live model: npm run inbox -- --live --record");
  process.exit(2);
}

const sources = record ? RECORDABLE_SCANS : args.includes("--all") ? ALL_SCANS : DEMO_INBOX;

const fixtures = fixtureFiles(root);
let llm: LlmClient;
let recorder: RecordingLlm | null = null;
if (live) {
  if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
  if (!process.env.NEARAI_API_KEY) {
    console.error("NEARAI_API_KEY is not set (.env): the live read goes to NEAR AI Cloud.");
    process.exit(2);
  }
  const routed = createLlm(fixtures.inboxLlm, {
    ...process.env,
    DAYONE_MODE: "live",
    LLM_RECORD_FIXTURES: "false",
  });
  recorder = record ? new RecordingLlm(routed) : null;
  llm = recorder ?? routed;
} else {
  llm = inboxReplay(fixtures.llm, fixtures.inboxLlm);
}

const db = openLedger();
seedLedger(db);
const folder = relative(root, INBOX_DIR).split(sep).join("/");
mkdirSync(INBOX_DIR, { recursive: true });

// Earlier copies of the demo scans go first, so the folder holds what this run drops and each
// file lands again (Kevin keys the queue on content anyway). Anything else in it is left alone.
const nameOf = (s: string) => s.split("/").at(-1) ?? s;
const names = sources.map(nameOf);
for (const s of ALL_SCANS) {
  rmSync(join(INBOX_DIR, nameOf(s)), { force: true });
}

const landed = new Map<string, InboxItem>();
let failed = 0;
const watch = watchFolder({
  dir: INBOX_DIR,
  stableMs: 500,
  pollMs: 500,
  onFile: async (path, name) => {
    // A recording holds the recordable scans only; whatever else is in the folder waits.
    if (record && !names.includes(name)) return;
    const read = await readInboxFile(
      db,
      llm,
      { path: relative(root, path).split(sep).join("/"), bytes: readFileSync(path) },
      DEMO_CLOCK.start,
    );
    if (read.item.status === "failed") failed++;
    landed.set(name, read.item);
    console.log(`  landed  ${inboxLine(read)}`);
  },
  onError: (error, name) => {
    failed++;
    console.error(`  ${name}: ${(error as Error).message}`);
  },
});

console.log(`Kevin watches ${folder}/.`);
for (const [i, source] of sources.entries()) {
  const name = names[i] as string;
  copyFileSync(join(root, source), join(INBOX_DIR, name));
  console.log(`  dropped ${name}`);
  await sleep(400);
}

const deadline = Date.now() + (live ? 10 * 60_000 : 30_000);
while (names.some((n) => !landed.has(n)) && Date.now() < deadline) {
  await watch.scan();
  await sleep(250);
}
await watch.scan();
watch.stop();

const items = names.flatMap((n) => {
  const item = landed.get(n);
  return item ? [item] : [];
});
const waiting = items.filter((i) => i.status === "waiting");
const questions = waiting.reduce((s, i) => s + i.questions, 0);
const setAside = items.filter((i) => i.status === "set_aside").length;
const missing = names.filter((n) => !landed.has(n));
const who = [...new Set(waiting.map((i) => i.waitingFor ?? "the purchaser"))].join(" and ");

console.log();
console.log(
  `${items.length} of ${names.length} scans landed: ${waiting.length} wait for ${who || "nobody"}` +
    ` (${questions} ${questions === 1 ? "question" : "questions"}), ${setAside} set aside` +
    (failed ? `, ${failed} not read` : "") +
    (missing.length ? `; never landed: ${missing.join(", ")}` : "") +
    ".",
);
if (!record) {
  console.log(
    'Nothing is posted until Ray confirms. With npm run api, they are on his screen under "Waiting for you".',
  );
}

if (recorder && (failed || missing.length)) {
  console.error("Not saved: every recordable scan must be read for the fixture to replay.");
} else if (recorder) {
  const fixture = recorder.fixture();
  fixture.entries.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(fixtures.inboxLlm, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(
    `Saved ${fixture.entries.length} answers to ${relative(root, fixtures.inboxLlm)}; run npm run attest next.`,
  );
}

if (json) {
  console.log(
    JSON.stringify({
      folder,
      dropped: names,
      waiting: waiting.length,
      questions,
      setAside,
      failed,
      missing,
      items,
    }),
  );
}
process.exit(missing.length || failed ? 1 : 0);
