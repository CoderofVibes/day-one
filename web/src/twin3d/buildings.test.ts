import { describe, expect, it } from "vitest";
import { run } from "../run.ts";
import { AREAS, type AreaCode, FACILITY_LAYOUTS, FLOOR_Z } from "../twin/layout.ts";
import { deriveTwinState } from "../twin/model.ts";
import {
  BUILDING_HEIGHT,
  bodyHeight,
  facilityParts,
  siteParts,
  siteTop,
  topHeight,
} from "./buildings.ts";
import { blendDepartments } from "./scene.ts";

const at = (i: number) => deriveTwinState(run, i);
const frames = (i: number) => blendDepartments(at(i), at(i), 1);
const layout = (id: "A" | "B" | "C") => {
  const l = FACILITY_LAYOUTS.find((f) => f.id === id);
  if (!l) throw new Error(`no plant ${id}`);
  return l;
};

describe("the site plan (docs/VISION.md §6.12.1)", () => {
  it("lays Hollow Pine out as five buildings holding all twenty areas", () => {
    const b = layout("B");
    expect(b.buildings.map((x) => x.kind).sort()).toEqual(
      ["dryside", "lab", "office", "processing", "warehouse"].sort(),
    );
    expect(b.zones.map((z) => z.area).sort()).toEqual((Object.keys(AREAS) as AreaCode[]).sort());
    for (const z of b.zones) {
      const home = b.buildings.find((x) => x.kind === z.building);
      if (!home) throw new Error(`${z.area} has no building`);
      expect(z.box.x).toBeGreaterThanOrEqual(home.box.x - 1e-9);
      expect(z.box.y).toBeGreaterThanOrEqual(home.box.y - 1e-9);
      expect(z.box.x + z.box.w).toBeLessThanOrEqual(home.box.x + home.box.w + 1e-9);
      expect(z.box.y + z.box.d).toBeLessThanOrEqual(home.box.y + home.box.d + 1e-9);
    }
  });

  it("gives Riverside the kit without a powder line and Lakeview a warehouse, dry side and office", () => {
    const a = layout("A").zones.map((z) => z.area);
    expect(a).not.toContain("powder_fill");
    expect(a).toHaveLength(19);
    expect(
      layout("C")
        .buildings.map((x) => x.kind)
        .sort(),
    ).toEqual(["dryside", "office", "warehouse"]);
    expect(layout("C").zones.map((z) => z.area)).not.toContain("qc_lab");
  });

  it("covers each building with its areas, edge to edge", () => {
    for (const f of FACILITY_LAYOUTS)
      for (const b of f.buildings) {
        const area = f.zones
          .filter((z) => z.building === b.kind)
          .reduce((s, z) => s + z.box.w * z.box.d, 0);
        expect(area, `${f.id} ${b.kind}`).toBeCloseTo(b.box.w * b.box.d, 6);
      }
  });

  it("keeps the buildings apart and inside the lot", () => {
    for (const f of FACILITY_LAYOUTS) {
      for (const b of [...f.buildings.map((x) => x.box), ...f.decor.map((x) => x.box)]) {
        expect(b.x).toBeGreaterThanOrEqual(f.floor.x);
        expect(b.y).toBeGreaterThanOrEqual(f.floor.y);
        expect(b.x + b.w).toBeLessThanOrEqual(f.floor.x + f.floor.w);
        expect(b.y + b.d).toBeLessThanOrEqual(f.floor.y + f.floor.d);
      }
      for (const p of f.buildings)
        for (const q of f.buildings) {
          if (p === q) continue;
          const apart =
            p.box.x + p.box.w <= q.box.x ||
            q.box.x + q.box.w <= p.box.x ||
            p.box.y + p.box.d <= q.box.y ||
            q.box.y + q.box.d <= p.box.y;
          expect(apart, `${f.id} ${p.kind}/${q.kind}`).toBe(true);
        }
    }
  });
});

describe("buildings", () => {
  it("stands every building from the start; heights come from the kit, scaled per plant", () => {
    expect(bodyHeight("purchasing")).toBe(BUILDING_HEIGHT.office);
    expect(bodyHeight("purchasing", "A")).toBeCloseTo(BUILDING_HEIGHT.office * 0.7);
    expect(topHeight("weigh_dispense")).toBeGreaterThan(bodyHeight("weigh_dispense"));
    expect(siteTop("B")).toBe(Math.max(...layout("B").departments.map((d) => topHeight(d.code))));
    const kinds = (parts: { part: { kind: string } }[]) => parts.map((p) => p.part.kind);
    const grey = kinds(
      facilityParts(
        layout("B"),
        frames(0).filter((d) => d.facility === "B"),
      ),
    );
    const lit = kinds(
      facilityParts(
        layout("B"),
        frames(run.steps.length - 1).filter((d) => d.facility === "B"),
      ),
    );
    // The same plant before and after: nothing is built on day one, only lit.
    expect(grey).toEqual(lit);
    expect(grey.filter((k) => k === "body")).toHaveLength(6); // five buildings and the gatehouse
    expect(grey.filter((k) => k === "silo").length).toBeGreaterThanOrEqual(5); // weigh cells, utilities
    expect(grey).toContain("tank");
    expect(grey.filter((k) => k === "saw").length).toBeGreaterThanOrEqual(5);
    expect(grey.filter((k) => k === "window").length).toBeGreaterThan(60);
    expect(grey.filter((k) => k === "tree").length).toBeGreaterThan(10);
    expect(grey).toContain("dock");
  });

  it("colours each area by its department: the hall's glass lights when the batch record is confirmed", () => {
    const step = run.steps.findIndex((s) => s.title === "Ray confirms");
    const tint = (i: number, area: AreaCode) =>
      siteParts(frames(i)).find(
        (p) =>
          p.dept?.facility === "B" &&
          p.dept.code === AREAS[area].dept &&
          (p.part.tint === "roof" || p.part.tint === "zone"),
      )?.dept?.look;
    expect(tint(0, "formulation")).toBe("offline");
    expect(tint(step, "formulation")).toBe("online");
    expect(tint(step, "weigh_cells")).toBe("online");
    // Riverside was on Acme's systems before day one.
    const riverside = siteParts(frames(0)).filter((p) => p.dept?.facility === "A");
    expect(riverside.every((p) => p.dept?.look === "steady")).toBe(true);
  });

  it("keeps every part on the slab and inside its lot", () => {
    for (const f of FACILITY_LAYOUTS) {
      for (const { part } of facilityParts(
        f,
        frames(0).filter((d) => d.facility === f.id),
      )) {
        expect(part.position[1], `${f.id} ${part.kind}`).toBeGreaterThanOrEqual(FLOOR_Z);
        expect(part.position[0] - part.scale[0] / 2).toBeGreaterThanOrEqual(f.floor.x - 1);
        expect(part.position[0] + part.scale[0] / 2).toBeLessThanOrEqual(f.floor.x + f.floor.w + 1);
        expect(part.position[2] - part.scale[2] / 2).toBeGreaterThanOrEqual(f.floor.y - 1);
        expect(part.position[2] + part.scale[2] / 2).toBeLessThanOrEqual(f.floor.y + f.floor.d + 1);
      }
    }
  });
});
