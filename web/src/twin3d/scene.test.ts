import { describe, expect, it } from "vitest";
import { run } from "../run.ts";
import { DEPT_Z, FLOOR_Z } from "../twin/layout.ts";
import { DEPARTMENTS, deriveTwinState } from "../twin/model.ts";
import {
  anchor3,
  arc3,
  blendDepartments,
  blendEscrowCents,
  blendFlows,
  blendLots,
  cameraPosition,
  depots,
  ease,
  framingFor,
  lerpFraming,
  road3,
  siteBounds,
} from "./scene.ts";

const index = (title: string) => {
  const i = run.steps.findIndex((s) => s.title === title);
  if (i < 0) throw new Error(`no step "${title}" in the recorded run`);
  return i;
};
const pair = (title: string) => {
  const i = index(title);
  return [deriveTwinState(run, i - 1), deriveTwinState(run, i)] as const;
};

describe("transitions between steps", () => {
  it("eases from 0 to 1 and stays inside", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(0.25)).toBeLessThan(0.25);
  });

  it("raises Plant B's batch-record departments from grey to online, with a glow that fades", () => {
    const [prev, next] = pair("Ray confirms");
    const at = (u: number) =>
      blendDepartments(prev, next, u).find((d) => d.facility === "B" && d.code === "blending");
    expect(at(0)).toMatchObject({
      height: DEPT_Z.onboarding,
      from: "onboarding",
      look: "online",
      glow: 1,
    });
    expect(at(1)).toMatchObject({ height: DEPT_Z.online, mix: 1, glow: 0, breathe: false });
    const mid = at(0.5);
    expect(mid?.height).toBeGreaterThan(DEPT_Z.onboarding);
    expect(mid?.height).toBeLessThan(DEPT_Z.online);
    // Plants A and C stand steady at full height throughout.
    for (const d of blendDepartments(prev, next, 0.3).filter((d) => d.facility !== "B"))
      expect(d).toMatchObject({ look: "steady", height: DEPT_Z.online, glow: 0 });
    // Every department of every plant is drawn exactly once.
    const all = blendDepartments(prev, next, 1);
    const expected = DEPARTMENTS.flatMap((d) => d.plants.map((p) => `${p}:${d.code}`)).sort();
    expect(all.map((d) => `${d.facility}:${d.code}`).sort()).toEqual(expected);
  });

  it("flies the refused PO at the vault and bounces it back", () => {
    const [prev, next] = pair("Big PO");
    const refused = (u: number) =>
      blendFlows(prev, next, u).find((f) => f.flow.id === "refused-PO-1042");
    expect(refused(0)?.progress).toBe(0);
    expect(refused(0.55)?.progress).toBeCloseTo(0.7);
    expect(refused(0.55)?.hit).toBe(1);
    const rest = refused(1);
    expect(rest?.progress).toBeCloseTo(0.48);
    expect(rest?.hit).toBe(0);
    expect(rest?.leaving).toBe(false);
  });

  it("lets the funded PO replace the refused one: the old arc fades while the coin lands", () => {
    const [prev, next] = pair("Kevin retries");
    const frames = blendFlows(prev, next, 0.5);
    const old = frames.find((f) => f.flow.id === "refused-PO-1042");
    const fund = frames.find((f) => f.flow.id === "fund-PO-1042");
    expect(old?.leaving).toBe(true);
    expect(old?.alpha).toBeCloseTo(0.5);
    expect(fund?.progress).toBeCloseTo(0.5);
    expect(blendFlows(prev, next, 1).find((f) => f.flow.id === "refused-PO-1042")?.alpha).toBe(0);
    expect(blendEscrowCents(prev, next, 0)).toBe(61_200);
    expect(blendEscrowCents(prev, next, 1)).toBe(576_200);
  });

  it("drives the truck halfway while shipping and the rest of the way at delivery", () => {
    const [p1, n1] = pair("Supplier ships");
    const ship = (u: number) => blendFlows(p1, n1, u).find((f) => f.flow.id === "ship-PO-1042");
    expect(ship(0)?.progress).toBe(0);
    expect(ship(1)?.progress).toBe(0.5);
    const [p2, n2] = pair("Delivery");
    const arrive = (u: number) => blendFlows(p2, n2, u).find((f) => f.flow.id === "ship-PO-1042");
    expect(arrive(0)?.progress).toBe(0.5);
    expect(arrive(1)?.progress).toBe(1);
  });

  it("drops the cage over the lot at delivery and lifts it on release", () => {
    const [p1, n1] = pair("Delivery");
    expect(blendLots(p1, n1, 0)[0]).toMatchObject({ drop: 12, cage: 1, decided: 0 });
    expect(blendLots(p1, n1, 1)[0]).toMatchObject({ drop: 0, cage: 1, decided: 0 });
    const [p2, n2] = pair("QC release");
    expect(blendLots(p2, n2, 0)[0]).toMatchObject({ drop: 0, cage: 1, decided: 0 });
    expect(blendLots(p2, n2, 1)[0]).toMatchObject({ drop: 6, cage: 0, decided: 1 });
    expect(blendLots(p2, n2, 1)[0]?.lot.state).toBe("released");
  });

  it("names the three depots once the quotes are in, coloured by standing", () => {
    const before = depots(deriveTwinState(run, index("Forecast")));
    expect(before).toHaveLength(3);
    expect(before.every((d) => d.quote === undefined)).toBe(true);
    const after = depots(deriveTwinState(run, index("Quotes")));
    expect(after.map((d) => d.quote?.standing)).toEqual(["excluded", "selected", "runner-up"]);
    expect(after[0]?.position[1]).toBe(1);
  });
});

describe("paths and anchors", () => {
  it("anchors a flow above the department roof at its current height", () => {
    const s = deriveTwinState(run, index("Delivery"));
    const [x, y, z] = anchor3({ kind: "dept", facility: "B", dept: "receiving" }, s);
    expect(y).toBe(FLOOR_Z + DEPT_Z.online + 1);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
    const [, py] = anchor3({ kind: "escrow" }, s);
    expect(py).toBe(2);
  });

  it("arcs rise over the site and roads stay on the ground", () => {
    const arc = arc3([0, 2, 0], [60, 2, 0]);
    expect(arc.at(0)).toEqual([0, 2, 0]);
    expect(arc.at(1)).toEqual([60, 2, 0]);
    expect(arc.at(0.5)[1]).toBeGreaterThan(10);
    const road = road3([0, 2, 0], [0, 2, 60]);
    expect(road.at(0.5)[1]).toBeCloseTo(0.1);
    expect(Math.abs(road.at(0.5)[0])).toBeGreaterThan(5);
    expect(road.points).toHaveLength(41);
    // Heading points along the way: at the end of a road running along +z it is about 0.
    expect(Math.abs(road.heading(1))).toBeLessThan(0.6);
  });

  it("keeps the whole site in the ground box", () => {
    const b = siteBounds();
    expect(b.min[0]).toBeLessThan(-40);
    expect(b.max[0]).toBeGreaterThan(80);
    expect(b.max[1]).toBeGreaterThan(70);
  });
});

describe("story camera", () => {
  it("has a framing for every step of the recorded run and eases between them", () => {
    for (const step of run.steps) {
      const f = framingFor(step.title);
      expect(f.distance).toBeGreaterThan(20);
      const [, y] = cameraPosition(f);
      expect(y, step.title).toBeGreaterThan(f.target[1]);
    }
    const a = framingFor("Load seed");
    const b = framingFor("Big PO");
    expect(lerpFraming(a, b, 0)).toEqual(a);
    expect(lerpFraming(a, b, 1)).toEqual(b);
    expect(lerpFraming(a, b, 0.5).distance).toBeCloseTo((a.distance + b.distance) / 2);
    // The camera looks in from the +x +z corner, like the flat map's isometric view.
    const [x, , z] = cameraPosition(a);
    expect(x).toBeGreaterThan(a.target[0]);
    expect(z).toBeGreaterThan(a.target[2]);
  });
});
