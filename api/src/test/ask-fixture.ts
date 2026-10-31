// A recording written by hand, for the tests only: ten questions with the answers a grounded
// model would give over the cards each one retrieves. It is built in memory and never written
// to data/replay/ask-llm.json; the real recording comes from npm run ask -- --live --record.
// The receipts are placeholders marked "test": no enclave signed them.

import { askRequest } from "@day-one/kevin/ask";
import { type FactCard, retrieve } from "@day-one/kevin/facts";
import {
  LLM_FIXTURE_VERSION,
  type LlmFixture,
  type LlmFixtureEntry,
  requestKey,
} from "@day-one/server/llm/client";
import type { LlmResult } from "@day-one/server/llm/types";

export interface HandReply {
  answer: string;
  answered: boolean;
  cited: string[];
  proposal: string;
  page: string;
}

export const HAND_ANSWERS: { question: string; reply: HandReply }[] = [
  {
    question: "Why did you order from Northgate instead of QuickChem?",
    reply: {
      answer:
        "On RFQ-2611-01 QuickChem Direct quoted $5.90/kg but was excluded: it is not a qualified supplier. Of the qualified quotes, Northgate Ingredients had the lowest landed cost, $5,150.00 against Ridgeway Ascorbics' $5,310.00, so I accepted it on PO-1042.",
      answered: true,
      cited: ["RFQ-2611-01", "PO-1042"],
      proposal: "",
      page: "",
    },
  },
  {
    question: "Why was PO-1042 refused?",
    reply: {
      answer:
        "PO-1042 came to $5,150.00, over my $2,500 per-PO limit, so the spending policy refused it when I first submitted it. Linda Park approved it by text, and it was paid after QC released lot ASC-261116-01.",
      answered: true,
      cited: ["PO-1042", "Spending limits"],
      proposal: "",
      page: "",
    },
  },
  {
    question: "Where did lot ASC-261116-01 go?",
    reply: {
      answer:
        "ASC-261116-01 is 700 kg of ascorbic acid from Northgate Ingredients that came in on PO-1042. Priya Natarajan released it on Nov 16, 2026, and all 700 kg is on hand in raw-material storage at Hollow Pine Tablet Co.",
      answered: true,
      cited: ["ASC-261116-01", "PO-1042"],
      proposal: "",
      page: "",
    },
  },
  {
    question: "What's below reorder point today?",
    reply: {
      answer:
        "Six balances are below the reorder point: ascorbic acid, calcium carbonate and Label, CMD at Acme Riverside, and acetonitrile, the 150 cc HDPE bottle and the 38 mm cap at Hollow Pine Tablet Co.",
      answered: true,
      cited: ["Below reorder point"],
      proposal: "Check each one's forecast and draft the orders that are needed.",
      page: "inventory",
    },
  },
  {
    question: "Why is Pacific Excipient suspended?",
    reply: {
      answer:
        "Pacific Excipient Co.'s supplier credential is suspended after two QC rejects in a row, the last on PO-T9312, so the escrow cannot pay it. Its four POs on record, PO-1040, PO-1035, PO-1031 and PO-1017, were all released by QC.",
      answered: true,
      cited: ["Pacific Excipient Co."],
      proposal: "HQ can review the supplier's standing before its next order.",
      page: "suppliers",
    },
  },
  {
    question: "What did the attack suite try?",
    reply: {
      answer:
        "The attack suite tried 15 abuses, from a lookalike vendor and an inflated invoice to a split purchase under the per-PO limit, three sealed-bid tricks and new bank details by email. All 15 were refused.",
      answered: true,
      cited: ["Attack suite", "Lookalike vendor"],
      proposal: "Fire any of them yourself in the attack arena.",
      page: "arena",
    },
  },
  {
    question: "What did BR-B-1045 yield?",
    reply: {
      answer:
        "BR-B-1045 made 726,400 units of Hollow Pine Vitamin C 500 mg Chewable out of 800,000 theoretical: a 90.8% yield against 90.0% expected, with 92 kg waste. Ray Delgado confirmed it.",
      answered: true,
      cited: ["BR-B-1045"],
      proposal: "",
      page: "",
    },
  },
  {
    question: "How was PO-1042 paid?",
    reply: {
      answer:
        "Bill NG-INV-24190 for PO-1042, $5,150.00, matched the order and was paid in full by VP-35, released from the PO escrow when QC released the lot.",
      answered: true,
      cited: ["PO-1042", "NG-INV-24190"],
      proposal: "",
      page: "",
    },
  },
  {
    question: "What did the group purchase cost?",
    reply: {
      answer:
        "PO-G-2001 pooled 1,400 kg of ascorbic acid from Northgate Ingredients for $9,490.00: Hollow Pine Tablet Co. and Acme Riverside each took 700 kg for $4,745.00, which saved $810.00.",
      answered: true,
      cited: ["PO-G-2001"],
      proposal: "",
      page: "",
    },
  },
  {
    question: "What's the weather at Acme Lakeview?",
    reply: {
      answer:
        "I can't tell from the records. They hold the plants' orders, stock, suppliers and batches, not the weather.",
      answered: false,
      cited: [],
      proposal: "",
      page: "",
    },
  },
];

export function handResult(
  reply: HandReply,
  n: number,
  provider: "nearai" | "anthropic" = "nearai",
): LlmResult {
  const text = JSON.stringify(reply);
  return {
    provider,
    model: provider === "nearai" ? "test/attested-model" : "test-fallback-model",
    text,
    json: reply,
    usage: { inputTokens: 0, outputTokens: 0 },
    ...(provider === "nearai"
      ? { receipt: { chatId: `test-${n}`, requestSha256: "test", responseSha256: "test" } }
      : {}),
  };
}

/** The hand-written answers as an LLM fixture, keyed by each question's real request. */
export function handFixture(cards: readonly FactCard[], answers = HAND_ANSWERS): LlmFixture {
  const entries: LlmFixtureEntry[] = answers.map(({ question, reply }, i) => {
    const request = askRequest(question, retrieve(cards, question).cards);
    return {
      key: requestKey("reasoning", request),
      task: "reasoning",
      promptStart: request.prompt.slice(0, 80),
      result: handResult(reply, i + 1),
    };
  });
  return { version: LLM_FIXTURE_VERSION, recordedAt: "2026-10-31T00:00:00.000Z", entries };
}
