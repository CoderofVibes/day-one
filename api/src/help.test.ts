import { describe, expect, it } from "vitest";
import { helpFor } from "./session.ts";

describe("why a live run stopped, in plain words", () => {
  it("explains the failed call rather than the step's own line", () => {
    const rows = [
      { status: "success", errorMessage: null },
      {
        status: "refused",
        errorMessage:
          "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required.",
      },
      {
        status: "failed",
        errorMessage: "NEAR RPC endpoints https://a and https://b did not answer (fetch failed).",
      },
    ];
    expect(helpFor("PO-1042 was not funded on retry", rows)).toMatch(
      /^NEAR testnet did not answer, so nothing was sent\. Check the internet connection/,
    );
  });

  it("falls back to the stop line, and says nothing it cannot explain", () => {
    expect(
      helpFor("PO-1041 is already on chain; the demo needs a contract without it.", []),
    ).toMatch(/PO-1041 is already on the contract.*reset:testnet/);
    expect(helpFor("QC release ended rejected", [{ status: "success", errorMessage: null }])).toBe(
      null,
    );
  });
});
