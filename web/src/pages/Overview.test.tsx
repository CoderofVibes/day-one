import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { turnFromStep } from "../desk.ts";
import { reviewSnapshot } from "../mail.ts";
import { run } from "../run.ts";
import { Overview } from "./Overview.tsx";

const html = (at: number) =>
  renderToStaticMarkup(
    <Overview
      plant="B"
      source={{ live: false, version: 0 }}
      inventory={null}
      map={() => <div />}
      kevin={<div />}
      activity={<div />}
      run={run}
      at={at}
      turn={turnFromStep(run.steps, at + 1)}
      review={reviewSnapshot}
      inbox={null}
      deskActions={<button type="button">act</button>}
    />,
  );
const phoneAt = run.steps.findIndex((s) => s.title === "Linda texts");

describe("Overview", () => {
  it("puts Linda's decision on the desk with why, what and what next while the run waits on her", () => {
    const out = html(phoneAt - 1);
    expect(out).toContain("Approve PO-1042");
    expect(out).toContain("Why you");
    expect(out).toContain("What you decide");
    expect(out).toContain("What happens next");
    expect(out).toContain("Kevin&#x27;s limit $2,500");
    expect(out).toContain("YES 1042");
  });
  it("files her answer under what was handled and keeps the payment's condition in view", () => {
    const out = html(phoneAt);
    expect(out).not.toContain("Approve PO-1042</h3>");
    expect(out).toContain("Linda approved PO-1042 by text");
    expect(out).toContain("Nothing needs you right now");
  });
  it("draws tile skeletons while the history loads", () => {
    expect(html(0)).toContain("sk-tile");
  });
});
