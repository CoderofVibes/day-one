import { describe, expect, it } from "vitest";
import { explainFailure } from "./explain.ts";

describe("plain words for a live run's failures", () => {
  it("explains the network being down without blaming the chain", () => {
    const e = explainFailure(
      "NEAR RPC endpoints https://a and https://b did not answer (fetch failed). Check…",
    );
    expect(e?.what).toBe("NEAR testnet did not answer, so nothing was sent.");
    expect(e?.fix).toMatch(/NEAR_RPC_URL.*npm run demo/);
  });

  it("names the relayer when it cannot pay the staff's gas", () => {
    const e = explainFailure(
      "Transaction failed: dayone-relayer.testnet NotEnoughBalance { balance: 1000 }",
    );
    expect(e?.what).toMatch(/relayer .* out of NEAR/);
    expect(explainFailure("signer NotEnoughBalance")?.what).toMatch(/too little NEAR/);
  });

  it("says a PO id can be used once, from the contract's refusal or the start check", () => {
    for (const message of [
      "Smart contract panicked: PO-1041 was already submitted.",
      "PO-1041 is already on chain; the demo needs a contract without it.",
    ]) {
      const e = explainFailure(message);
      expect(e?.what).toBe("PO-1041 is already on the contract, and a PO id can be used once.");
      expect(e?.fix).toMatch(/reset:testnet/);
    }
  });

  it("explains a supplier held after rehearsals", () => {
    const e = explainFailure(
      "northgate-ingredients.testnet is suspended after 2 rejected deliveries in a row until HQ reinstates it; no approval can override this.",
    );
    expect(e?.what).toMatch(/holds northgate-ingredients\.testnet after 2 rejected deliveries/);
    expect(e?.fix).toMatch(/reinstates/);
  });

  it("explains a missing key, a stale key and the model service", () => {
    expect(explainFailure("no key for qc.plant-b.acme-holdings.testnet in C:\\x")?.fix).toMatch(
      /setup:testnet/,
    );
    expect(explainFailure("InvalidTxError: AccessKeyDoesNotExist")?.what).toMatch(
      /no longer matches/,
    );
    expect(explainFailure("NEAR AI Cloud 402: payment required")?.fix).toMatch(/NEARAI_API_KEY/);
  });

  it("leaves what it does not know alone", () => {
    expect(explainFailure("PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00")).toBe(
      null,
    );
    expect(explainFailure("tx 4012ab… failed")).toBe(null);
    expect(explainFailure(null)).toBe(null);
  });
});
