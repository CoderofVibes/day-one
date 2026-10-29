// data/replay/attestation.json and the answers it covers: the receipts in data/replay/*-llm.json.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmFixture } from "../llm/client.ts";
import type { AnswerReceipt, AttestationFixture } from "./types.ts";

export const ATTESTATION_FILE = "data/replay/attestation.json";
/** Every LLM fixture whose NEAR AI answers the attestation covers. */
export const LLM_FIXTURE_FILES = [
  "data/replay/demo-llm.json",
  "data/replay/attacks-llm.json",
  "data/replay/inbox-llm.json",
];

/** The receipts of the recorded NEAR AI answers, in fixture order; other providers have none. */
export function recordedReceipts(root: string, files = LLM_FIXTURE_FILES): AnswerReceipt[] {
  const receipts: AnswerReceipt[] = [];
  for (const file of files) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const fixture = JSON.parse(readFileSync(path, "utf8")) as LlmFixture;
    for (const entry of fixture.entries) {
      const receipt = entry.result.receipt;
      if (entry.result.provider !== "nearai" || !receipt) continue;
      receipts.push({
        chatId: receipt.chatId,
        model: entry.result.model,
        task: entry.task,
        promptStart: entry.promptStart,
        requestSha256: receipt.requestSha256,
        responseSha256: receipt.responseSha256,
      });
    }
  }
  return receipts;
}

export function readAttestationFixture(root: string): AttestationFixture | null {
  const path = join(root, ATTESTATION_FILE);
  if (!existsSync(path)) return null;
  const fixture = JSON.parse(readFileSync(path, "utf8")) as AttestationFixture;
  if (fixture.version !== 1) {
    throw new Error(`attestation fixture version ${fixture.version}, expected 1`);
  }
  return fixture;
}
