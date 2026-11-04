import { sha256Hex } from "@day-one/server/canonical";
import type { LlmClient, LlmRequest, LlmResult } from "@day-one/server/llm/types";
import { describe, expect, it } from "vitest";
import { type DecisionFacts, decideOnPo, recordedSignatures } from "./decision.ts";

const facts: DecisionFacts = {
  poNo: "PO-1042",
  poHash: "4f1989c3".padEnd(64, "0"),
  supplier: "Northgate Ingredients",
  what: "700 kg ascorbic acid",
  price: "$5,150.00 ($7.10/kg plus $180.00 freight)",
  plan: "the plan can use 1,014 kg more",
  quotes: "3 quotes; Northgate selected",
};

/** A model that answers `line` and keeps the raw body when asked. */
function model(line: string, provider: "nearai" | "anthropic" = "nearai") {
  const asked: LlmRequest[] = [];
  const llm: LlmClient = {
    async complete(_task, request): Promise<LlmResult> {
      asked.push(request);
      const raw = JSON.stringify({ id: "chat-1", choices: [{ message: { content: line } }] });
      return {
        provider,
        model: "z-ai/glm-5.3-flash",
        text: line,
        usage: { inputTokens: 1, outputTokens: 1 },
        ...(provider === "nearai" && {
          receipt: {
            chatId: "chat-1",
            requestSha256: "a".repeat(64),
            responseSha256: sha256Hex(raw),
            ...(request.keepRaw && { rawResponse: raw }),
          },
        }),
      } as LlmResult;
    },
  } as LlmClient;
  return { llm, asked };
}

const signedFor = (raw: string) =>
  recordedSignatures({
    signatures: {
      "chat-1": {
        text: `z-ai/glm-5.3-flash:${"a".repeat(64)}:${sha256Hex(raw)}`,
        signature: "0xsig",
        signing_address: "0x3b753b4406613c5e70ae640508632b600424fa0c",
      },
    },
  });

describe("Kevin's enclave-signed decision on a PO", () => {
  it("asks for one line about this exact PO and keeps the raw answer", async () => {
    const line = `APPROVE ${facts.poHash}`;
    const { llm, asked } = model(line);
    const raw = JSON.stringify({ id: "chat-1", choices: [{ message: { content: line } }] });
    const d = await decideOnPo(llm, signedFor(raw), facts);
    expect(asked[0]?.keepRaw).toBe(true);
    expect(asked[0]?.prompt).toContain(`po_hash: ${facts.poHash}`);
    expect(d.approved).toBe(true);
    expect(d.signer).toBe("0x3b753b4406613c5e70ae640508632b600424fa0c");
    expect(d.signed?.response).toBe(raw);
    expect(d.signed?.text.endsWith(sha256Hex(raw))).toBe(true);
  });

  it("is not an approval when the model holds or names another PO", async () => {
    const held = await decideOnPo(model("HOLD: the plan does not need it").llm, null, facts);
    expect(held).toMatchObject({ approved: false, line: "HOLD: the plan does not need it" });
    const thinking = await decideOnPo(
      model(`Let me check the PO.
APPROVE ${facts.poHash}`).llm,
      null,
      facts,
    );
    expect(thinking.approved).toBe(true);
    const tagged = await decideOnPo(
      model(`Answer: APPROVE ${facts.poHash}</think>APPROVE ${facts.poHash}`).llm,
      null,
      facts,
    );
    expect(tagged).toMatchObject({ approved: true, line: `APPROVE ${facts.poHash}` });
    const wavering = await decideOnPo(
      model(`HOLD: price looks high
APPROVE ${facts.poHash}`).llm,
      null,
      facts,
    );
    expect(wavering.approved).toBe(false);
    const other = await decideOnPo(model(`APPROVE ${"0".repeat(64)}`).llm, null, facts);
    expect(other.approved).toBe(false);
  });

  it("refuses a signature over a different response than the one kept", async () => {
    const { llm } = model(`APPROVE ${facts.poHash}`);
    await expect(decideOnPo(llm, signedFor("something else"), facts)).rejects.toThrow(
      "the enclave signed a different response",
    );
  });

  it("carries no signed decision from a provider without an enclave", async () => {
    const d = await decideOnPo(model(`APPROVE ${facts.poHash}`, "anthropic").llm, null, facts);
    expect(d.signed).toBeNull();
  });
});
