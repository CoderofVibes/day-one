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
function Both({ clock, plant = "B" }: { clock: Clock; plant?: "A" | "B" | "C" }) {
  const kevin = useKevinStatus(clock, context);
  return (
    <>
      <GlobalHeader
        title="Overview"
        plant={plant}
        onPlant={() => {}}
        clock={null}
        kevin={kevin}
        onKevin={() => {}}
        curtain={false}
        setCurtain={() => {}}
        people={[]}
        upNext={{ name: "Ray Delgado", role: null }}
      />
      <ActivityRail
        clock={clock}
        context={context}
        curtain={false}
        go={() => {}}
        actions={null}
        plant={plant}
      />
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
      // The feed filtered to another plant still reads Kevin's one status.
      const riverside = renderToStaticMarkup(<Both clock={clock} plant="A" />);
      expect(feedOf(riverside)?.slice(1), `step ${i} at A`).toEqual(chip?.slice(1));
      seen.add(chip?.[2] ?? "");
    });
    // The run moves through several states, not one label throughout.
    expect(seen.has("waiting on Linda")).toBe(true);
    expect(seen.has("signed")).toBe(true);
    expect(seen.size).toBeGreaterThan(3);
  });

  it("shows the header plant's lines with an All plants chip", () => {
    const clock = createClock({ history: plantsSnapshot, steps: run.steps, frames: null });
    clock.seek(clock.range.steps.at(-1) as number);
    const b = renderToStaticMarkup(<Both clock={clock} />);
    const a = renderToStaticMarkup(<Both clock={clock} plant="A" />);
    expect(b).toContain(">Hollow Pine</button>");
    expect(a).toContain(">Acme Riverside</button>");
    expect(a).toContain(">All plants</button>");
    expect(b).toContain("PO-1042");
    expect(a).not.toContain("PO-1042");
  });
});
