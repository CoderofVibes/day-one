import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { seedLedger } from "../seed/index.ts";
import { books, booksCsv, plainDollars, priceDrift, toCsv } from "./books.ts";
import { type Ledger, openLedger } from "./db.ts";
import { purchaseOrders } from "./schema.ts";

let db: Ledger;
beforeEach(() => {
  db = openLedger();
  seedLedger(db);
});

describe("the bookkeeper export (FEATURES_V2 §2)", () => {
  it("lists the six settled history POs and reconciles to $9,632.50 to the cent", () => {
    const b = books(db);
    expect(b.settled.map((po) => po.poNo)).toEqual([
      "PO-1035",
      "PO-1036",
      "PO-1037",
      "PO-1038",
      "PO-1039",
      "PO-1040",
    ]);
    expect(b.totalUsdc).toBe(9_632_500_000);
    const amounts = b.rows.map((r) => Number(r.Amount));
    expect(amounts.reduce((a, c) => a + c, 0).toFixed(2)).toBe("9632.50");
    expect(b.sentences[0]).toBe(
      "6 settled purchase orders, $9,632.50, each matched to a receipt, all paid by check before Day One.",
    );
    // Every settled PO has its receipt date; none was paid through Day One yet.
    expect(b.settled.every((po) => po.receivedOn && !po.paymentRef)).toBe(true);
  });

  it("writes one row per line, plain numbers, stable columns, no crypto words", () => {
    const csv = booksCsv(db);
    const [header, ...lines] = csv.trimEnd().split("\r\n");
    expect(header).toBe(
      "PO,Vendor,Received,Released,Material,Description,Quantity,Unit,Unit price,Amount,Payment ref,Record ref",
    );
    expect(lines).toHaveLength(8);
    expect(lines[0]).toMatch(
      /^PO-1035,Pacific Excipient Co\.,2026-\d\d-\d\d,2026-\d\d-\d\d,MGS,Magnesium stearate,50\.000,kg,8\.20,410\.00,,$/,
    );
    expect(lines[2]).toMatch(
      /^PO-1036,Fennimore Polyols,.*,SOR,Sorbitol,1000\.000,kg,2\.15,2150\.00,,$/,
    );
    expect(lines[3]).toMatch(/,BTL,.*,100000,ea,0\.021,2100\.00,,$/);
    expect(csv).not.toMatch(/wallet|token|gas|escrow|NEAR/i);
  });

  it("flags PEC-1040's magnesium stearate at $9.35 against the $8.20 trailing price, up 14.0%", () => {
    const b = books(db);
    expect(b.alerts).toHaveLength(1);
    expect(b.alerts[0]).toMatchObject({
      poNo: "PO-1040",
      vendor: "Pacific Excipient Co.",
      material: "MGS",
      unitPriceUsdc: 9_350_000,
      trailingUsdc: 8_200_000,
      trailingPoNos: ["PO-1035"],
      driftBp: 1402,
    });
    expect(b.sentences[1]).toBe(
      "Pacific Excipient Co. billed magnesium stearate at $9.35/kg on PO-1040, up 14.0% on its $8.20/kg trailing price (PO-1035). It was a real, received order, so it is in the export with both prices; worth a call before the next one.",
    );
    // The drifted line is still exported.
    expect(b.rows.filter((r) => r.PO === "PO-1040")).toHaveLength(1);
  });

  it("never exports an unsettled PO as paid", () => {
    const before = books(db).settled.length;
    for (const status of ["funded", "received", "cancelled", "rejected"] as const) {
      db.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.poNo, "PO-1039")).run();
      expect(books(db).settled.map((po) => po.poNo)).not.toContain("PO-1039");
    }
    db.update(purchaseOrders)
      .set({ status: "paid" })
      .where(eq(purchaseOrders.poNo, "PO-1039"))
      .run();
    expect(books(db).settled).toHaveLength(before);
  });

  it("reports no drift when prices hold, and a drop as well as a rise", () => {
    const settled = books(db).settled;
    const steady = settled.map((po) =>
      po.poNo === "PO-1040"
        ? { ...po, lines: po.lines.map((l) => ({ ...l, unitPriceUsdc: 8_200_000 })) }
        : po,
    );
    expect(priceDrift(steady)).toEqual([]);
    const cheaper = settled.map((po) =>
      po.poNo === "PO-1040"
        ? { ...po, lines: po.lines.map((l) => ({ ...l, unitPriceUsdc: 7_000_000 })) }
        : po,
    );
    expect(priceDrift(cheaper)[0]?.driftBp).toBe(-1463);
    expect(priceDrift(cheaper)[0]?.sentence).toMatch(/down 14\.6%/);
  });

  it("formats plain numbers and quotes CSV fields that need it", () => {
    expect(plainDollars(1_700_000_000)).toBe("1700.00");
    expect(plainDollars(21_000)).toBe("0.021");
    expect(plainDollars(50_000_000, 3)).toBe("50.000");
    expect(plainDollars(-5_000_000)).toBe("-5.00");
    const row = Object.fromEntries(
      books(db).columns.map((c) => [c, c === "Description" ? 'Say "hi", twice' : "x"]),
    ) as Parameters<typeof toCsv>[0][number];
    expect(toCsv([row]).split("\r\n")[1]).toContain('"Say ""hi"", twice"');
  });
});
