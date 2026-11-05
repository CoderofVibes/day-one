import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type AnswerCheck, type DecisionArgs, decisionEvidence } from "./decisionEvidence.ts";

const root = resolve(import.meta.dirname, "../..");
const chain = JSON.parse(readFileSync(join(root, "data/replay/demo-chain.json"), "utf8")) as {
  entries: { request?: { method: string; args: DecisionArgs }; outcome?: { txHash: string } }[];
};
const submits = chain.entries.filter((e) => e.request?.method === "submit_po");
const args = (prefix: string) =>
  submits.find((e) => e.outcome?.txHash.startsWith(prefix))?.request?.args as DecisionArgs;
const run = JSON.parse(readFileSync(join(root, "web/src/data/demo-run.json"), "utf8")) as {
  attestation: { answers: AnswerCheck[] };
};
const answers = run.attestation.answers;

describe("the signed decision on PO-1042", () => {
  it("joins the refused and the funded submission to the same verified answer", () => {
    const refused = decisionEvidence(args("3bYd13vy"), answers);
    const funded = decisionEvidence(args("3TzgR7iY"), answers);
    expect(refused).toMatchObject({
      poId: "PO-1042",
      amount: 5150,
      qtyKg: 700,
      chatId: "7190a65d67044a27ad7f0255403987e8",
      verdict: `APPROVE ${args("3bYd13vy").po_hash}`,
      namesThisPo: true,
      signer: "0x3b753b4406613c5e70ae640508632b600424fa0c",
      verified: true,
      failed: null,
    });
    expect(funded?.responseSha256).toBe(refused?.responseSha256);
    expect(funded?.poHash).toBe(refused?.poHash);
  });

  it("never shows verified when the answer, the response or the PO does not match", () => {
    const good = args("3TzgR7iY");
    // No attested answer for this response: the other reasoning answer of the run is not a match.
    const other = answers.filter((a) => a.chatId !== "7190a65d67044a27ad7f0255403987e8");
    expect(decisionEvidence(good, other)).toMatchObject({
      verified: false,
      failed: "no attested answer for this response",
    });
    expect(decisionEvidence(good, null)?.verified).toBe(false);
    // An answer whose checks did not verify.
    const unverified = answers.map((a) => ({
      ...a,
      checks: a.checks.map((c) => ({ ...c, status: "unverified" })),
    }));
    expect(decisionEvidence(good, unverified)?.failed).toBe("signature check not verified");
    // A response edited after signing.
    const decision = good.decision as NonNullable<DecisionArgs["decision"]>;
    const edited = { ...good, decision: { ...decision, response: `${decision.response} ` } };
    expect(decisionEvidence(edited, answers)?.failed).toBe(
      "response does not match the signed text",
    );
    // A different PO: the signature still verifies, but the verdict does not name it.
    const otherPo = { ...good, po_hash: "0".repeat(64) };
    expect(decisionEvidence(otherPo, answers)?.namesThisPo).toBe(false);
    // A submission without a decision has no card.
    expect(decisionEvidence({ ...good, decision: undefined }, answers)).toBeNull();
  });
});
