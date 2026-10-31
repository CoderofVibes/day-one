import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOT_STATES, lotStyle } from "./lotStates.ts";

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const defined = new Set([...tokens.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));

describe("the lot-state map", () => {
  it("covers the brief's nine states", () => {
    expect(Object.keys(LOT_STATES).sort()).toEqual(
      [
        "consumed",
        "en_route",
        "in_use",
        "on_order",
        "quarantine",
        "received",
        "rejected",
        "released",
        "wasted",
      ].sort(),
    );
  });

  it("paints every state with a token that exists, and names a token family that exists", () => {
    for (const s of Object.values(LOT_STATES)) {
      expect(defined.has(s.fill), s.fill).toBe(true);
      expect(defined.has(`--${s.semantic}`), s.semantic).toBe(true);
      expect(defined.has(`--${s.semantic}-tint`), `${s.semantic}-tint`).toBe(true);
      expect(defined.has(`--${s.semantic}-border`), `${s.semantic}-border`).toBe(true);
    }
  });

  it("gives an unknown state a neutral pill in plain words", () => {
    expect(lotStyle("on_hold")).toMatchObject({ label: "on hold", tone: "neutral" });
  });
});

describe("the semantic tokens", () => {
  it("defines the brief's set in light, and the folded chain colour in both dark blocks", () => {
    for (const name of ["ok", "wait", "bad", "money", "chain", "info", "neutral"]) {
      expect(defined.has(`--${name}`), name).toBe(true);
    }
    for (const name of ["--surface-1", "--surface-glass", "--border", "--text", "--e1", "--e3"]) {
      expect(defined.has(name), name).toBe(true);
    }
    expect(tokens).not.toMatch(/--recorded/);
    expect(tokens.match(/--chain: #66d9e8/g)).toHaveLength(2);
  });
});
