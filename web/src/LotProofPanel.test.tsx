import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE } from "./genealogy.fixture.ts";
import { trace } from "./genealogy.ts";
import {
  countVerdicts,
  kindCounts,
  type LotProof,
  ProvePanel,
  recordWords,
  summaryWords,
  tamperPassport,
  traceKeys,
  verdictLook,
} from "./LotProofPanel.tsx";
import {
  checkPassport,
  type LotBookFile,
  leafHash,
  type PassportLeaf,
  passportForKeys,
  proofFor,
  rootFrom,
} from "./lotProof.ts";

const CHAIN_WORDS = /testnet|wallet|token|gas|\btx\b|anchor|hash|contract|merkle|root|rpc/i;

const leaf = (kind: PassportLeaf["kind"], id: string, record: Record<string, unknown>) => ({
  kind,
  id,
  plant: "B",
  at: "2026-09-01T14:00:00.000Z",
  salt: `salt-${id}`,
  record,
});

/** A one-day book around the fixture's first batch, its root computed the way the server does. */
async function book(): Promise<LotBookFile> {
  const leaves: PassportLeaf[] = [
    leaf("receipt", "ASC-1", {
      lot: "ASC-1",
      material: "ASC",
      supplier: "RWA",
      supplierLot: "RWA-ASC-1",
      po: "PO-1",
      receivedBase: 2_000_000,
      receivedBy: "Tommy Reyes",
    }),
    leaf("qc", "ASC-1", { lot: "ASC-1", decision: "released", decidedBy: "Priya Natarajan" }),
    leaf("batch", "BR-1B", {
      batch: "BR-1B",
      product: "VC500",
      units: 100,
      inputs: [{ lot: "ASC-1", qtyBase: 1_000_000 }],
      outputs: ["FG-1"],
    }),
    leaf("shipment", "SH-1", {
      shipment: "SH-1",
      customer: "Example Pharmacy",
      lots: [{ lot: "FG-1", qtyBase: 50 }],
    }),
    leaf("payment", "PO-1", {
      po: "PO-1",
      supplier: "ridgeway.testnet",
      amountUnits: "14000000",
      poHash: "00",
      contract: "spend-policy.acme-holdings.testnet",
      txHash: "TX1",
    }),
  ];
  const hashes = await Promise.all(leaves.map(leafHash));
  const root = await rootFrom(hashes[0] as string, await proofFor(hashes, 0));
  return {
    version: 1,
    at: "2026-09-01T16:00:00.000Z",
    contract: "spend-policy.acme-holdings.testnet",
    anchors: { "LOTBOOK-B-2026-09-01": "ANCHORTX" },
    days: [
      { plant: "B", date: "2026-09-01", refId: "LOTBOOK-B-2026-09-01", root, prev: null, leaves },
    ],
  };
}

describe("Prove it", () => {
  const t = trace(FIXTURE, { kind: "lot", id: "ASC-1" });

  it("maps the trace to the book's keys in trace order, once each", () => {
    const keys = traceKeys(FIXTURE, t);
    expect(keys).toEqual([
      "receipt:ASC-1",
      "qc:ASC-1",
      "payment:PO-1",
      "batch:BR-1B",
      "batch:BR-2A",
      "receipt:FG-1",
      "qc:FG-1",
      "shipment:SH-1",
      "shipment:SH-2",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts each record in staff words", async () => {
    const b = await book();
    const words = b.days[0]?.leaves.map((l) => recordWords(l, FIXTURE)) ?? [];
    expect(words).toEqual([
      "ASC-1 received from Ridgeway Ascorbics on PO-1 by Tommy Reyes · 2 kg",
      "ASC-1 QC released by Priya Natarajan",
      "Batch BR-1B made 100 Vitamin C 500 mg Chewable · lot FG-1",
      "Shipment SH-1 to Example Pharmacy · 1 lot",
      "PO-1 paid: $14.00 to Ridgeway Ascorbics",
    ]);
    for (const w of words) expect(w).not.toMatch(CHAIN_WORDS);
  });

  it("names each verdict for staff without chain words, and plainly behind the curtain", () => {
    for (const v of ["proved", "path-only", "changed", "not-anchored"] as const) {
      const staff = verdictLook(v);
      expect(`${staff.label} ${staff.means}`).not.toMatch(CHAIN_WORDS);
    }
    expect(verdictLook("path-only").label).toBe("Not confirmed");
    expect(verdictLook("path-only", true).label).toBe("Path only");
    expect(verdictLook("changed").tone).toBe("refused");
    expect(verdictLook("not-anchored", true).label).toBe("No anchor");
  });

  it("sums the verdicts into one honest headline", () => {
    const all = { total: 173, proved: 173, pathOnly: 0, changed: 0, notAnchored: 0 };
    expect(summaryWords(all).headline).toBe("173 of 173 records proved");
    expect(summaryWords(all).tone).toBe("ok");
    const offline = { ...all, proved: 0, pathOnly: 173 };
    expect(summaryWords(offline).headline).toBe("173 records intact, none confirmed yet");
    expect(summaryWords(offline).detail).toMatch(/could not be reached/);
    expect(summaryWords(offline).headline).not.toMatch(/proved/);
    const one = { ...all, proved: 172, changed: 1 };
    expect(summaryWords(one).headline).toBe("172 of 173 records proved · 1 changed");
    expect(summaryWords(one).tone).toBe("bad");
    for (const c of [all, offline, one]) {
      const s = summaryWords(c);
      expect(`${s.headline} ${s.detail}`).not.toMatch(CHAIN_WORDS);
    }
  });

  it("builds the passport, checks it offline, and shows one changed record after a tamper", async () => {
    const b = await book();
    const p = await passportForKeys(b, "ASC-1", traceKeys(FIXTURE, t));
    expect(p.entries.map((e) => `${e.leaf.kind}:${e.leaf.id}`)).toEqual([
      "receipt:ASC-1",
      "qc:ASC-1",
      "payment:PO-1",
      "batch:BR-1B",
      "shipment:SH-1",
    ]);
    expect(kindCounts(p.entries)).toBe("1 receipt, 1 QC decision, 1 payment, 1 batch, 1 shipment");

    const real = await checkPassport(p, { online: false });
    expect(countVerdicts(real.entries)).toEqual({
      total: 5,
      proved: 0,
      pathOnly: 5,
      changed: 0,
      notAnchored: 0,
    });

    const { passport, tamper } = tamperPassport(p, FIXTURE);
    expect(tamper).toEqual({
      key: "receipt:ASC-1",
      field: "quantity received",
      was: "2 kg",
      now: "20 kg",
    });
    // The book's own record is untouched; only the copy in the new passport differs.
    expect(p.entries[0]?.leaf.record.receivedBase).toBe(2_000_000);
    const after = await checkPassport(passport, { online: false });
    expect(after.entries.map((e) => e.verdict)).toEqual([
      "changed",
      "path-only",
      "path-only",
      "path-only",
      "path-only",
    ]);
  });

  it("renders the idle panel without chain words for staff", () => {
    const proof: LotProof = { state: { phase: "idle" }, prove: () => {}, setTamper: () => {} };
    const html = renderToStaticMarkup(
      <ProvePanel g={FIXTURE} curtain={false} proof={proof} traceOf="ASC-1" />,
    );
    expect(html).toContain("Prove it");
    expect(html).toContain("sealed daily records");
    expect(html).not.toMatch(CHAIN_WORDS);
  });
});
