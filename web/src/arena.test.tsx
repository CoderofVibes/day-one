import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Arena, chipLabel, shortHash, tally, tallyLine, timeline } from "./arena.ts";
import arenaJson from "./data/arena.json";
import { ArenaResult } from "./pages/Arena.tsx";

const arena = arenaJson as unknown as Arena;
const byName = (name: string) => {
  const c = arena.cases.find((x) => x.attack === name);
  if (!c) throw new Error(`no case "${name}"`);
  return c;
};
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("the attack arena", () => {
  it("shows the contract's words, method, signer and transaction for an on-chain refusal", () => {
    const c = byName("Revoked supplier");
    const html = renderToStaticMarkup(<ArenaResult c={c} />);
    const refused = c.txs.find((t) => t.status === "refused");
    expect(text(html)).toContain("Refused by contract");
    expect(text(html)).toContain(c.reason);
    expect(html).toContain("<code>submit_po</code>");
    expect(html).toContain("kevin.plant-b.acme-holdings.testnet");
    expect(html).toContain(`title="${refused?.tx}"`);
    expect(html).toContain(`href="${refused?.url}"`);
    expect(text(html)).toContain("View on explorer ↗");
  });

  it("says no transaction, and links none, for a case refused before the chain", () => {
    const c = byName("New bank details by email");
    const html = renderToStaticMarkup(<ArenaResult c={c} />);
    expect(text(html)).toContain("Refused by Kevin");
    expect(text(html)).toContain(c.reason);
    expect(text(html)).toContain("no transaction: refused before the chain");
    expect(html).not.toContain("href=");
    expect(chipLabel(byName("Duplicate invoice"))).toBe("Refused by the ERP");
  });

  it("walks receive, draft, check, result and what happened to the money", () => {
    expect(timeline(byName("Lookalike vendor"))).toEqual([
      "Kevin receives",
      "Kevin drafts",
      "Contract checks",
      "Refused by contract",
      "Funds didn't move.",
    ]);
    // The split purchase funded its first PO; the timeline does not claim nothing moved.
    expect(timeline(byName("Split purchase under the per-PO limit")).at(-1)).toMatch(/escrow/);
  });

  it("keeps the score of what the judge tried beside the suite's", () => {
    expect(tallyLine(tally(arena.cases, new Set()))).toBe("Suite: 20 of 20");
    expect(tallyLine(tally(arena.cases, new Set([1, 2, 3, 4])))).toBe(
      "Refused 4 of 4 you tried · Suite: 20 of 20",
    );
    expect(shortHash("BKjdSJD49LVSpDYgo9LrMnbbCiNrs2wgz7GDt2suBRB7")).toBe("BKjdSJ…BRB7");
  });
});
