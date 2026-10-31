import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE } from "../genealogy.fixture.ts";
import { LotsView, took } from "./Lots.tsx";

describe("Lots & recall page", () => {
  const html = renderToStaticMarkup(<LotsView genealogy={FIXTURE} plant="B" curtain={false} />);

  it("opens on the plant's latest batch and draws its whole trace as a graph", () => {
    expect(html).toContain('Trace from <span class="num">BR-1B</span>');
    expect(html).toContain('aria-label="Trace graph, 8 records"');
    for (const id of ["ASC-1", "CAC-1", "BR-1B", "FG-1", "SH-1", "SH-2", "Sample Grocers"]) {
      expect(html).toContain(`>${id}</text>`);
    }
    expect(html).toContain("Run recall drill");
    expect(html).toContain("Traced as far as");
  });

  it("colours each lot by its state from the one lot-state map", () => {
    expect(html).toContain('aria-label="lot ASC-1, in use"');
    expect(html).toContain('fill="var(--lot-in-use)"');
    expect(html).toContain('fill="var(--lot-released)"');
  });

  it("shows no chain words to staff", () => {
    expect(html).not.toMatch(/testnet|wallet|token|gas|\btx\b|anchor|hash|contract/i);
  });

  it("states measured times as precisely as they need", () => {
    expect(took(0.42)).toBe("0.42 ms");
    expect(took(12.34)).toBe("12.3 ms");
    expect(took(1300)).toBe("1.3 s");
  });
});
