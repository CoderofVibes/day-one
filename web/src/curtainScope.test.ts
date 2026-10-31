import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Curtain } from "./Curtain.tsx";
import { pageCards, RECENT } from "./curtainScope.ts";
import pages from "./data/pages.json";
import { groupBuy } from "./groupBuy.ts";
import type { Recorded } from "./reads.ts";
import { run } from "./run.ts";
import { NAV, type PageId } from "./shell.tsx";

const recorded = pages.recorded as unknown as Recorded;
const PAGE_IDS = NAV.flatMap((g) => g.items.map((i) => i.id));
const last = run.steps.length - 1;
const known = new Set([
  ...run.transactions.map((t) => t.tx),
  ...groupBuy.transactions.map((t) => t.tx),
  ...[...recorded.attacks.attacks, ...recorded.sealed.attacks].flatMap((a) => a.txHashes),
]);

describe("behind the curtain, page by page", () => {
  it("renders at least one transaction card on every page at every step, curtain on", () => {
    for (const page of PAGE_IDS) {
      for (const at of [0, 6, last]) {
        const html = renderToStaticMarkup(createElement(Curtain, { data: run, upTo: at, page }));
        expect(html, `${page} at step ${at}`).toMatch(/<li class="tx /);
        expect(html, `${page} at step ${at}`).not.toContain("No transactions yet");
      }
    }
  });

  it("shows only recorded hashes, with the recordings read or not", () => {
    for (const page of PAGE_IDS) {
      for (const r of [null, recorded]) {
        for (const c of pageCards(page, run, last, r).cards) {
          expect(known.has(c.kind === "tx" ? c.tx.tx : c.hash), page).toBe(true);
        }
      }
    }
  });

  it("falls back to the latest recorded transactions when a page has none yet", () => {
    const view = pageCards("purchasing", run, 0, recorded);
    expect(view.fallback).toBe(true);
    expect(view.cards).toHaveLength(RECENT);
    const html = renderToStaticMarkup(
      createElement(Curtain, { data: run, upTo: 0, page: "purchasing" as PageId }),
    );
    expect(html).toContain("Recent on testnet");
    expect(html).toContain("Nothing on chain for this page yet. Here&#x27;s the latest.");
  });

  it("gives Purchasing the PO transactions and ERP connection the connector's steps", () => {
    const methods = (page: PageId) =>
      pageCards(page, run, last, recorded).cards.map((c) => (c.kind === "tx" ? c.tx.method : ""));
    expect(new Set(methods("purchasing"))).toEqual(
      new Set([
        "submit_po",
        "approve_po",
        "accept_po",
        "mark_shipped",
        "confirm_receipt",
        "qc_release",
      ]),
    );
    const erp = pageCards("erp", run, last, recorded).cards.map((c) =>
      c.kind === "tx" ? c.tx.tx.slice(0, 8) : c.hash,
    );
    // The steps the ERP mirrored (npm run erp:demo): the anchored batch record, both POs, the
    // receipt and the payment. Linda's approval (EW5A8qi3) has no ERP line.
    expect(erp).toEqual(["GjN3NXzU", "D28BgcP3", "FQepeewB", "3sUEp63g", "7pCauyEY", "2zwgaHgW"]);
  });

  it("gives Group purchasing PO-G-2001's run and Suppliers the credential attacks", () => {
    expect(pageCards("group", run, 0, null).cards).toHaveLength(groupBuy.transactions.length);
    const suppliers = pageCards("suppliers", run, last, recorded).cards;
    expect(suppliers.filter((c) => c.kind === "attack").length).toBeGreaterThanOrEqual(4);
    expect(suppliers.some((c) => c.kind === "attack" && c.url?.includes(c.hash))).toBe(true);
  });

  it("counts this page's transactions and every recorded one", () => {
    const view = pageCards("purchasing", run, last, recorded);
    expect(view.fallback).toBe(false);
    expect(view.total).toBe(known.size);
    const html = renderToStaticMarkup(
      createElement(Curtain, { data: run, upTo: last, page: "purchasing" as PageId }),
    );
    expect(html).toMatch(/\d+ on this page · \d+ total recorded/);
    expect(html).toContain("15 enclave checks");
  });
});
