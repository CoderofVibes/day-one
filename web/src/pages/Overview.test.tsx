import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { run } from "../run.ts";
import { Overview } from "./Overview.tsx";

const html = (at: number, onStep?: (i: number) => void) =>
  renderToStaticMarkup(
    <Overview
      plant="B"
      source={{ live: false, version: 0 }}
      inventory={null}
      map={<div />}
      kevin={<div />}
      activity={<div />}
      run={run}
      at={at}
      {...(onStep ? { onStep } : {})}
    />,
  );
const phoneAt = run.steps.findIndex((s) => s.title === "Linda texts");

describe("Overview", () => {
  it("makes Linda's text approval the hero card while the run waits on her", () => {
    const out = html(phoneAt - 1, () => {});
    expect(out).toContain("Linda&#x27;s text approval");
    expect(out).toContain("YES 1042");
    expect(out).toContain("NO 1042");
    expect(out).toContain("needs Linda");
  });
  it("shows her answer once she has replied, and no buttons live", () => {
    const out = html(phoneAt);
    expect(out).not.toContain("YES 1042</button>");
    expect(out).toContain("answered by text");
  });
  it("draws tile skeletons while the history loads", () => {
    expect(html(0)).toContain("sk-tile");
  });
});
