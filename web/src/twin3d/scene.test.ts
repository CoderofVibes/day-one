import { describe, expect, it } from "vitest";
import { GROUP_TWIN, groupRun } from "../groupBuy.ts";
import { run } from "../run.ts";
import { DEPT_Z, FLOOR_Z } from "../twin/layout.ts";
import { DEPARTMENTS, deriveTwinState } from "../twin/model.ts";
import { topHeight } from "./buildings.ts";
import {
  anchor3,
  arc3,
  blendDepartments,
  blendEscrowCents,
  blendFlows,
  blendLots,
  cameraPosition,
  DEFAULT_VIEWPORT,
  depots,
  deptBox,
  dock3,
  ease,
  frameShot,
  framingFor,
  isPooled,
  labelPadScale,
  lerpFraming,
  objectFraming,
  objectShot,
  projectPoint,
  road3,
  shotFor,
  siteBounds,
  taskShot,
  type Viewport,
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
  it("anchors a flow above the roof over the department's main area", () => {
    const s = deriveTwinState(run, index("Delivery"));
    const [x, y, z] = anchor3({ kind: "dept", facility: "B", dept: "receiving" }, s);
    expect(y).toBe(FLOOR_Z + topHeight("receiving", "B") + 1);
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

  it("stops the truck at the dock outside the building, on the side it came from", () => {
    const s = deriveTwinState(run, index("Delivery"));
    const from = anchor3({ kind: "suppliers" }, s);
    const [dx, dy, dz] = dock3({ kind: "dept", facility: "B", dept: "receiving" }, from);
    const box = deptBox("B", "receiving");
    if (!box) throw new Error("no receiving at Plant B");
    expect(dy).toBeCloseTo(0.1);
    // The suppliers' pad lies beyond the receiving bay's far side (larger layout y).
    expect(dz).toBeCloseTo(box.y + box.d + 2.5);
    expect(dx).toBeCloseTo(box.x + box.w / 2);
    expect(dock3({ kind: "hq" }, from)[1]).toBeCloseTo(0.1);
  });

  it("keeps the whole site in the ground box", () => {
    const b = siteBounds();
    expect(b.min[0]).toBeLessThan(-40);
    expect(b.max[0]).toBeGreaterThan(80);
    expect(b.max[1]).toBeGreaterThan(70);
  });
});

/** How far a shot's subjects, labels included, reach past the frame at a viewport; 0 when they fit. */
function overrun(title: string, viewport: Viewport, pooled = false): number {
  const f = framingFor(title, viewport, pooled);
  let worst = 0;
  for (const s of shotFor(title, pooled).subjects) {
    const p = projectPoint(f, s.point, viewport);
    if (!p) return Number.POSITIVE_INFINITY;
    const pads = labelPadScale(viewport);
    const [hw, hh] = (s.padPx ?? [0, 0]).map((v) => v * pads) as [number, number];
    worst = Math.max(
      worst,
      hw - p[0],
      p[0] + hw - viewport.width,
      hh - p[1],
      p[1] + hh - viewport.height,
    );
  }
  return worst;
}

const PHONE: Viewport = { width: 325, height: 244 };

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

  it("keeps every step's subjects and their labels inside the frame, wide and on a phone", () => {
    for (const step of run.steps) {
      expect(overrun(step.title, DEFAULT_VIEWPORT), `${step.title} wide`).toBeLessThanOrEqual(0);
      expect(overrun(step.title, PHONE), `${step.title} phone`).toBeLessThanOrEqual(0);
    }
  });

  it("frames the group run too: both plants' purchasing and the vault once the PO is pooled", () => {
    groupRun.steps.forEach((step, i) => {
      const pooled = isPooled(deriveTwinState(groupRun, i, GROUP_TWIN));
      expect(pooled, step.title).toBe(i >= 4);
      expect(overrun(step.title, DEFAULT_VIEWPORT, pooled), `${step.title} wide`).toBe(0);
      expect(overrun(step.title, PHONE, pooled), `${step.title} phone`).toBe(0);
    });
    // The pooled money shot must see Plant A's purchasing roof, far to the west of the vault.
    const plain = framingFor("Kevin retries");
    const pooled = framingFor("Kevin retries", DEFAULT_VIEWPORT, true);
    expect(pooled.distance).toBeGreaterThan(plain.distance);
    expect(pooled.target[0]).toBeLessThan(plain.target[0]);
    const a = deptBox("A", "purchasing");
    if (!a) throw new Error("Plant A has no purchasing cell");
    const roof = projectPoint(pooled, [a.x + a.w / 2, FLOOR_Z + 6, a.y + a.d / 2]);
    expect(roof?.[0]).toBeGreaterThan(0);
    expect(roof?.[0]).toBeLessThan(DEFAULT_VIEWPORT.width);
    // Texts and the release follow the pooled shots; the demo run's own shots are unchanged.
    expect(shotFor("Dana texts", true)).toBe(shotFor("Pooled PO"));
    expect(shotFor("Linda texts")).toBe(shotFor("Big PO"));
    expect(shotFor("QC release", true)).not.toBe(shotFor("QC release"));
    expect(isPooled(deriveTwinState(run, run.steps.length - 1))).toBe(false);
  });

  it("stands farther back for a narrower stage, never closer than the shot allows", () => {
    const wide = framingFor("Load seed");
    const phone = framingFor("Load seed", PHONE);
    expect(phone.distance).toBeGreaterThan(wide.distance);
    expect(phone.target).toEqual(wide.target);
    // On a phone the labels are left out of the fit, or the site would shrink under them.
    expect(labelPadScale(PHONE)).toBe(0);
    expect(labelPadScale(DEFAULT_VIEWPORT)).toBe(1);
    expect(phone.distance).toBeLessThan(wide.distance * 2);
    // The quotes shot would fit from close up; its minimum keeps the plant in the background.
    expect(framingFor("Quotes").distance).toBe(shotFor("Quotes").minDistance);
    // The money shot's two pads and their labels stay in frame from its angle.
    const money = framingFor("Big PO");
    const [vault, hq] = [
      [63.5, 1, 13.5],
      [75.5, 1, -12.5],
    ] as const;
    for (const point of [vault, hq]) {
      const [px, py] = projectPoint(money, [...point], DEFAULT_VIEWPORT) ?? [-1, -1];
      expect(px).toBeGreaterThan(0);
      expect(px).toBeLessThan(DEFAULT_VIEWPORT.width);
      expect(py).toBeGreaterThan(0);
      expect(py).toBeLessThan(DEFAULT_VIEWPORT.height);
    }
  });

  it("frames a shot around the middle of its subjects and puts the target between them", () => {
    const f = frameShot({
      subjects: [{ point: [0, 0, 0] }, { point: [40, 0, 0] }],
      azimuth: 0,
      elevation: 0.5,
    });
    expect(f.target[0]).toBeCloseTo(20);
    expect(projectPoint(f, [20, 0, 0])?.[0]).toBeCloseTo(DEFAULT_VIEWPORT.width / 2);
    // A label's pixels widen the frame: the same points need a farther camera.
    const padded = frameShot({
      subjects: [
        { point: [0, 0, 0], padPx: [100, 20] },
        { point: [40, 0, 0], padPx: [100, 20] },
      ],
      azimuth: 0,
      elevation: 0.5,
    });
    expect(padded.distance).toBeGreaterThan(f.distance);
    expect(projectPoint(f, [0, 0, 0])?.[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("a task's shot", () => {
  const purchasing = { kind: "dept", facility: "B", dept: "purchasing" } as const;
  const escrow = { kind: "pad", pad: "escrow" } as const;

  it("is the object's own shot when the task touches nothing else", () => {
    expect(taskShot(purchasing)).toEqual(objectShot(purchasing));
  });

  it("adds the other places at the object's angle, and pulls back to fit them", () => {
    const shot = taskShot(purchasing, [escrow]);
    expect(shot.azimuth).toBe(objectShot(purchasing).azimuth);
    expect(shot.subjects.length).toBe(
      objectShot(purchasing).subjects.length + objectShot(escrow).subjects.length,
    );
    const alone = objectFraming(purchasing, DEFAULT_VIEWPORT, 400);
    const both = objectFraming(purchasing, DEFAULT_VIEWPORT, 400, [escrow]);
    expect(both.distance).toBeGreaterThan(alone.distance);
  });
});
