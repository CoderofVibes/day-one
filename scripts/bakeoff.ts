// The vision bake-off (research 13, "Bake-off"): each candidate model transcribes the seven
// rendered batch records, and the transcriptions are scored against the ground truth.
//
//   npm run bakeoff                     # the three candidates
//   npm run bakeoff -- nearai:Qwen/Qwen3.8-27B
//
// Live calls: needs NEARAI_API_KEY and ANTHROPIC_API_KEY in .env (about $0.10 for all three).
// Writes each answer to data/bakeoff/<model>/<batch>.json and prints the table for research 13.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BATCH_RECORD_SCHEMA,
  type BatchRecordExtraction,
  EXTRACTION_PROMPT,
  EXTRACTION_SYSTEM,
} from "../server/src/extraction/schema.ts";
import { accuracy, type RecordScore, scoreRecord } from "../server/src/extraction/score.ts";
import { AnthropicAdapter } from "../server/src/llm/anthropic.ts";
import { parseRoute } from "../server/src/llm/client.ts";
import { NearAiAdapter } from "../server/src/llm/nearai.ts";
import type { LlmAdapter } from "../server/src/llm/types.ts";
import { BATCH_RECORDS } from "../server/src/seed/batchRecords.ts";

const root = resolve(import.meta.dirname, "..");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));

const CANDIDATES = [
  "nearai:z-ai/glm-5.3-flash",
  "nearai:Qwen/Qwen3.8-27B",
  "anthropic:claude-sonnet-5-5",
];
const routes = (process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES).map(parseRoute);

function adapterFor(provider: string): LlmAdapter {
  if (provider === "nearai") {
    const key = process.env.NEARAI_API_KEY;
    if (!key) throw new Error("NEARAI_API_KEY is not set");
    return new NearAiAdapter(key, process.env.NEARAI_BASE_URL);
  }
  return new AnthropicAdapter();
}

interface Run {
  model: string;
  scores: RecordScore[];
  failures: { batchNo: string; error: string }[];
  inputTokens: number;
  outputTokens: number;
  seconds: number[];
}

const runs: Run[] = [];
for (const route of routes) {
  const adapter = adapterFor(route.provider);
  const dir = join(root, "data/bakeoff", route.model.replaceAll("/", "_"));
  mkdirSync(dir, { recursive: true });
  const run: Run = {
    model: `${route.provider}:${route.model}`,
    scores: [],
    failures: [],
    inputTokens: 0,
    outputTokens: 0,
    seconds: [],
  };
  await Promise.all(
    BATCH_RECORDS.map(async (record) => {
      const image = readFileSync(join(root, "data/batch-records", `${record.batchNo}.jpg`));
      const started = Date.now();
      try {
        const result = await adapter.complete(route.model, {
          system: EXTRACTION_SYSTEM,
          prompt: EXTRACTION_PROMPT,
          images: [{ mediaType: "image/jpeg", base64: image.toString("base64") }],
          schema: BATCH_RECORD_SCHEMA,
          maxTokens: 12_000,
        });
        const seconds = (Date.now() - started) / 1000;
        run.seconds.push(seconds);
        run.inputTokens += result.usage.inputTokens;
        run.outputTokens += result.usage.outputTokens;
        writeFileSync(
          join(dir, `${record.batchNo}.json`),
          `${JSON.stringify({ model: run.model, seconds, usage: result.usage, answer: result.json }, null, 2)}\n`,
        );
        run.scores.push(scoreRecord(record, result.json as BatchRecordExtraction));
      } catch (error) {
        run.failures.push({ batchNo: record.batchNo, error: String(error).slice(0, 300) });
      }
    }),
  );
  runs.push(run);
}

const pct = ({ correct, total }: { correct: number; total: number }) =>
  total ? `${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)` : "-";

const summary = runs.map((run) => {
  const fields = run.scores.flatMap((s) => s.fields);
  const typed = accuracy(fields, "typed");
  const handwritten = accuracy(fields, "handwritten");
  const smudge = run.scores.find((s) => s.smudgeFlagged !== undefined)?.smudgeFlagged ?? null;
  const pass =
    run.failures.length === 0 &&
    typed.correct / typed.total >= 0.95 &&
    handwritten.correct / handwritten.total >= 0.85 &&
    smudge === true;
  return {
    model: run.model,
    typed,
    handwritten,
    smudgeFlagged: smudge,
    failures: run.failures,
    misses: fields.length
      ? run.scores.flatMap((s) =>
          s.fields.filter((f) => !f.ok).map((f) => ({ batchNo: s.batchNo, ...f })),
        )
      : [],
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    medianSeconds: run.seconds.sort((a, b) => a - b)[Math.floor(run.seconds.length / 2)] ?? null,
    pass,
  };
});

writeFileSync(join(root, "data/bakeoff/summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(
  "| Model | Typed fields | Handwritten fields | Smudge flagged | Failed calls | Tokens in / out | Median s | Pass |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const s of summary) {
  console.log(
    `| \`${s.model}\` | ${pct(s.typed)} | ${pct(s.handwritten)} | ${s.smudgeFlagged ?? "-"} | ${s.failures.length} | ${s.inputTokens} / ${s.outputTokens} | ${s.medianSeconds?.toFixed(1) ?? "-"} | ${s.pass ? "yes" : "no"} |`,
  );
}
for (const s of summary) {
  for (const f of s.failures) console.log(`FAILED ${s.model} ${f.batchNo}: ${f.error}`);
  for (const m of s.misses)
    console.log(`miss ${s.model} ${m.batchNo} ${m.field}: expected ${m.expected}, got ${m.got}`);
}
