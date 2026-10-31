import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import pages from "./data/pages.json";
import { turnFromStep } from "./desk.ts";
import { OrderDesk } from "./OrderDesk.tsx";
import type { PoView } from "./reads.ts";
import { run } from "./run.ts";

const html = (at: number, end: string) =>
  renderToStaticMarkup(
    <OrderDesk
      run={run}
      at={at}
      turn={turnFromStep(run.steps, at + 1)}
      orders={pages.plant.B.orders as PoView[]}
      end={end}
      inventory={null}
      actions={<button type="button">act</button>}
      onShow={() => {}}
    />,
  );
const at = (title: string) => run.steps.findIndex((s) => s.title === title);

describe("Order desk", () => {
  it("opens on Linda's decision, with the queue grouped beside it", () => {
    const out = html(at("Big PO"), "2026-11-09");
    expect(out).toContain("Needs a decision");
    expect(out).toContain("In flight");
    expect(out).toContain("Closed");
    expect(out).toContain("Approve PO-1042");
    expect(out).toContain("What you decide");
  });

  it("shows how PO-1042 closed once it is paid", () => {
    const out = html(at("Paid"), "2026-11-16");
    expect(out).not.toContain("Needs a decision");
    expect(out).toContain("PO-1041");
    expect(out).toContain("money set aside");
  });
});
