// The signed decision a recorded submit_po carried, joined to the attestation's answer for it, for
// the curtain's decision card (docs/astra/2026-11-04_Complexity.md §G). Everything here comes from
// the recording: the call's own arguments and the offline attestation check over the run's
// answers. The join is by the response's chat id and its SHA-256, never "the first reasoning
// answer"; a missing or mismatched link leaves `verified` false, and nothing is inferred from the
// transaction having succeeded.

import { createHash } from "node:crypto";

export interface DecisionArgs {
  po_id: string;
  supplier: string;
  amount: string;
  po_hash: string;
  qty?: string;
  decision?: { text: string; signature: string; response: string };
}

export interface AnswerCheck {
  chatId: string;
  requestSha256: string;
  responseSha256: string;
  signer: string | null;
  checks: { name: string; status: string }[];
}

export interface DecisionEvidence {
  poId: string;
  supplier: string;
  /** Dollars, from the PO's amount in 6-decimal token units. */
  amount: number;
  /** Kilograms, from the PO's quantity in milligrams; null when the call carried none. */
  qtyKg: number | null;
  poHash: string;
  /** The model's verdict line as signed, e.g. "APPROVE 74e7…". */
  verdict: string;
  /** The verdict approves and names this PO's hash, with no HOLD line. */
  namesThisPo: boolean;
  model: string;
  chatId: string;
  requestSha256: string;
  responseSha256: string;
  signer: string | null;
  signature: string;
  /** The response's hash matches the signed text and the attestation verified that answer. */
  verified: boolean;
  /** Why `verified` is false, in a few words; null when it is true. */
  failed: string | null;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** The decision a submit_po carried, with its evidence, or null when it carried none. */
export function decisionEvidence(
  args: DecisionArgs,
  answers: AnswerCheck[] | null | undefined,
): DecisionEvidence | null {
  const d = args.decision;
  if (!d) return null;
  const [model = "", requestSha256 = "", responseSha256 = ""] = d.text.split(":");
  let chatId = "";
  let content = "";
  try {
    const r = JSON.parse(d.response) as {
      id?: string;
      choices?: { message?: { content?: string } }[];
    };
    chatId = r.id ?? "";
    content = r.choices?.[0]?.message?.content ?? "";
  } catch {
    // An unreadable response leaves the verdict empty and the evidence unverified.
  }
  const lines = (content.split("</think>").at(-1) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const verdict = lines.find((l) => /^(APPROVE|HOLD)/.test(l)) ?? "";
  const namesThisPo =
    verdict === `APPROVE ${args.po_hash}` && !lines.some((l) => l.startsWith("HOLD"));

  const answer = answers?.find((a) => a.chatId === chatId && a.responseSha256 === responseSha256);
  const failed =
    sha256(d.response) !== responseSha256
      ? "response does not match the signed text"
      : !answer
        ? "no attested answer for this response"
        : answer.checks.length === 0 || answer.checks.some((c) => c.status !== "verified")
          ? "signature check not verified"
          : answer.requestSha256 !== requestSha256
            ? "request does not match the signed text"
            : null;

  return {
    poId: args.po_id,
    supplier: args.supplier,
    amount: Number(args.amount) / 1e6,
    qtyKg: args.qty ? Number(args.qty) / 1e6 : null,
    poHash: args.po_hash,
    verdict,
    namesThisPo,
    model,
    chatId,
    requestSha256,
    responseSha256,
    signer: answer?.signer ?? null,
    signature: d.signature,
    verified: failed === null,
    failed,
  };
}
