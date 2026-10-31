// The Suppliers page as it renders: the leaderboard's rows in score order, the formula from the
// weights the scorecards were computed with.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import pages from "../data/pages.json";
import raw from "../data/suppliers.json";
import type { SupplierStanding } from "../reads.ts";
import { COMPONENTS, leaderboard, type SuppliersData, standingOf } from "../suppliers.ts";
import { SupplierDetail } from "./SupplierDetail.tsx";
import { FormulaBody, Leaderboard } from "./Suppliers.tsx";

const data = raw as unknown as SuppliersData;
const standings = pages.recorded.credentials.suppliers as unknown as SupplierStanding[];
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("the leaderboard", () => {
  it("lists the suppliers in score order with their credential", () => {
    for (const date of [data.asOf, "2026-03-01"]) {
      const html = renderToStaticMarkup(
        <Leaderboard data={data} date={date} standings={standings} curtain={false} />,
      );
      const rows = leaderboard(data, date, standings);
      const at = rows.map((r) => html.indexOf(`<b>${r.name.replace("&", "&amp;")}</b>`));
      expect(at.every((x) => x >= 0)).toBe(true);
      expect(at).toEqual([...at].sort((a, b) => a - b));
    }
    const html = text(
      renderToStaticMarkup(
        <Leaderboard data={data} date={data.asOf} standings={standings} curtain={false} />,
      ),
    );
    expect(html).toContain("Pacific Excipient Co.");
    expect(html).toContain("suspended");
    expect(html).toContain("not qualified");
    expect(html).toContain("2 QC rejects in a row");
    // Accounts stay behind the curtain.
    expect(html).not.toContain(".testnet");
  });
});

describe("the detail view", () => {
  const detail = (vendor: string, date: string, curtain = false) =>
    renderToStaticMarkup(
      <SupplierDetail
        data={data}
        vendor={vendor}
        date={date}
        standing={standingOf(vendor, data.view.names, standings)}
        curtain={curtain}
        onClose={() => {}}
      />,
    );

  it("explains RFQ-2611-01 under Why Kevin picks them, naming the recorded winner", () => {
    for (const vendor of ["NGI", "RWA", "QCD"]) {
      const html = text(detail(vendor, data.asOf));
      expect(html).toContain("Why Kevin picks them");
      expect(html).toContain("RFQ-2611-01");
      expect(html).toContain("Northgate Ingredients selected: lowest landed cost");
      expect(html).toContain("Ridgeway Ascorbics runner-up");
      expect(html).toContain("QuickChem Direct excluded at $5.90/kg: not qualified");
    }
    // Before the recorded run, the RFQ is not there yet.
    expect(text(detail("NGI", "2026-11-01"))).not.toContain("RFQ-2611-01");
  });

  it("shows the price hike in Northgate's ascorbic acid", () => {
    const html = text(detail("NGI", data.asOf));
    expect(html).toContain("Ascorbic acid price hike");
    expect(html).toContain("$6.40");
    expect(html).toContain("$7.10");
  });
});

describe("the formula popover", () => {
  it("reads the weights from the scorecards' config", () => {
    const html = text(renderToStaticMarkup(<FormulaBody weights={data.weights} />));
    for (const c of COMPONENTS) expect(html).toContain(`${data.weights[c.key]} ${c.label}:`);
    expect(html).toContain(`${data.weights.qc}·QC + ${data.weights.onTime}·on-time`);
    const changed = { ...data.weights, qc: 40 };
    expect(text(renderToStaticMarkup(<FormulaBody weights={changed} />))).toContain("40·QC");
  });
});
