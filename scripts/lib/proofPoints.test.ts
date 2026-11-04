import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProofPoints, formatProofPoints, PROOF_POINTS_FILE } from "./proofPoints.ts";

const root = resolve(import.meta.dirname, "../..");
const frozen = readFileSync(join(root, PROOF_POINTS_FILE), "utf8");

describe("the six proof points", () => {
  it("rebuild from the recordings exactly as frozen in data/proof-points.json", async () => {
    const built = await buildProofPoints(root);
    expect(built).toEqual(JSON.parse(frozen));
    expect(formatProofPoints(built)).toBe(frozen);
  }, 120_000);

  it("say what the brief promises", () => {
    const p = JSON.parse(frozen);
    expect([p.attacks.refused, p.attacks.total]).toEqual([21, 21]);
    expect([p.po1042.amountUsd, p.po1042.perPoLimitUsd]).toEqual(["5150.00", "2500.00"]);
    expect(p.po1042.approver.name).toBe("Linda Park");
    expect(p.po1042.releasedLot).toBe("ASC-261116-01");
    expect(p.groupBuy.totalUsd).toBe("9490.00");
    expect(p.reconciliation.checks.map((c: { verdict: string }) => c.verdict)).toEqual(
      Array(7).fill("MATCH"),
    );
    expect(p.usdcPo1047.amountUsd).toBe("19.00");
    expect(p.attestation.ok).toBe(true);
  });
});
