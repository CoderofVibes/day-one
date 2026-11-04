import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANSWER_SCHEMA,
  askKevin,
  CANT_TELL,
  formatAnswer,
  SUGGESTED_QUESTIONS,
  ungrounded,
} from "@day-one/kevin/ask";
import { ASK_PAGES, buildFactCards, retrieve } from "@day-one/kevin/facts";
import { FallbackLlm, ReplayLlm } from "@day-one/server/llm/client";
import type { LlmClient } from "@day-one/server/llm/types";
import { describe, expect, it } from "vitest";
import { AskDesk, AskLimitError, readFactsSnapshot, SNAPSHOT_FILES } from "./ask.ts";
import { REPO_ROOT } from "./env.ts";
import { HAND_ANSWERS, type HandReply, handFixture, handResult } from "./test/ask-fixture.ts";

const cards = buildFactCards(readFactsSnapshot());
const ids = new Set(cards.map((c) => c.id));
const recordText = cards.map((c) => `${c.id}\n${c.facts.join("\n")}`).join("\n");
const RECORD_ID = /\b[A-Z]{2,4}(?:-[A-Z]{1,3})*-[A-Z]?\d{2,6}(?:-\d{2,6})*(?:-R)?\b/g;

/** A client that answers each request with the next of the given replies. */
function scripted(replies: HandReply[], provider: "nearai" | "anthropic" = "nearai"): LlmClient {
  let n = 0;
  return {
    complete: async () =>
      handResult(replies[Math.min(n++, replies.length - 1)] as HandReply, n, provider),
  };
}

describe("fact cards", () => {
  it("covers every record type the brief names, from the recorded run", () => {
    const kinds = new Set(cards.map((c) => c.kind));
    for (const kind of [
      "po",
      "rfq",
      "supplier",
      "lot",
      "batch",
      "bill",
      "payment",
      "policy",
      "attack",
      "reconciliation",
      "stock",
    ]) {
      expect(kinds).toContain(kind);
    }
    for (const id of [
      "PO-1042",
      "PO-G-2001",
      "RFQ-2611-01",
      "RFQ-2611-02",
      "ASC-261116-01",
      "BR-B-1045",
      "NG-INV-24190",
      "VP-35",
      "Northgate Ingredients",
      "QuickChem Direct",
      "Pacific Excipient Co.",
      "Attack suite",
      "Reconciliation",
      "Below reorder point",
      "Spending limits",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ids.size).toBe(cards.length);
    for (const c of cards) expect(ASK_PAGES).toContain(c.page);
  });

  it("keeps the proof points as the records hold them", () => {
    const po = cards.find((c) => c.id === "PO-1042")?.facts.join(" ") ?? "";
    expect(po).toContain("$5,150.00");
    expect(po).toContain("per-PO limit of $2,500.00");
    expect(po).toContain("Linda Park, approved");
    expect(po).toContain("lot ASC-261116-01");
    expect(cards.find((c) => c.id === "PO-G-2001")?.facts.join(" ")).toContain("$9,490.00");
    expect(cards.find((c) => c.id === "Attack suite")?.facts[0]).toBe(
      "21 attempted abuses were tried; 21 were refused.",
    );
    expect(cards.find((c) => c.id === "Reconciliation")?.facts[0]).toMatch(/^7 of 7 checks agree/);
  });

  it("shows no transaction hashes", () => {
    expect(recordText).not.toMatch(/\btx [1-9A-HJ-NP-Za-km-z]{6,}/);
  });

  it("retrieves by id first, then one hop out, then by type and words, within the limit", () => {
    const refused = retrieve(cards, "Why was PO-1042 refused?");
    expect(refused.cards[0]?.id).toBe("PO-1042");
    expect(refused.cards.map((c) => c.id)).toEqual(
      expect.arrayContaining(["ASC-261116-01", "NG-INV-24190", "RFQ-2611-01", "Spending limits"]),
    );
    const why = retrieve(cards, "Why did you order from Northgate instead of QuickChem?").cards;
    expect(why.slice(0, 3).map((c) => c.id)).toContain("RFQ-2611-01");
    expect(why.map((c) => c.id)).toEqual(
      expect.arrayContaining(["Northgate Ingredients", "QuickChem Direct"]),
    );
    expect(retrieve(cards, "What's below reorder point today?").cards[0]?.id).toBe(
      "Below reorder point",
    );
    expect(retrieve(cards, "What did the attack suite try?").cards[0]?.id).toBe("Attack suite");
    expect(retrieve(cards, "Why is Pacific Excipient suspended?").cards[0]?.id).toBe(
      "Pacific Excipient Co.",
    );
    for (const q of SUGGESTED_QUESTIONS)
      expect(retrieve(cards, q).cards.length).toBeLessThanOrEqual(10);
    expect(retrieve(cards, "hello").cards).toEqual([]);
  });
});

describe("Talk to Kevin over the hand-written recording", () => {
  const llm = new ReplayLlm(handFixture(cards));

  it.each(HAND_ANSWERS.map((h) => [h.question, h]))("%s", async (_q, hand) => {
    const a = await askKevin(llm, cards, hand.question);
    expect(a.rejected).toEqual([]);
    expect(a.answer).toBe(hand.reply.answer);
    expect(a.answered).toBe(hand.reply.answered);
    // Every cited record exists in the records, and every record id the answer names does too.
    for (const c of a.citations) expect(ids).toContain(c.id);
    for (const id of a.answer.match(RECORD_ID) ?? []) expect(recordText).toContain(id);
    expect(a.citations.length > 0).toBe(hand.reply.answered);
    expect(a.model).toMatchObject({ provider: "nearai", attested: true });
    if (hand.reply.page) expect(a.proposal?.page).toBe(hand.reply.page);
  });

  it("asks the six suggested questions of the page", () => {
    for (const q of SUGGESTED_QUESTIONS) expect(HAND_ANSWERS.map((h) => h.question)).toContain(q);
  });
});

describe("the guard", () => {
  const picked = retrieve(cards, "Why was PO-1042 refused?").cards;
  const good = HAND_ANSWERS[1]?.reply as HandReply;

  it("catches an invented record id and an invented amount", () => {
    expect(ungrounded(good, picked)).toEqual([]);
    expect(ungrounded({ ...good, answer: `${good.answer} See PO-1099.` }, picked)).toEqual([
      "PO-1099",
    ]);
    expect(ungrounded({ ...good, cited: ["RFQ-2699-01"] }, picked)).toEqual(["RFQ-2699-01"]);
    expect(ungrounded({ ...good, answer: "It cost $5,200.00." }, picked)).toEqual(["$5,200.00"]);
    // The same amount written another way is the same amount.
    expect(ungrounded({ ...good, answer: "It cost $5,150." }, picked)).toEqual([]);
  });

  it("asks again once, and shows the grounded second answer", async () => {
    const invented = { ...good, answer: "PO-1042 was refused because of RFQ-2611-09." };
    const a = await askKevin(scripted([invented, good]), cards, "Why was PO-1042 refused?");
    expect(a.answer).toBe(good.answer);
    expect(a.rejected).toEqual([["RFQ-2611-09"]]);
  });

  it("takes an id cited in brackets, as the prompt shows ids, as that id", async () => {
    const bracketed = { ...good, cited: good.cited.map((id) => `[${id}]`) };
    const a = await askKevin(scripted([bracketed]), cards, "Why was PO-1042 refused?");
    expect(a.rejected).toEqual([]);
    expect(a.citations.map((c) => c.id)).toEqual(expect.arrayContaining(good.cited));
  });

  it("says it can't tell when the second answer is no better", async () => {
    const invented = { ...good, answer: "PO-1042 cost $6,000.00." };
    const a = await askKevin(scripted([invented, invented]), cards, "Why was PO-1042 refused?");
    expect(a).toMatchObject({ answer: CANT_TELL, answered: false, citations: [], proposal: null });
    expect(a.rejected).toEqual([["$6,000.00"], ["$6,000.00"]]);
  });

  it("asks for JSON with a page Kevin may point to, never a tool to call", () => {
    expect(ANSWER_SCHEMA.schema.properties.page.enum).toEqual(["", ...ASK_PAGES]);
    expect(Object.keys(ANSWER_SCHEMA.schema.properties)).toEqual([
      "answer",
      "answered",
      "cited",
      "proposal",
      "page",
    ]);
  });
});

describe("the model label", () => {
  const good = HAND_ANSWERS[1]?.reply as HandReply;
  const down: LlmClient = {
    complete: async () => {
      throw new Error("NEAR AI Cloud: 503");
    },
  };

  it("labels an answer from the fallback model as not attested", async () => {
    const fallbacks: unknown[] = [];
    const llm = new FallbackLlm(down, scripted([good], "anthropic"), (e) => fallbacks.push(e));
    const a = await askKevin(llm, cards, "Why was PO-1042 refused?");
    expect(a.model).toEqual({
      provider: "anthropic",
      model: "test-fallback-model",
      attested: false,
      chatId: null,
    });
    expect(formatAnswer(a)).toContain("Fallback model · not attested");
    expect(fallbacks).toHaveLength(1);
  });

  it("labels a signed NEAR AI answer as signed in the enclave", async () => {
    const a = await askKevin(
      new FallbackLlm(scripted([good]), down),
      cards,
      "Why was PO-1042 refused?",
    );
    expect(a.model.attested).toBe(true);
    expect(formatAnswer(a)).toContain("Signed in enclave ✓");
  });

  it("fails when NEAR AI Cloud fails and there is no fallback", async () => {
    await expect(
      askKevin(new FallbackLlm(down, null), cards, "Why was PO-1042 refused?"),
    ).rejects.toThrow("503");
  });
});

describe("no state change", () => {
  it("reads the records and writes nothing", async () => {
    const before = Object.values(SNAPSHOT_FILES).map((f) =>
      readFileSync(join(REPO_ROOT, "web/src/data", f), "utf8"),
    );
    const frozen = structuredClone(cards);
    const freeze = (v: unknown): unknown => {
      if (v && typeof v === "object") for (const x of Object.values(v)) freeze(x);
      return Object.freeze(v);
    };
    freeze(frozen);
    const desk = new AskDesk({
      cards: frozen,
      llm: new ReplayLlm(handFixture(cards)),
      mode: "recorded",
      perMinute: 100,
    });
    for (const h of HAND_ANSWERS) await desk.ask(h.question, { session: "t", address: "local" });
    expect(frozen).toEqual(cards);
    const after = Object.values(SNAPSHOT_FILES).map((f) =>
      readFileSync(join(REPO_ROOT, "web/src/data", f), "utf8"),
    );
    expect(after).toEqual(before);
  });

  it("has no path to the ledger, the chain, the relayer or a file write", () => {
    for (const file of ["agents/kevin/src/ask.ts", "agents/kevin/src/facts.ts", "api/src/ask.ts"]) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) {
        expect(i).not.toMatch(/ledger|chain|relayer|submit|approval|payments|demo|session/);
      }
      expect(source).not.toMatch(
        /writeFile|appendFile|mkdirSync|rmSync|\.insert\(|\.update\(|\.delete\(/,
      );
    }
  });
});

describe("the desk", () => {
  it("limits questions per session and per address", async () => {
    let now = 0;
    const desk = new AskDesk({
      cards,
      llm: new ReplayLlm(handFixture(cards)),
      mode: "recorded",
      perMinute: 2,
      perAddress: 3,
      now: () => now,
    });
    const q = "Why was PO-1042 refused?";
    await desk.ask(q, { session: "a", address: "x" });
    await desk.ask(q, { session: "a", address: "x" });
    await expect(desk.ask(q, { session: "a", address: "x" })).rejects.toBeInstanceOf(AskLimitError);
    await desk.ask(q, { session: "b", address: "x" });
    await expect(desk.ask(q, { session: "c", address: "x" })).rejects.toBeInstanceOf(AskLimitError);
    now = 61_000;
    await expect(desk.ask(q, { session: "a", address: "x" })).resolves.toMatchObject({
      recorded: true,
    });
  });

  it("is off with no key and no recording, and says how to turn it on", async () => {
    const desk = new AskDesk({ cards, llm: null, mode: "live" });
    expect(desk.info().mode).toBe("off");
    await expect(
      desk.ask("Why was PO-1042 refused?", { session: "a", address: "x" }),
    ).rejects.toThrow("npm run ask -- --live --record");
  });

  it("says when a question was not recorded", async () => {
    const desk = new AskDesk({ cards, llm: new ReplayLlm(handFixture(cards)), mode: "recorded" });
    await expect(desk.ask("Who is Kevin?", { session: "a", address: "x" })).rejects.toThrow(
      "NEARAI_API_KEY",
    );
  });
});
