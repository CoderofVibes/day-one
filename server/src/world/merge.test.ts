import { describe, expect, it } from "vitest";
import type { GenealogyTables } from "../ledger/genealogy.ts";
import { mergeGenealogyTables } from "./genealogy.ts";

const empty = (): GenealogyTables =>
  ({
    lots: [],
    received: [],
    receipts: [],
    qc: [],
    poLines: [],
    batches: [],
    inputs: [],
    outputs: [],
    shipments: [],
  }) as unknown as GenealogyTables;

describe("merging the worlds' genealogy into the ledger's", () => {
  it("leaves out a world output or shipment whose batch or lot the ledger has not posted yet", () => {
    // The start of a live run: the worlds already know BR-B-1045's output and its shipment,
    // the ledger has not confirmed BR-B-1045 yet (GET /api/genealogy answered 409 on Nov 3).
    const world = empty();
    world.outputs = [{ batch: "BR-B-1045", lot: "FG-BR-B-1045" }] as GenealogyTables["outputs"];
    world.shipments = [
      {
        shipmentNo: "HP-SH-1",
        customer: "C",
        facility: "B",
        shippedAt: "2026-11-12",
        lot: "FG-BR-B-1045",
        qtyBase: 1,
      },
    ] as unknown as GenealogyTables["shipments"];
    const merged = mergeGenealogyTables(empty(), world);
    expect(merged.outputs).toEqual([]);
    expect(merged.shipments).toEqual([]);
  });
});
