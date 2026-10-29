import { resolve } from "node:path";
import type { SealedRoundView } from "@day-one/server/sealed";
import { describe, expect, it } from "vitest";
import { openedQuotes, SealedRoundError } from "./sealed.ts";
import { openSealedEnv } from "./sealedEnv.ts";
import { runSealedRound, sealedAttacks } from "./sealedRound.ts";

const root = resolve(import.meta.dirname, "../../..");

describe("a sealed quote round, replayed from the recorded testnet run", async () => {
  const env = openSealedEnv({ root });
  const run = await runSealedRound(env.deps);

  it("replays every recorded call", () => {
    expect(() => {
      if ("assertDone" in env.transport) env.transport.assertDone();
    }).not.toThrow();
  });

  it("tells staff the round in plain words, with no fingerprints or salts", () => {
    expect(run.staff).toContain(
      "1:03 PM  2 sealed quotes, opened at 1:03 PM. Each matched the quote sealed before the deadline.",
    );
    // The recorded windows set the staff times: three minutes on testnet.
    expect(env.deps.windows).toEqual({ commitSecs: 180, revealSecs: 600 });
    expect(run.staff[1]).toBe(
      "1:00 PM  2 sealed quotes received. QuickChem Direct's was refused: not an approved supplier.",
    );
    for (const line of run.staff) expect(line).not.toMatch(/[0-9a-f]{10}/);
  });

  it("ranks the opened quotes and awards the cheapest qualified one on chain", () => {
    expect(run.ranking.selected?.vendorName).toBe("Northgate Ingredients");
    expect(run.award?.status).toBe("success");
    expect(run.round.awarded).toBe("northgate-ingredients.testnet");
  });

  it("refuses every sealed-bid attack", () => {
    const attacks = sealedAttacks(run);
    expect(attacks.map((a) => [a.attack, a.held])).toEqual([
      ["Peek at sealed quotes", true],
      ["Reveal a different price than the one sealed", true],
      ["Seal a quote after the deadline", true],
    ]);
    expect(attacks.every((a) => a.network === "testnet")).toBe(true);
  });

  it("refuses to rank a round that is still sealed", () => {
    expect(() => openedQuotes(env.deps.db, run.peek.before)).toThrow(SealedRoundError);
  });

  it("does not rank a quote that was never opened", () => {
    const round: SealedRoundView = structuredClone(run.round);
    const rival = round.bids[1];
    if (!rival) throw new Error("no second bid");
    rival.quote = null;
    rival.revealed_at = null;
    const opened = openedQuotes(env.deps.db, round);
    expect(opened.answers.map((a) => a.vendor)).toEqual(["NGI"]);
    expect(opened.void).toEqual([
      { supplier: "ridgeway-ascorbics.testnet", reason: "never opened its sealed quote" },
    ]);
  });
});
