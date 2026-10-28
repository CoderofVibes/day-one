import { describe, expect, it } from "vitest";
import { formatUsd, parseUsd } from "./money.ts";

describe("formatUsd", () => {
  it("formats the over-limit PO from the demo", () => {
    expect(formatUsd(5_150_000_000n)).toBe("$5,150.00");
  });

  it("formats small and negative amounts", () => {
    expect(formatUsd(0n)).toBe("$0.00");
    expect(formatUsd(50_000n)).toBe("$0.05");
    expect(formatUsd(-19_000_000n)).toBe("-$19.00");
  });

  it("refuses sub-cent amounts instead of rounding", () => {
    expect(() => formatUsd(1n)).toThrow(RangeError);
  });
});

describe("parseUsd", () => {
  it("round-trips with formatUsd", () => {
    for (const text of ["$2,500.00", "$0.05", "$1,234,567.89", "-$19.00"]) {
      expect(formatUsd(parseUsd(text))).toBe(text);
    }
  });

  it("accepts plain numbers", () => {
    expect(parseUsd("5150")).toBe(5_150_000_000n);
    expect(parseUsd("5150.5")).toBe(5_150_500_000n);
  });

  it("rejects malformed input", () => {
    for (const text of ["", "abc", "$1.234", "1,23", "$5,15,0"]) {
      expect(() => parseUsd(text)).toThrow(SyntaxError);
    }
  });
});
