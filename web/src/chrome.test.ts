import { describe, expect, it } from "vitest";
import { kevinStatus, nextTurn, PEOPLE } from "./chrome.ts";
import { audienceOf, run, type Step } from "./run.ts";

const steps = run.steps;
const at = (title: string) => steps.findIndex((s) => s.title === title);
const statusAt = (i: number) =>
  kevinStatus(steps[i], i + 1 < steps.length ? audienceOf(steps[i + 1] as Step).name : null);

describe("Kevin's status in the header", () => {
  it("follows the recorded run: reading, signed, waiting on Linda, paying", () => {
    expect(statusAt(0).label).toBe("idle");
    expect(statusAt(steps.findIndex((s) => s.title.startsWith("Upload "))).state).toBe("reading");
    expect(statusAt(at("Ray confirms")).label).toBe("signed ✓");
    expect(statusAt(at("Big PO")).label).toBe("waiting on Linda");
    expect(statusAt(at("Kevin retries")).state).toBe("paying");
    expect(statusAt(at("QC release")).state).toBe("paying");
    expect(statusAt(at("Paid")).label).toBe("signed ✓");
    expect(statusAt(steps.length - 1).label).toBe("idle");
  });

  it("names one of the brief's six states at every step", () => {
    const states = new Set(["idle", "reading", "drafting", "waiting", "paying", "signed"]);
    steps.forEach((_, i) => {
      expect(states.has(statusAt(i).state)).toBe(true);
    });
  });
});

describe("each person's next turn", () => {
  it("finds Ray, Linda, Priya and Marcy's turns from the start of the run", () => {
    const titles = PEOPLE.map((p) => {
      const turn = nextTurn(steps, 0, p.name);
      return turn === null ? null : (steps[turn] as Step).title;
    });
    expect(titles[0]).toMatch(/^Upload /);
    expect(titles[1]).toMatch(/ texts$/);
    expect(titles[2]).toBe("Paid");
    expect(titles[3]).toBe("QC release");
  });

  it("has nothing waiting once a person's last turn is behind", () => {
    expect(nextTurn(steps, at("Paid"), "Marcy Allen")).toBeNull();
  });
});
