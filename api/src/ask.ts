// Talk to Kevin behind the HTTP API and the scripts (docs/UPGRADE_BRIEF.md §3.2): the fact
// cards from the recorded run's snapshot (web/src/data/, as npm run web:data writes it), the
// model that answers, and a per-session rate limit. Live when NEAR AI Cloud's key (or the
// fallback's) is in .env; otherwise the recorded answers to the suggested questions in
// data/replay/ask-llm.json. Keys stay on the server. Nothing here writes.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AskError, askKevin, type KevinAnswer, SUGGESTED_QUESTIONS } from "@day-one/kevin/ask";
import { buildFactCards, type FactCard, type FactsSnapshot } from "@day-one/kevin/facts";
import { readAttestationFixture, recordedReceipts } from "@day-one/server/attestation/fixture";
import type { AnswerResult } from "@day-one/server/attestation/types";
import { verifyAttestation } from "@day-one/server/attestation/verify";
import { createFallbackLlm, type LlmFixture, ReplayLlm } from "@day-one/server/llm/client";
import type { LlmClient } from "@day-one/server/llm/types";
import { fixtureFiles, REPO_ROOT } from "./env.ts";

export { AskError };

/** The snapshot files the cards are built from, under web/src/data/. */
export const SNAPSHOT_FILES = {
  pages: "pages.json",
  plants: "plants.json",
  journey: "journey.json",
  demoRun: "demo-run.json",
  groupBuy: "group-buy.json",
} as const;

export function readFactsSnapshot(root = REPO_ROOT): FactsSnapshot {
  const read = (name: string) => JSON.parse(readFileSync(join(root, "web/src/data", name), "utf8"));
  return Object.fromEntries(
    Object.entries(SNAPSHOT_FILES).map(([key, name]) => [key, read(name)]),
  ) as FactsSnapshot;
}

export type AskMode = "live" | "recorded" | "off";

export interface AskReply extends KevinAnswer {
  /** Replayed from the recording, not asked now. */
  recorded: boolean;
}

export interface AskDeskOptions {
  cards: FactCard[];
  llm: LlmClient | null;
  mode: AskMode;
  /** Questions per session per minute. */
  perMinute?: number;
  /** Questions per client address per minute, whatever session it claims. */
  perAddress?: number;
  now?: () => number;
}

/** A client asked too often; the API answers 429. */
export class AskLimitError extends Error {
  override name = "AskLimitError";
}

/** No model can answer this here: no key and no recording, or a question the replay lacks. */
export class AskUnavailableError extends Error {
  override name = "AskUnavailableError";
}

export class AskDesk {
  readonly mode: AskMode;
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly options: AskDeskOptions) {
    this.mode = options.llm ? options.mode : "off";
  }

  /**
   * From .env: live when NEARAI_API_KEY or ANTHROPIC_API_KEY is set, else the recording when
   * it exists, else off (the page then shows the suggested questions without answers).
   */
  static fromEnv(root = REPO_ROOT, env: NodeJS.ProcessEnv = process.env): AskDesk {
    const cards = buildFactCards(readFactsSnapshot(root));
    const live = createFallbackLlm(env, (error) =>
      console.error(`Talk to Kevin: NEAR AI Cloud failed, using the fallback model: ${error}`),
    );
    if (live) return new AskDesk({ cards, llm: live, mode: "live" });
    const file = fixtureFiles(root).askLlm;
    if (existsSync(file))
      return new AskDesk({ cards, llm: ReplayLlm.fromFile(file), mode: "recorded" });
    return new AskDesk({ cards, llm: null, mode: "off" });
  }

  info() {
    return { mode: this.mode, suggestions: [...SUGGESTED_QUESTIONS] };
  }

  async ask(question: string, client: { session: string; address: string }): Promise<AskReply> {
    const llm = this.options.llm;
    if (!llm) {
      throw new AskUnavailableError(
        "Kevin answers here once NEARAI_API_KEY is in .env, or after npm run ask -- --live --record.",
      );
    }
    if (!question.trim()) throw new AskError("ask Kevin a question");
    this.limit(`s:${client.address}:${client.session}`, this.options.perMinute ?? 8);
    this.limit(`a:${client.address}`, this.options.perAddress ?? 30);
    try {
      const answer = await askKevin(llm, this.options.cards, question);
      return { ...answer, recorded: this.mode === "recorded" };
    } catch (error) {
      if (this.mode === "recorded" && /no recorded/.test((error as Error).message)) {
        throw new AskUnavailableError(
          "This API replays the recorded answers to the suggested questions; with NEARAI_API_KEY in .env Kevin answers any question live.",
        );
      }
      throw error;
    }
  }

  private limit(key: string, perMinute: number) {
    const now = (this.options.now ?? Date.now)();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= perMinute) {
      throw new AskLimitError(`Kevin takes ${perMinute} questions a minute; try again shortly.`);
    }
    recent.push(now);
    this.hits.set(key, recent);
  }
}

/** One suggested question with its recorded answer and that answer's signature check. */
export interface RecordedQuestion {
  question: string;
  answer: KevinAnswer | null;
  /** The signature checks of the answer's receipt against the recorded attestation. */
  signature: Pick<AnswerResult, "chatId" | "signer" | "checks"> | null;
}

/**
 * The suggested questions answered from a recording, for the static page and npm run ask.
 * Without a recording every answer is null: the page says the answers arrive with it.
 */
export async function recordedQuestions(
  cards: FactCard[],
  fixtureFile: string,
  root = REPO_ROOT,
): Promise<{ recordedAt: string | null; questions: RecordedQuestion[] }> {
  if (!existsSync(fixtureFile)) {
    return {
      recordedAt: null,
      questions: SUGGESTED_QUESTIONS.map((question) => ({
        question,
        answer: null,
        signature: null,
      })),
    };
  }
  const fixture = JSON.parse(readFileSync(fixtureFile, "utf8")) as LlmFixture;
  const attestation = readAttestationFixture(root);
  const verified = attestation
    ? await verifyAttestation(
        attestation,
        recordedReceipts(root, [fixtureFile.slice(root.length + 1).replace(/\\/g, "/")]),
        { online: false },
      )
    : null;
  const llm = new ReplayLlm(fixture);
  const questions: RecordedQuestion[] = [];
  for (const question of SUGGESTED_QUESTIONS) {
    const answer = await askKevin(llm, cards, question).catch(() => null);
    const signed = answer?.model.chatId
      ? verified?.answers.find((a) => a.chatId === answer.model.chatId)
      : undefined;
    questions.push({
      question,
      answer,
      signature: signed
        ? { chatId: signed.chatId, signer: signed.signer, checks: signed.checks }
        : null,
    });
  }
  return { recordedAt: fixture.recordedAt, questions };
}
