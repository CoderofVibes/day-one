import { describe, expect, it } from "vitest";
import { nextTurn, PEOPLE } from "./chrome.ts";
import { run, type Step } from "./run.ts";

const steps = run.steps;
const at = (title: string) => steps.findIndex((s) => s.title === title);

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
