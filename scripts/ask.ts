// npm run ask — Talk to Kevin from the terminal (docs/UPGRADE_BRIEF.md §3.2): Kevin answers a
// question from the fact cards of the recorded run, citing the records he used, with the
// model that answered ("Signed in enclave ✓" for NEAR AI Cloud, "Fallback model · not
// attested" otherwise). Replays the recorded answers to the suggested questions by default:
// no keys, no network. Nothing is changed anywhere: Kevin explains and proposes, never acts.
//   npm run ask -- "<question>"   one question (in replay, only a suggested one was recorded)
//   npm run ask                   the six suggested questions
//   --json                        print one JSON line after the readable text
//   --live                        ask NEAR AI Cloud (NEARAI_API_KEY in .env; the labeled
//                                 fallback when ANTHROPIC_API_KEY is set and NEAR AI fails)
//   --live --record               ask the six suggested questions live and rewrite
//                                 data/replay/ask-llm.json; then npm run attest and npm run web:data
// Exit 0 when every question was answered (an honest "I can't tell" counts), 1 otherwise.

import { existsSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  askKevin,
  formatAnswer,
  type KevinAnswer,
  SUGGESTED_QUESTIONS,
} from "../agents/kevin/src/ask.ts";
import { buildFactCards } from "../agents/kevin/src/facts.ts";
import { readFactsSnapshot } from "../api/src/ask.ts";
import { fixtureFiles } from "../api/src/env.ts";
import { createFallbackLlm, RecordingLlm, ReplayLlm } from "../server/src/llm/client.ts";
import type { LlmClient } from "../server/src/llm/types.ts";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const live = args.includes("--live");
const record = args.includes("--record");
const asked = args.filter((a) => !a.startsWith("--"));
if (record && !live) {
  console.error("--record needs the live model: npm run ask -- --live --record");
  process.exit(2);
}
if (record && asked.length) {
  console.error("--record records the six suggested questions; leave the question out.");
  process.exit(2);
}

const fixture = fixtureFiles(root).askLlm;
let llm: LlmClient;
let recorder: RecordingLlm | null = null;
if (live) {
  if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
  const routed = createFallbackLlm(process.env, (error) =>
    console.error(`NEAR AI Cloud failed (${(error as Error).message}); asking the fallback model.`),
  );
  if (!routed || !process.env.NEARAI_API_KEY) {
    console.error(
      "NEARAI_API_KEY is not set (.env): Kevin's live answers come from NEAR AI Cloud.",
    );
    process.exit(2);
  }
  recorder = record ? new RecordingLlm(routed) : null;
  llm = recorder ?? routed;
} else {
  if (!existsSync(fixture)) {
    console.error(
      `No recorded answers at ${relative(root, fixture)}; npm run ask -- --live --record writes them.`,
    );
    process.exit(2);
  }
  llm = ReplayLlm.fromFile(fixture);
}

const cards = buildFactCards(readFactsSnapshot(root));
const questions = asked.length ? [asked.join(" ")] : [...SUGGESTED_QUESTIONS];
const answers: KevinAnswer[] = [];
let failed = 0;
for (const question of questions) {
  try {
    const answer = await askKevin(llm, cards, question);
    answers.push(answer);
    console.log(`${formatAnswer(answer)}\n`);
  } catch (error) {
    failed++;
    const message = (error as Error).message;
    console.log(
      `Q: ${question}\n${
        /no recorded/.test(message)
          ? "Not in the recording: the replay holds the suggested questions. npm run ask -- --live asks NEAR AI Cloud."
          : `Kevin could not answer: ${message}`
      }\n`,
    );
  }
}

if (recorder) {
  const saved = recorder.fixture();
  saved.entries.sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(fixture, `${JSON.stringify(saved, null, 2)}\n`);
  const signed = saved.entries.filter((e) => e.result.receipt).length;
  console.log(
    `Saved ${saved.entries.length} answers (${signed} signed by NEAR AI Cloud) to ${relative(root, fixture)}; run npm run attest, then npm run web:data.`,
  );
}
console.log(`${answers.length} of ${questions.length} questions answered.`);
if (json) console.log(JSON.stringify({ ok: failed === 0, answers }));
process.exit(failed ? 1 : 0);
