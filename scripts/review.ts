// npm run review — Kevin's morning review of the purchaser's mailbox (research 24 §2): the
// invented emails and meeting notes from the weekend before the demo, each read by the model,
// checked against the seeded ledger at the demo's start, and left as a draft for Ray: ready
// to sign, nothing to do, a question, or refused (the "new bank details" email). Replays the
// recorded answers: no keys, no network. Nothing is signed here.
//   --json           print one JSON line after the readable text
//   --live --record  read the mailbox on NEAR AI Cloud (NEARAI_API_KEY, a few cents) and
//                    rewrite data/replay/review-llm.json; run npm run attest after it
// Exit 0 when every message was read.

import { existsSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { DEMO_CLOCK } from "../agents/kevin/src/demo.ts";
import { formatReview, morningReview, reviewSince } from "../agents/kevin/src/morningReview.ts";
import { fixtureFiles } from "../api/src/env.ts";
import { openLedger } from "../server/src/ledger/db.ts";
import { createLlm, RecordingLlm, ReplayLlm } from "../server/src/llm/client.ts";
import type { LlmClient } from "../server/src/llm/types.ts";
import { seedLedger } from "../server/src/seed/index.ts";
import { MAILBOX, MAILBOX_FACILITY } from "../server/src/seed/mailbox.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const live = args.includes("--live");
const record = args.includes("--record");
if (record && !live) {
  console.error("--record needs the live model: npm run review -- --live --record");
  process.exit(2);
}

const fixture = fixtureFiles(root).reviewLlm;
let llm: LlmClient;
let recorder: RecordingLlm | null = null;
if (live) {
  if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
  if (!process.env.NEARAI_API_KEY) {
    console.error("NEARAI_API_KEY is not set (.env): the live read goes to NEAR AI Cloud.");
    process.exit(2);
  }
  const routed = createLlm(fixture, {
    ...process.env,
    DAYONE_MODE: "live",
    LLM_RECORD_FIXTURES: "false",
  });
  recorder = record ? new RecordingLlm(routed) : null;
  llm = recorder ?? routed;
} else {
  if (!existsSync(fixture)) {
    console.error(
      `No recorded answers at ${relative(root, fixture)}; npm run review -- --live --record writes them.`,
    );
    process.exit(2);
  }
  llm = ReplayLlm.fromFile(fixture);
}

const db = openLedger();
seedLedger(db);
const review = await morningReview(db, llm, MAILBOX, {
  now: DEMO_CLOCK.start,
  facility: MAILBOX_FACILITY,
  since: reviewSince(DEMO_CLOCK.start),
});
console.log(formatReview(review));

if (recorder) {
  const saved = recorder.fixture();
  saved.entries.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(fixture, `${JSON.stringify(saved, null, 2)}\n`);
  console.log(
    `\nSaved ${saved.entries.length} answers to ${relative(root, fixture)}; run npm run attest next.`,
  );
}
if (json) console.log(JSON.stringify(review));
