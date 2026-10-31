import { describe, expect, it } from "vitest";
import { underControl } from "./keepout.ts";

describe("labels keep clear of the overlay controls", () => {
  // The Views pill at the top left and the zoom buttons at the top right of a 640 px stage.
  const boxes = [
    { left: 10, top: 10, right: 250, bottom: 46 },
    { left: 520, top: 10, right: 630, bottom: 46 },
  ];

  it("finds a label drawn under the Views pill or the zoom buttons", () => {
    expect(underControl(100, 30, 120, 20, boxes)).toBe(true);
    expect(underControl(560, 40, 60, 20, boxes)).toBe(true);
  });

  it("lets a label sit beside or below a control, touching by a pixel or two", () => {
    expect(underControl(100, 80, 120, 20, boxes)).toBe(false);
    expect(underControl(380, 30, 120, 20, boxes)).toBe(false);
    // Its top edge one pixel into the pill's bottom.
    expect(underControl(100, 55, 120, 20, boxes)).toBe(false);
    expect(underControl(100, 30, 120, 20, [])).toBe(false);
  });
});
