import { describe, expect, it } from "vitest";
import { GROUP_TWIN, groupRun } from "../groupBuy.ts";
import { run } from "../run.ts";
import { deriveTwinState } from "../twin/model.ts";
import { twinObjects } from "../twin/objects.ts";
import { SHORTCUTS, twinKey } from "./PlantView.tsx";
import {
  CAMERA_LIMITS,
  clampFraming,
  DEFAULT_VIEWPORT,
  FLY_MS,
  type Framing,
  framingFor,
  isPooled,
  objectFraming,
  projectPoint,
  targetBounds,
  VIEWS,
  type Viewport,
  viewFraming,
} from "./scene.ts";

const PHONE: Viewport = { width: 358, height: 268 };
const FULL: Viewport = { width: 1920, height: 1040 };

/** True when the camera-controls limits would leave this framing as it is. */
function withinLimits(f: Framing): boolean {
  const polar = Math.PI / 2 - f.elevation;
  const { min, max } = targetBounds();
  return (
    f.distance >= CAMERA_LIMITS.minDistance - 1e-9 &&
    f.distance <= CAMERA_LIMITS.maxDistance + 1e-9 &&
    polar >= CAMERA_LIMITS.minPolar - 1e-9 &&
    polar <= CAMERA_LIMITS.maxPolar + 1e-9 &&
    f.target.every((v, i) => v >= (min[i] as number) - 1e-9 && v <= (max[i] as number) + 1e-9)
  );
}

describe("camera presets", () => {
  it("has eight views on keys 1–8, named as the scene names its places", () => {
    expect(VIEWS.map((v) => v.key)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(VIEWS.map((v) => v.label)).toEqual([
      "Campus",
      "Hollow Pine",
      "Receiving & Warehouse",
      "Production",
      "QC Lab",
      "HQ & Escrow",
      "Suppliers",
      "Riverside & Lakeview",
    ]);
    expect(new Set(VIEWS.map((v) => v.id)).size).toBe(VIEWS.length);
  });

  it("lands every view within the camera's limits, wide, full screen and on a phone", () => {
    for (const v of VIEWS)
      for (const vp of [DEFAULT_VIEWPORT, FULL, PHONE]) {
        const f = viewFraming(v.id, vp);
        expect(f, v.id).toBeDefined();
        expect(withinLimits(f as Framing), `${v.id} ${vp.width}`).toBe(true);
      }
    expect(viewFraming("nowhere")).toBeUndefined();
  });

  it("leaves the story camera's shots inside the limits, so the controls never bend them", () => {
    for (const step of run.steps)
      for (const vp of [DEFAULT_VIEWPORT, FULL, PHONE]) {
        const f = framingFor(step.title, vp);
        expect(clampFraming(f), `${step.title} ${vp.width}`).toEqual(f);
      }
    groupRun.steps.forEach((step, i) => {
      const pooled = isPooled(deriveTwinState(groupRun, i, GROUP_TWIN));
      for (const vp of [DEFAULT_VIEWPORT, PHONE]) {
        const f = framingFor(step.title, vp, pooled);
        expect(clampFraming(f), `${step.title} ${vp.width}`).toEqual(f);
      }
    });
  });

  it("frames every object on the map and flies there in 1.2–1.8 s", () => {
    expect(FLY_MS).toBeGreaterThanOrEqual(1200);
    expect(FLY_MS).toBeLessThanOrEqual(1800);
    const s = deriveTwinState(run, run.steps.length - 1);
    for (const o of twinObjects(s)) {
      const f = objectFraming(o.focus);
      expect(withinLimits(f), o.id).toBe(true);
      expect(f.distance, o.id).toBeLessThan(400);
    }
  });

  it("keeps a flown-to object clear of the inspector on the right", () => {
    const vp = { width: 1280, height: 720 };
    const focus = { kind: "pad", pad: "escrow" } as const;
    const plain = objectFraming(focus, vp);
    const inset = objectFraming(focus, vp, 400);
    const at = (f: Framing) => projectPoint(f, plain.target, vp)?.[0] ?? Number.NaN;
    expect(at(plain)).toBeCloseTo(640, 0);
    expect(at(inset)).toBeCloseTo((1280 - 400) / 2, -1);
  });

  it("clamps the polar angle to 15°–80° and the distance", () => {
    const f = clampFraming({ target: [0, 0, 0], distance: 5000, azimuth: 0, elevation: 0.01 });
    expect(f.distance).toBe(CAMERA_LIMITS.maxDistance);
    expect(Math.PI / 2 - f.elevation).toBeCloseTo(CAMERA_LIMITS.maxPolar);
    const top = clampFraming({ target: [0, 0, 0], distance: 1, azimuth: 0, elevation: 1.5 });
    expect(top.distance).toBe(CAMERA_LIMITS.minDistance);
    expect(Math.PI / 2 - top.elevation).toBeCloseTo(CAMERA_LIMITS.minPolar);
  });
});

describe("twin keys", () => {
  it("maps F, Esc, ? and the view keys; 3–8 only in full screen", () => {
    expect(twinKey("f", false)).toEqual({ kind: "full" });
    expect(twinKey("F", true)).toEqual({ kind: "full" });
    expect(twinKey("Escape", true)).toEqual({ kind: "escape" });
    expect(twinKey("?", false)).toEqual({ kind: "help" });
    expect(twinKey("1", false)).toEqual({ kind: "view", id: "campus" });
    expect(twinKey("2", false)).toEqual({ kind: "view", id: "plant-b" });
    expect(twinKey("6", false)).toBeNull();
    expect(twinKey("6", true)).toEqual({ kind: "view", id: "money" });
    expect(twinKey("9", true)).toBeNull();
    expect(twinKey("x", true)).toBeNull();
  });

  it("documents every key it answers to", () => {
    const help = SHORTCUTS.map(([k]) => k).join(" ");
    for (const k of ["F", "Esc", "1–8", "?", "Tab", "Enter"]) expect(help).toContain(k);
  });
});
