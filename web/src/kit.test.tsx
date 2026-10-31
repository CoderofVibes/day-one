import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BulletBar,
  type Column,
  compactDollars,
  DataTable,
  DeltaChip,
  deltaTone,
  EmptyState,
  ErrorCard,
  Gauge,
  Histogram,
  inWindow,
  MoneyAmount,
  RecordLink,
  Ring,
  Skeleton,
  Sparkline,
  StatTile,
  StatusChip,
  Stepper,
  statusTone,
  Timeline,
} from "./kit.tsx";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("money", () => {
  it("compacts and keeps the full amount in the tooltip", () => {
    expect(compactDollars(612_000_000)).toBe("$612");
    expect(compactDollars(5_150_000_000)).toBe("$5,150");
    expect(compactDollars(18_600_000_000)).toBe("$18.6k");
    expect(compactDollars(60_000_000_000)).toBe("$60k");
    expect(compactDollars(1_250_000_000_000)).toBe("$1.3M");
    expect(compactDollars(-336_000_000)).toBe("−$336");
    const out = html(<MoneyAmount usdc={18_600_000_000} kind="held" />);
    expect(out).toContain('title="$18,600.00"');
    expect(out).toContain("money num held");
  });
});

describe("Sparkline", () => {
  it("draws nothing for no points", () => {
    expect(html(<Sparkline values={[]} label="x" />)).toBe("");
  });
  it("draws one point as a dot, without a line", () => {
    const out = html(<Sparkline values={[4]} label="one" end="ok" />);
    expect(out).toContain("<circle");
    expect(out).not.toContain("<polyline");
  });
  it("draws a band and a threshold when given", () => {
    const out = html(
      <Sparkline values={[89, 91, 90]} label="yield" band={[89, 92]} threshold={90} />,
    );
    expect(out).toContain("spark-band");
    expect(out).toContain("spark-rule");
    expect(out).toContain("<polyline");
  });
});

describe("delta", () => {
  it("reads a fall as down, red when a rise is good news", () => {
    const d = { value: -1, vs: "vs prior 4 wk", goodWhenUp: true };
    expect(deltaTone(d)).toBe("refused");
    const out = html(<DeltaChip delta={d} />);
    expect(out).toContain("▼");
    expect(out).toContain("down");
    expect(out).toContain("vs prior 4 wk");
  });
  it("is neutral with no direction or no change", () => {
    expect(deltaTone({ value: 3, vs: "" })).toBe("neutral");
    expect(deltaTone({ value: 0, vs: "", goodWhenUp: false })).toBe("neutral");
    expect(deltaTone({ value: 2, vs: "", goodWhenUp: false })).toBe("refused");
    expect(deltaTone({ value: -2, vs: "", goodWhenUp: false })).toBe("ok");
  });
});

describe("StatTile", () => {
  it("keeps the full sentence behind Why? and in the tooltip", () => {
    const why = "Kevin may commit $60,000.00 a month; $612.00 is held for an order on the way.";
    const out = html(
      <StatTile label="Spend this month" value="$5,150" context="of $60k a month" why={why} />,
    );
    expect(out).toContain("Why?");
    expect(out.split(why.replace(/\$/g, "$")).length).toBe(3);
    expect(out).not.toContain("tile-hit");
  });
  it("is one button over the whole tile when it opens something", () => {
    const out = html(
      <StatTile label="Open POs" value={1} open={{ id: "PO-1041", page: "purchasing" }} />,
    );
    expect(out).toContain("tile-hit");
    expect(out).toContain("View →");
  });
});

describe("gauge, ring, bullet, histogram", () => {
  it("colours a yield in the band green and below it amber", () => {
    expect(html(<Gauge value={90.4} min={84} max={96} band={[89, 92]} label="Yield" />)).toContain(
      "var(--ok)",
    );
    expect(html(<Gauge value={88} min={84} max={96} band={[89, 92]} label="Yield" />)).toContain(
      "var(--wait)",
    );
  });
  it("clamps a gauge value outside its range", () => {
    expect(() => html(<Gauge value={200} min={0} max={100} label="x" />)).not.toThrow();
  });
  it("draws a ring with an amber rest and an empty ring for no total", () => {
    const out = html(<Ring value={35} total={36} label="Bills" rest="waiting" />);
    expect(out).toContain("var(--wait)");
    expect(out).toContain("97%");
    const none = html(<Ring value={0} total={0} label="None" />);
    expect(none).toContain("0%");
    expect(none).not.toContain("ring-seg");
  });
  it("turns a bullet red past its limit", () => {
    expect(html(<BulletBar actual={70} limit={60} label="Spend" />)).toContain("var(--bad)");
    expect(
      html(
        <BulletBar actual={5} limit={60} marker={{ value: 2.5, label: "per PO" }} label="Spend" />,
      ),
    ).toContain("per PO");
  });
  it("counts values into bins and marks bars past the limit", () => {
    const out = html(
      <Histogram
        values={[100, 400, 2400, 5150]}
        bins={[0, 500, 1000, 2500]}
        limit={2500}
        label="PO sizes"
      />,
    );
    expect(out.match(/histo-bar/g)?.length).toBe(4);
    expect(out).toContain("var(--wait)");
    expect(out).toContain("spark-rule strong");
  });
});

describe("chips, links, timeline, stepper", () => {
  it("maps the status vocabulary to tones", () => {
    expect(statusTone("refused")).toBe("refused");
    expect(statusTone("funded")).toBe("held");
    expect(statusTone("needs Linda")).toBe("waiting");
    expect(statusTone("something new")).toBe("neutral");
    expect(html(<StatusChip status="paid" />)).toContain("pill paid");
  });
  it("renders a record link as a button with its id", () => {
    const out = html(<RecordLink id="PO-1042" page="purchasing" />);
    expect(out).toContain("<button");
    expect(out).toContain("PO-1042");
  });
  it("renders nothing for an empty timeline and a card per event", () => {
    expect(html(<Timeline items={[]} label="x" />)).toBe("");
    const out = html(
      <Timeline
        label="Run"
        items={[
          { key: "a", title: "Ray confirms", who: "RD", chip: { label: "posted", tone: "ok" } },
          {
            key: "b",
            title: "Refused",
            chip: { label: "refused", tone: "refused" },
            open: { id: "PO-1042" },
          },
        ]}
      />,
    );
    expect(out.match(/<li/g)?.length).toBe(2);
    expect(out).toContain("t-refused");
  });
  it("marks each stage of a stepper", () => {
    const out = html(
      <Stepper
        label="PO"
        stages={[
          { label: "Draft", state: "done" },
          { label: "Approval", state: "failed" },
          { label: "Paid", state: "todo" },
        ]}
      />,
    );
    expect(out).toContain("✓");
    expect(out).toContain("✗");
    expect(out).toContain("○");
  });
});

describe("states", () => {
  it("shapes skeletons like their content", () => {
    expect(html(<Skeleton shape="tiles" count={3} />).match(/sk-tile/g)?.length).toBe(3);
    expect(html(<Skeleton shape="table" count={5} />).match(/sk-row/g)?.length).toBe(5);
  });
  it("keeps the raw error behind Details", () => {
    const out = html(<ErrorCard what="The orders" error="HTTP 500" retry={() => {}} />);
    expect(out).toContain("The orders could not be read.");
    expect(out).toContain("<details>");
    expect(out).toContain("Try again");
  });
  it("offers a next action when empty", () => {
    expect(
      html(
        <EmptyState title="No open POs right now." action={{ label: "Jump", onClick: () => {} }} />,
      ),
    ).toContain("Jump →");
  });
});

describe("DataTable", () => {
  const cols: Column<{ id: string; n: number }>[] = [
    { key: "id", label: "Id", render: (r) => r.id, text: (r) => r.id },
    { key: "n", label: "N", render: (r) => r.n, numeric: true },
  ];
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `PO-${1000 + i}`, n: i }));

  it("draws every row of a short table", () => {
    const out = html(<DataTable rows={rows(10)} columns={cols} rowKey={(r) => r.id} label="POs" />);
    expect(out.match(/<tr>/g)?.length).toBe(11);
  });
  it("draws only the rows in view of a long one", () => {
    const out = html(
      <DataTable rows={rows(400)} columns={cols} rowKey={(r) => r.id} label="POs" />,
    );
    const drawn = out.match(/<tr style/g)?.length ?? 0;
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(80);
    expect(out).toContain("spacer");
  });
  it("starts filtered by the page filter and shows an empty state when nothing matches", () => {
    const out = html(
      <DataTable rows={rows(10)} columns={cols} rowKey={(r) => r.id} label="POs" query="PO-1003" />,
    );
    expect(out).toContain("1 of 10");
    const none = html(
      <DataTable rows={rows(3)} columns={cols} rowKey={(r) => r.id} label="POs" query="zzz" />,
    );
    expect(none).toContain("Nothing matches.");
  });
  it("shows its empty state for no rows", () => {
    expect(html(<DataTable rows={[]} columns={cols} rowKey={(r) => r.id} label="POs" />)).toContain(
      "Nothing here yet.",
    );
  });
});

describe("windows", () => {
  it("counts a day in the window ending on the clock's day", () => {
    expect(inWindow("2026-11-09", "2026-11-09", 28)).toBe(true);
    expect(inWindow("2026-10-12", "2026-11-09", 28)).toBe(false);
    expect(inWindow("2026-10-13", "2026-11-09", 28)).toBe(true);
    expect(inWindow("2026-10-12", "2026-11-09", 28, 1)).toBe(true);
  });
});
