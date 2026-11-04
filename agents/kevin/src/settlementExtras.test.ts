import { openLedger } from "@day-one/server/ledger/db";
import type { LlmClient, LlmResult } from "@day-one/server/llm/types";
import { seedLedger } from "@day-one/server/seed";
import { DEMO_QUOTES } from "@day-one/server/seed/quotes";
import { describe, expect, it } from "vitest";
import { forecastMaterial } from "./forecast.ts";
import { draftPo, draftPoFromRanking, rankQuotes, requestQuotes } from "./purchasing.ts";
import { contractExtras } from "./settlementExtras.ts";
import { confirmBr1045 } from "./test/br-b-1045.ts";

const NOW = "2026-11-09T13:00:00.000Z";
const USD = 1_000_000;

function plant() {
  const db = openLedger();
  seedLedger(db);
  confirmBr1045(db);
  const forecast = forecastMaterial(db, { facility: "B", material: "ASC", now: NOW });
  const rfq = requestQuotes(db, forecast, "RFQ-2611-01", DEMO_QUOTES.ASC ?? []);
  const po1042 = draftPoFromRanking(db, rankQuotes(db, rfq, NOW), "PO-1042", "5a17".repeat(8));
  const facilityId = rfq.facilityId;
  const po1041 = draftPo(db, {
    poNo: "PO-1041",
    vendor: "BLS",
    facilityId,
    lines: [
      { material: "ACN", qtyBase: 4, unitPriceUsdc: 128 * USD },
      { material: "BUF", qtyBase: 4, unitPriceUsdc: 25 * USD },
    ],
    needBy: null,
    salt: "b0b0".repeat(8),
  });
  return { db, po1041, po1042 };
}

function approvingModel() {
  const prompts: string[] = [];
  const llm = {
    async complete(_task: string, request: { prompt: string }): Promise<LlmResult> {
      prompts.push(request.prompt);
      const hash = /po_hash: (\w+)/.exec(request.prompt)?.[1] ?? "";
      return {
        provider: "anthropic",
        model: "test",
        text: `APPROVE ${hash}`,
        usage: { inputTokens: 1, outputTokens: 1 },
      } as LlmResult;
    },
  } as unknown as LlmClient;
  return { llm, prompts };
}

describe("the per-PO arguments for a contract with §11", () => {
  it("adds nothing while the contract lacks the features", async () => {
    const { db, po1042 } = plant();
    const extras = contractExtras(db, { features: {} });
    expect(await extras?.(po1042)).toEqual({});
  });

  it("sends the ordered quantity for a one-line PO only", async () => {
    const { db, po1041, po1042 } = plant();
    const extras = contractExtras(db, { features: { receiptSettlement: true } });
    expect(await extras?.(po1042)).toEqual({ qtyBase: 700_000_000 });
    expect(await extras?.(po1041)).toEqual({});
  });

  it("asks the model once per PO above the threshold, with the plan and the quotes", async () => {
    const { db, po1041, po1042 } = plant();
    const { llm, prompts } = approvingModel();
    const seen: string[] = [];
    const extras = contractExtras(db, {
      features: { signedDecisions: true },
      llm,
      signatures: null,
      signedAboveUsdc: 2_500 * USD,
      onDecision: (po, d) => seen.push(`${po.poNo} ${d.approved}`),
    });
    await extras?.(po1042);
    await extras?.(po1042); // the approval retry
    await extras?.(po1041); // under the threshold
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Supplier: Northgate Ingredients");
    expect(prompts[0]).toContain("Quotes: ");
    expect(prompts[0]).toContain("Ridgeway Ascorbics");
    expect(seen).toEqual(["PO-1042 true"]);
  });
});
