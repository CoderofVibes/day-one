import { describe, expect, it } from "vitest";
import type { Genealogy } from "../ledger/genealogy.ts";
import {
  bookDrift,
  bookProblems,
  buildLotBook,
  passportFor,
  passportProblems,
  type RecordedPayment,
  storyOf,
} from "./lotBook.ts";
import { leafHash, levels, merkleRoot, nodeHash, proofFor, rootFrom } from "./merkle.ts";

const h = (s: string) => leafHash({ s });

describe("the lot book's Merkle tree", () => {
  it("proves every leaf of trees with 1 to 9 leaves", () => {
    for (let n = 1; n <= 9; n++) {
      const leaves = Array.from({ length: n }, (_, i) => h(`leaf ${i}`));
      const root = merkleRoot(leaves);
      for (let i = 0; i < n; i++) expect(rootFrom(leaves[i] ?? "", proofFor(leaves, i))).toBe(root);
    }
  });

  it("carries an odd node up unchanged instead of pairing it with itself", () => {
    const a = h("a");
    const b = h("b");
    const c = h("c");
    expect(merkleRoot([a, b, c])).toBe(nodeHash(nodeHash(a, b), c));
    expect(merkleRoot([a, b, c])).not.toBe(merkleRoot([a, b, c, c]));
    expect(levels([a])).toEqual([[a]]);
  });

  it("fails a changed leaf, a swapped sibling side and a foreign leaf", () => {
    const leaves = ["a", "b", "c", "d", "e"].map(h);
    const root = merkleRoot(leaves);
    const proof = proofFor(leaves, 2);
    expect(rootFrom(h("c2"), proof)).not.toBe(root);
    const flipped = proof.map((s, i) =>
      i === 0 ? { ...s, side: s.side === "left" ? ("right" as const) : ("left" as const) } : s,
    );
    expect(rootFrom(leaves[2] ?? "", flipped)).not.toBe(root);
    expect(rootFrom(h("z"), proof)).not.toBe(root);
  });

  it("never reads a leaf as an inner node", () => {
    const a = h("a");
    const b = h("b");
    expect(leafHash(`${a}${b}`)).not.toBe(nodeHash(a, b));
  });
});

/** A small plant: one raw lot paid on chain, a batch that drew it, its output and a shipment. */
function plant(): Genealogy {
  const base = {
    category: "active",
    dimension: "mass",
    vendorName: null,
    state: "released",
    onHandBase: 0,
    price: null,
    usedIn: [] as string[],
    shippedIn: [] as string[],
  };
  return {
    lots: {
      "ASC-1": {
        ...base,
        code: "ASC-1",
        material: "ASC",
        materialName: "Ascorbic acid",
        vendor: "NGI",
        vendorLot: "NG-1",
        facility: "B",
        receivedBase: 700,
        receivedAt: "2026-11-16T14:20:00.000Z",
        po: "PO-1042",
        receipt: { receivedAt: "2026-11-16T14:20:00.000Z", by: "Tommy Reyes" },
        qc: { decision: "released", decidedAt: "2026-11-16T16:05:00.000Z", by: "Priya Natarajan" },
        producedBy: null,
        usedIn: ["BR-1"],
      },
      "FG-1": {
        ...base,
        code: "FG-1",
        material: "VC500",
        materialName: "Vitamin C 500",
        vendor: null,
        vendorLot: null,
        facility: "B",
        receivedBase: 0,
        receivedAt: null,
        po: null,
        receipt: null,
        qc: { decision: "released", decidedAt: "2026-11-18T10:00:00.000Z", by: "Priya Natarajan" },
        producedBy: "BR-1",
        shippedIn: ["SH-1"],
      },
    },
    batches: {
      "BR-1": {
        batchNo: "BR-1",
        facility: "B",
        product: "VC500",
        productName: "Vitamin C 500",
        completedAt: "2026-11-17T20:00:00.000Z",
        units: 1000,
        inputs: [{ lot: "ASC-1", qtyBase: 500 }],
        outputs: ["FG-1"],
      },
    },
    shipments: {
      "SH-1": {
        shipmentNo: "SH-1",
        customer: "Lakeshore Pharmacy",
        facility: "B",
        shippedAt: "2026-11-19T09:00:00.000Z",
        lots: [{ lot: "FG-1", qtyBase: 1000 }],
      },
    },
    has: { fgLots: true, shipments: true },
  } as unknown as Genealogy;
}

const payments: RecordedPayment[] = [
  {
    po: "PO-1042",
    supplier: "northgate-ingredients.testnet",
    amountUnits: "5150000000",
    poHash: null,
    txHash: "HpaidTxHash",
    contract: "spend-policy.acme-holdings.testnet",
  },
];

let n = 0;
const salts = () => (n++).toString(16).padStart(32, "0");

describe("the lot book", () => {
  const g = plant();
  const book = buildLotBook(g, "2026-11-19T12:00:00.000Z", payments, salts);

  it("puts each record on its own day, with the payment on the QC release's day", () => {
    expect(book.days.map((d) => d.refId)).toEqual([
      "LOTBOOK-B-2026-11-16",
      "LOTBOOK-B-2026-11-17",
      "LOTBOOK-B-2026-11-18",
      "LOTBOOK-B-2026-11-19",
    ]);
    expect(book.days[0]?.leaves.map((l) => `${l.kind}:${l.id}`)).toEqual([
      "payment:PO-1042",
      "qc:ASC-1",
      "receipt:ASC-1",
    ]);
  });

  it("chains each day's root to the day before and checks its own arithmetic", () => {
    expect(book.days[0]?.prev).toBeNull();
    expect(book.days[1]?.prev).toBe(book.days[0]?.root);
    expect(bookProblems(book)).toEqual([]);
    const tampered = structuredClone(book);
    const leaf = tampered.days[1]?.leaves[0];
    if (leaf) leaf.record.units = 999;
    expect(bookProblems(tampered)).toEqual([
      "LOTBOOK-B-2026-11-17: root does not match its leaves",
    ]);
  });

  it("finds no drift against the genealogy it came from, and names what changed", () => {
    expect(bookDrift(book, g, payments)).toEqual([]);
    const later = structuredClone(g);
    const br = later.batches["BR-1"];
    if (br) br.units = 990;
    expect(bookDrift(book, later, payments)).toEqual(["changed batch:BR-1"]);
  });

  it("tells a raw lot's story downstream to the customer shipment, with the payment", () => {
    expect(storyOf(g, "ASC-1").map((w) => `${w.kind}:${w.id}`)).toEqual([
      "receipt:ASC-1",
      "qc:ASC-1",
      "payment:PO-1042",
      "batch:BR-1",
      "receipt:FG-1",
      "qc:FG-1",
      "shipment:SH-1",
    ]);
    expect(storyOf(g, "FG-1").map((w) => `${w.kind}:${w.id}`)).toContain("payment:PO-1042");
  });

  it("proves every disclosed record and catches one changed field", () => {
    const p = passportFor(book, g, "ASC-1");
    expect(p.entries.map((e) => `${e.leaf.kind}:${e.leaf.id}`)).toEqual([
      "receipt:ASC-1",
      "qc:ASC-1",
      "payment:PO-1042",
      "batch:BR-1",
      "qc:FG-1",
      "shipment:SH-1",
    ]);
    expect(passportProblems(p)).toEqual([]);
    const forged = structuredClone(p);
    const first = forged.entries[0];
    if (first) first.leaf.record.receivedBase = 7000;
    expect(passportProblems(forged)).toEqual([
      "receipt:ASC-1 does not lead to LOTBOOK-B-2026-11-16's root",
    ]);
  });
});
