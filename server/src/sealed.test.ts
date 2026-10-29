import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./canonical.ts";
import { parseSealedQuote, quoteFingerprint, sealedQuoteText } from "./quotes.ts";
import { checkSealedRound, type SealedRoundProof, type SealedRoundView } from "./sealed.ts";

const proof = JSON.parse(
  readFileSync(new URL("../../data/sealed/RFQ-2611-02.round.json", import.meta.url), "utf8"),
) as SealedRoundProof;
const copy = (): SealedRoundView => structuredClone(proof.round);
const NG = "northgate-ingredients.testnet";
const RW = "ridgeway-ascorbics.testnet";
const bid = (round: SealedRoundView, supplier: string) => {
  const b = round.bids.find((x) => x.supplier === supplier);
  if (!b) throw new Error(supplier);
  return b;
};

describe("sealed quote text", () => {
  it("hashes to the same fingerprint as an anchored quote", () => {
    const parsed = parseSealedQuote(bid(proof.round, NG).quote ?? "");
    if (!parsed) throw new Error("unparsed");
    const text = sealedQuoteText(parsed.terms, parsed.salt);
    expect(sha256Hex(text)).toBe(quoteFingerprint(parsed.terms, parsed.salt));
    expect(sha256Hex(text)).toBe(bid(proof.round, NG).hash);
  });

  it("is not parsed from text that is not a quote", () => {
    expect(parseSealedQuote("not json")).toBeNull();
    expect(parseSealedQuote('{"record":{}}')).toBeNull();
  });
});

describe("checkSealedRound", () => {
  it("passes the recorded round", () => {
    const check = checkSealedRound(proof.round);
    expect(check.result).toBe("VALID");
    expect(check.winner).toBe(NG);
    expect(check.bids.map((b) => b.terms?.unitPriceUsdc)).toEqual([7_100_000, 7_350_000]);
  });

  it("fails when an opened price is edited after the fact", () => {
    const round = copy();
    const b = bid(round, NG);
    b.quote = (b.quote ?? "").replace('"unitPriceUsdc":7100000', '"unitPriceUsdc":6900000');
    const check = checkSealedRound(round);
    expect(check.result).toBe("INVALID");
    expect(check.problems).toContain(`${NG}: opened text does not match its seal`);
    expect(check.problems.at(-1)).toMatch(/the winner .* has no quote sealed in time/);
  });

  it("fails when a quote was sealed after the deadline", () => {
    const round = copy();
    bid(round, RW).committed_at = round.closes_at;
    expect(checkSealedRound(round).problems).toEqual([`${RW}: sealed after the deadline`]);
  });

  it("fails when a quote names another supplier, even with a matching seal", () => {
    const round = copy();
    const b = bid(round, RW);
    b.quote = bid(round, NG).quote;
    b.hash = sha256Hex(b.quote ?? "");
    expect(checkSealedRound(round).problems).toEqual([
      `${RW}: opened text names another round or supplier`,
    ]);
  });

  it("treats an unopened quote as void, and fails a round won by one", () => {
    const round = copy();
    const b = bid(round, RW);
    b.quote = null;
    b.revealed_at = null;
    expect(checkSealedRound(round).result).toBe("VALID");
    round.awarded = RW;
    expect(checkSealedRound(round).result).toBe("INVALID");
  });

  it("fails a round awarded before its deadline", () => {
    const round = copy();
    round.awarded_at = round.opened_at;
    expect(checkSealedRound(round).problems).toEqual(["awarded before the deadline"]);
  });
});
