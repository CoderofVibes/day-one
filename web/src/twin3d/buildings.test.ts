import { describe, expect, it } from "vitest";
import { run } from "../run.ts";
import { DEPT_Z, FLOOR_Z } from "../twin/layout.ts";
import { deriveTwinState } from "../twin/model.ts";
import { BUILDING_HEIGHT, bodyHeight, buildingParts, rise, topHeight } from "./buildings.ts";
import { blendDepartments } from "./scene.ts";

const at = (i: number) => deriveTwinState(run, i);

describe("buildings", () => {
  it("rises from a foundation to full height as the department comes online", () => {
    expect(rise(DEPT_Z.offline)).toBe(0);
    expect(rise(DEPT_Z.online)).toBe(1);
    expect(bodyHeight("purchasing", DEPT_Z.offline)).toBe(DEPT_Z.offline);
    expect(bodyHeight("purchasing", DEPT_Z.online)).toBe(BUILDING_HEIGHT.purchasing);
    expect(topHeight("weigh_dispense", DEPT_Z.online)).toBeGreaterThan(
      bodyHeight("weigh_dispense", DEPT_Z.online),
    );
  });

  it("gives a grey department a body only, and an online one its roof, doors and windows", () => {
    const start = blendDepartments(at(0), at(0), 1);
    const grey = start.find((d) => d.facility === "B" && d.code === "warehouse");
    if (!grey) throw new Error("no warehouse");
    expect(buildingParts(grey).map((p) => p.kind)).toEqual(["body"]);

    const last = blendDepartments(at(run.steps.length - 1), at(run.steps.length - 1), 1);
    const kinds = (code: string, facility = "B") =>
      buildingParts(last.find((d) => d.facility === facility && d.code === code) ?? grey).map(
        (p) => p.kind,
      );
    expect(kinds("receiving")).toContain("gable");
    expect(kinds("receiving")).toContain("dock");
    expect(kinds("receiving").filter((k) => k === "door")).toHaveLength(2);
    expect(kinds("weigh_dispense").filter((k) => k === "silo")).toHaveLength(2);
    expect(kinds("weigh_dispense").filter((k) => k === "saw")).toHaveLength(3);
    expect(kinds("blending")).toContain("tank");
    expect(kinds("compression")).toContain("stack");
    expect(kinds("purchasing").filter((k) => k === "window").length).toBeGreaterThan(12);
    expect(kinds("qc_lab")).toContain("window");
    expect(kinds("packaging", "A").filter((k) => k === "vent")).toHaveLength(3);
    // Plant A's warehouse stands at full height with its roof on, as it was before day one.
    expect(kinds("warehouse", "A")).toContain("gable");
  });

  it("keeps every part inside its cell and above the floor", () => {
    const last = blendDepartments(at(run.steps.length - 1), at(run.steps.length - 1), 1);
    for (const d of last) {
      for (const p of buildingParts(d)) {
        expect(p.position[1], `${d.code} ${p.kind}`).toBeGreaterThanOrEqual(FLOOR_Z);
        expect(p.position[0] - p.scale[0] / 2).toBeGreaterThanOrEqual(d.box.x - 0.2);
        expect(p.position[0] + p.scale[0] / 2).toBeLessThanOrEqual(d.box.x + d.box.w + 0.2);
        expect(p.position[2] - p.scale[2] / 2).toBeGreaterThanOrEqual(d.box.y - 0.2);
        // The receiving dock stands in front of the building, in the gap between cells.
        const slack = p.kind === "dock" ? 2 : 0.2;
        expect(p.position[2] + p.scale[2] / 2).toBeLessThanOrEqual(d.box.y + d.box.d + slack);
      }
    }
  });
});
