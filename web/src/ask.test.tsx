import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type KevinAnswer, type RecordedAsk, withCitations } from "./ask.ts";
import askJson from "./data/ask.json";
import { AnswerCard, AskKevin, type Turn } from "./pages/Ask.tsx";
import { NAV } from "./shell.tsx";

const recorded = askJson as unknown as RecordedAsk;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

const answer: KevinAnswer = {
  question: "Why was PO-1042 refused?",
  answer: "PO-1042 was over the $2,500 per-PO limit (Spending limits).",
  answered: true,
  citations: [
    { id: "PO-1042", kind: "po", title: "PO-1042 · Northgate Ingredients", page: "purchasing" },
    { id: "Spending limits", kind: "policy", title: "Kevin's spending limits", page: "hq" },
  ],
  proposal: { text: "Linda can raise the limit.", page: "hq" },
  model: { provider: "nearai", model: "z-ai/glm-5.3-flash", attested: true, chatId: "c1" },
  cards: ["PO-1042", "Spending limits"],
  rejected: [],
};
const turn = (a: KevinAnswer, recordedAnswer = false): Turn => ({
  key: 1,
  question: a.question,
  answer: a,
  note: null,
  signature: null,
  recorded: recordedAnswer,
  pending: false,
});

describe("Talk to Kevin", () => {
  it("sits in the Proof group below the attack arena", () => {
    const proof = NAV.find((g) => g.group === "Proof")?.items.map((i) => i.id);
    expect(proof).toEqual(["arena", "ask"]);
  });

  it("links each cited record to the page that shows it, and the proposal to where a person acts", () => {
    const html = renderToStaticMarkup(
      <AnswerCard turn={turn(answer)} enclave={recorded.enclave} />,
    );
    expect(html).toContain('href="?page=purchasing"');
    expect(html).toContain('href="?page=hq"');
    expect(text(html)).toContain("Open Spending limits →");
    expect(text(html)).toContain("Signed in enclave ✓");
    expect(text(html)).not.toContain("recorded answer");
  });

  it("labels the fallback model in neutral gray, and a replayed answer as recorded", () => {
    const fallback = {
      ...answer,
      model: { provider: "anthropic", model: "claude-sonnet-5-5", attested: false, chatId: null },
    };
    const html = renderToStaticMarkup(<AnswerCard turn={turn(fallback, true)} enclave={null} />);
    expect(text(html)).toContain("Fallback model · not attested");
    expect(html).toContain('class="ask-badge fallback"');
    expect(text(html)).not.toContain("Signed in enclave");
    expect(text(html)).toContain("recorded answer");
  });

  it("splits an answer into text and citations, longest id first", () => {
    const parts = withCitations("See PO-1042 and PO-10425.", [
      { id: "PO-1042", kind: "po", title: "", page: "purchasing" },
    ]);
    expect(parts.map((p) => [p.text, p.cite?.id ?? null])).toEqual([
      ["See ", null],
      ["PO-1042", "PO-1042"],
      [" and ", null],
      ["PO-1042", "PO-1042"],
      ["5.", null],
    ]);
  });

  it("offers the suggested questions; before the recording, says the answers arrive with it", () => {
    const html = text(renderToStaticMarkup(<AskKevin recorded={recorded} live={false} />));
    for (const q of recorded.questions) expect(html).toContain(q.question);
    if (!recorded.recordedAt) {
      expect(html).toContain("Recorded answers arrive with the next recording.");
      for (const q of recorded.questions) expect(q.answer).toBeNull();
    }
  });
});
