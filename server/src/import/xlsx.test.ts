import { describe, expect, it } from "vitest";
import { parseSheet } from "./xlsx.ts";

describe("parseSheet", () => {
  it("keeps the row after a self-closing formatted empty row (review fix, Oct 29)", () => {
    // Excel writes a formatted row with no values as <row .../>; the row after it must stay.
    const xml =
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Inventory</t></is></c></row>' +
      '<row r="2" spans="1:7" ht="15" customHeight="1"/>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Item</t></is></c><c r="B3"><v>12.5</v></c></row>' +
      "</sheetData></worksheet>";
    const rows = parseSheet(xml, []);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["Inventory"]);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(["Item", 12.5]);
  });
});
