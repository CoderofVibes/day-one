// Kevin's decision on a PO, signed inside NEAR AI Cloud's TEE (CONTRACTS.md §11 F). Before
// Kevin submits a PO above HQ's threshold, he gives the attested model the PO's facts and asks
// for one line: "APPROVE <po_hash>" or "HOLD: <reason>". The enclave signs
// `<model>:<sha256 request>:<sha256 response>`; Kevin sends the signed text, the signature and
// the response exactly as signed with the PO, and the contract checks all three (src/attest.rs).
// The decision is one more enforced layer: the limits, the director and the credential still
// apply.

import { canonicalJson, sha256Hex } from "@day-one/server/canonical";
import type { LlmClient } from "@day-one/server/llm/types";

export interface DecisionFacts {
  poNo: string;
  poHash: string;
  supplier: string;
  /** "700 kg ascorbic acid". */
  what: string;
  /** "$5,150.00 ($7.10/kg plus $180.00 freight)". */
  price: string;
  /** Kevin's plan check, in his words. */
  plan: string;
  /** Kevin's quote ranking, in his words. */
  quotes: string;
}

/** The enclave's signature over one answer, as GET /v1/signature/<chat id> returns it. */
export interface AnswerSignature {
  text: string;
  signature: string;
  signing_address: string;
}

/** Where signatures come from: NEAR AI Cloud live, the recorded attestation in replay. */
export type SignatureSource = (chatId: string) => Promise<AnswerSignature>;

export interface SignedDecision {
  text: string;
  signature: string;
  response: string;
}

export interface Decision {
  approved: boolean;
  /** The model's line: "APPROVE <po_hash>" or "HOLD: …". */
  line: string;
  chatId: string | null;
  signer: string | null;
  /** What the contract checks; null when the answer carries no signature (another provider). */
  signed: SignedDecision | null;
}

export const DECISION_SYSTEM = [
  "You check a purchase order that Kevin, a plant's purchasing agent, prepared.",
  "Answer with exactly one line and nothing else.",
  "If the order fits the production plan and the quotes, answer: APPROVE <po_hash>, with the PO's hash copied exactly.",
  "Otherwise answer: HOLD: <one sentence saying why>.",
].join(" ");

export function decisionPrompt(f: DecisionFacts): string {
  return [
    `PO: ${f.poNo}`,
    `po_hash: ${f.poHash}`,
    `Supplier: ${f.supplier}`,
    `Order: ${f.what}`,
    `Price: ${f.price}`,
    `Plan: ${f.plan}`,
    `Quotes: ${f.quotes}`,
  ].join("\n");
}

/** Asks the attested model for its decision and pairs the answer with the enclave's signature. */
export async function decideOnPo(
  llm: LlmClient,
  signatures: SignatureSource | null,
  facts: DecisionFacts,
): Promise<Decision> {
  const result = await llm.complete("reasoning", {
    system: DECISION_SYSTEM,
    prompt: decisionPrompt(facts),
    // GLM reasons before it answers; the answer itself is one line.
    maxTokens: 8000,
    keepRaw: true,
  });
  // The verdict is the last line after any reasoning: the model thinks aloud first, sometimes
  // ending it with "</think>" on the verdict's own line (Nov 3). Any HOLD wins.
  const verdictText = result.text.split("</think>").at(-1) ?? result.text;
  const lines = verdictText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const line = lines.at(-1) ?? "";
  const approved = line === `APPROVE ${facts.poHash}` && !lines.some((l) => l.startsWith("HOLD"));
  const receipt = result.receipt;
  if (!receipt?.rawResponse || !signatures) {
    return { approved, line, chatId: receipt?.chatId ?? null, signer: null, signed: null };
  }
  const sig = await signatures(receipt.chatId);
  // The signed text must name the response Kevin holds, or the contract would refuse it.
  if (!sig.text.endsWith(`:${sha256Hex(receipt.rawResponse)}`)) {
    throw new Error(`${facts.poNo}: the enclave signed a different response than the one kept`);
  }
  return {
    approved,
    line,
    chatId: receipt.chatId,
    signer: sig.signing_address,
    signed: { text: sig.text, signature: sig.signature, response: receipt.rawResponse },
  };
}

/** The recorded signatures (data/replay/attestation.json), for replays with no keys. */
export function recordedSignatures(attestation: {
  signatures: Record<string, AnswerSignature>;
}): SignatureSource {
  return async (chatId) => {
    const sig = attestation.signatures[chatId];
    if (!sig) throw new Error(`no recorded signature for answer ${chatId}; run npm run attest`);
    return sig;
  };
}

/** A fingerprint of the facts, so a recorded decision is reused only for the same PO. */
export const factsKey = (f: DecisionFacts) => sha256Hex(canonicalJson(f));
