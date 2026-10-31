import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityRail, useKevinStatus } from "./ActivityRail.tsx";
import type { FeedContext } from "./activity.ts";
import { type Clock, createClock } from "./clock.ts";
import { GlobalHeader } from "./Header.tsx";
import { plantsSnapshot } from "./plants.ts";
import { run } from "./run.ts";

const context: FeedContext = { steps: run.steps, approvals: run.approvals };

/** The header and the feed over one clock, as the Overview draws them. */
function Both({ clock }: { clock: Clock }) {
  const kevin = useKevinStatus(clock, context);
  return (
    <>
      <GlobalHeader
        title="Overview"
        plant="B"
        onPlant={() => {}}
        clock={null}
        kevin={kevin}
        onKevin={() => {}}
        curtain={false}
        setCurtain={() => {}}
        people={[]}
        upNext={{ name: "Ray Delgado", role: null }}
      />
      <ActivityRail clock={clock} context={context} curtain={false} go={() => {}} actions={null} />
    </>
  );
}

const chipOf = (html: string) =>
  html.match(/class="gh-kevin ([a-z]+)"[\s\S]*?<span class="sr-only">Kevin: <\/span>([^<]*)</);
const feedOf = (html: string) => html.match(/class="feed-state ([a-z]+)">([^<]*)</);

describe("Kevin's status: header chip and feed", () => {
  it("say the same thing at every step of the recorded run", () => {
    const clock = createClock({ history: plantsSnapshot, steps: run.steps, frames: null });
    const seen = new Set<string>();
    clock.range.steps.forEach((t, i) => {
      clock.seek(t);
      const html = renderToStaticMarkup(<Both clock={clock} />);
      const chip = chipOf(html);
      const feed = feedOf(html);
      expect(chip, `step ${i}`).not.toBeNull();
      expect(chip?.slice(1), `step ${i}: ${run.steps[i]?.title}`).toEqual(feed?.slice(1));
      seen.add(chip?.[2] ?? "");
    });
    // The run moves through several states, not one label throughout.
    expect(seen.has("waiting on Linda")).toBe(true);
    expect(seen.has("signed")).toBe(true);
    expect(seen.size).toBeGreaterThan(3);
  });
});
