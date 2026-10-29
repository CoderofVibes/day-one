// The pure half of the 3D twin (docs/TWIN3D.md): where things stand, where the camera looks
// and how one TwinState becomes the next. Everything here is a function of the two states
// and a number u in [0, 1] from the demo clock, so the view is the same on every run and
// testable without a GPU. Positions come from the same layout.ts the flat map uses: a layout
// point (x, y) is the world point (x, 0, y), and heights are the same DEPT_Z and FLOOR_Z.

import { type Box, DEPT_Z, FACILITY_LAYOUTS, FLOOR_Z, PAD_Z, PADS } from "../twin/layout.ts";
import type {
  DeptCode,
  DeptStatus,
  FacilityId,
  Flow,
  NodeRef,
  TwinLot,
  TwinQuote,
  TwinState,
} from "../twin/model.ts";
import { topHeight } from "./buildings.ts";

export type V3 = [number, number, number];

/** One transition between steps, and the gap between steps when the run plays itself. */
export const BEAT_MS = 1400;
export const STEP_MS = 3000;
export const CAMERA_MS = 1800;
/** Record mode advances the clock by exactly this per rendered frame (research 16). */
export const RECORD_FRAME_MS = 1000 / 60;

export function clamp01(u: number): number {
  return Math.min(1, Math.max(0, u));
}

/** Cubic ease in and out: slow start, slow landing. */
export function ease(u: number): number {
  const x = clamp01(u);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

export function lerp3(a: V3, b: V3, u: number): V3 {
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
}

/** A layout point to a world point: layout y runs along world z, up is world y. */
export function world(x: number, y: number, z = 0): V3 {
  return [x, z, y];
}

export function centerOf(b: Box): [number, number] {
  return [b.x + b.w / 2, b.y + b.d / 2];
}

// ------------------------------------------------------------------ buildings

export function deptBox(facility: FacilityId, dept: DeptCode): Box | undefined {
  return FACILITY_LAYOUTS.find((l) => l.id === facility)?.departments.find((d) => d.code === dept)
    ?.box;
}

export type DeptLook = DeptStatus | "steady";

export interface DeptFrame {
  facility: FacilityId;
  code: DeptCode;
  label: string;
  box: Box;
  /** Height above the floor slab. */
  height: number;
  look: DeptLook;
  /** Where the colour comes from and how far along it is. */
  from: DeptLook;
  mix: number;
  /** 1 the instant a department comes online, fading to 0 over the beat. */
  glow: number;
  breathe: boolean;
}

function lookOf(facility: FacilityId, status: DeptStatus): DeptLook {
  // Plants A and C were on Acme's systems before day one: online, but not the story.
  return facility === "B" ? status : "steady";
}

function heightOf(look: DeptLook): number {
  return look === "steady" ? DEPT_Z.online : DEPT_Z[look];
}

/** Every department of every plant, between the previous and the current step. */
export function blendDepartments(prev: TwinState, next: TwinState, u: number): DeptFrame[] {
  const e = ease(u);
  const out: DeptFrame[] = [];
  for (const layout of FACILITY_LAYOUTS) {
    const was = prev.facilities.find((f) => f.id === layout.id);
    const now = next.facilities.find((f) => f.id === layout.id);
    for (const { code, box } of layout.departments) {
      const before = lookOf(
        layout.id,
        was?.departments.find((d) => d.code === code)?.status ?? "offline",
      );
      const dept = now?.departments.find((d) => d.code === code);
      const after = lookOf(layout.id, dept?.status ?? "offline");
      out.push({
        facility: layout.id,
        code,
        label: dept?.label ?? code,
        box,
        height: lerp(heightOf(before), heightOf(after), e),
        look: after,
        from: before,
        mix: before === after ? 1 : e,
        glow: before !== "online" && after === "online" ? 1 - e : 0,
        breathe: after === "onboarding",
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ anchors and paths

/** Where a flow starts or ends: just above the middle of a department roof or a pad. */
export function anchor3(ref: NodeRef, state: TwinState): V3 {
  if (ref.kind === "dept") {
    const box = deptBox(ref.facility, ref.dept);
    const status =
      state.facilities
        .find((f) => f.id === ref.facility)
        ?.departments.find((d) => d.code === ref.dept)?.status ?? "offline";
    if (box) {
      const [x, y] = centerOf(box);
      return world(x, y, FLOOR_Z + topHeight(ref.dept, heightOf(lookOf(ref.facility, status))) + 1);
    }
  }
  const pad = PADS[ref.kind === "dept" ? "hq" : ref.kind];
  const [x, y] = centerOf(pad);
  return world(x, y, PAD_Z + 1);
}

/**
 * Where a truck stops: on the ground just outside the side of the building that faces where it
 * came from. A pad has no dock; the truck stops at its anchor on the ground.
 */
export function dock3(ref: NodeRef, from: V3): V3 {
  if (ref.kind !== "dept") {
    const pad = PADS[ref.kind];
    const [x, y] = centerOf(pad);
    return world(x, y, 0.1);
  }
  const box = deptBox(ref.facility, ref.dept);
  if (!box) return [from[0], 0.1, from[2]];
  const [cx, cy] = centerOf(box);
  const dx = from[0] - cx;
  const dz = from[2] - cy;
  const gap = 2.5;
  if (Math.abs(dx) > Math.abs(dz)) return world(cx + Math.sign(dx) * (box.w / 2 + gap), cy, 0.1);
  return world(cx, cy + Math.sign(dz) * (box.d / 2 + gap), 0.1);
}

export interface Path {
  at(p: number): V3;
  /** The compass heading of travel at p, in radians about world y. */
  heading(p: number): number;
  points: V3[];
}

function bezier(a: V3, c: V3, b: V3, segments: number): Path {
  const at = (p: number): V3 => {
    const q = 1 - p;
    return [
      q * q * a[0] + 2 * q * p * c[0] + p * p * b[0],
      q * q * a[1] + 2 * q * p * c[1] + p * p * b[1],
      q * q * a[2] + 2 * q * p * c[2] + p * p * b[2],
    ];
  };
  const heading = (p: number): number => {
    const h = 0.01;
    const p0 = at(clamp01(p - h));
    const p1 = at(clamp01(p + h));
    return Math.atan2(p1[0] - p0[0], p1[2] - p0[2]);
  };
  const points: V3[] = [];
  for (let i = 0; i <= segments; i++) points.push(at(i / segments));
  return { at, heading, points };
}

/** A money arc: lifted over the site, like the flat map's arcs. */
export function arc3(a: V3, b: V3): Path {
  const dist = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const c: V3 = [
    (a[0] + b[0]) / 2,
    Math.max(a[1], b[1]) + Math.max(10, dist * 0.35),
    (a[2] + b[2]) / 2,
  ];
  return bezier(a, c, b, 40);
}

/** A road on the ground between two anchors, bowed away from the straight line so trucks turn. */
export function road3(a: V3, b: V3): Path {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const dist = Math.hypot(dx, dz);
  // Bow to the side that keeps the road clear of Plant B's floor when it heads for receiving.
  const c: V3 = [
    (a[0] + b[0]) / 2 - (dz / dist) * dist * 0.22,
    0.1,
    (a[2] + b[2]) / 2 + (dx / dist) * dist * 0.22,
  ];
  return bezier([a[0], 0.1, a[2]], c, [b[0], 0.1, b[2]], 40);
}

// ------------------------------------------------------------------ flows

export interface FlowFrame {
  flow: Flow;
  /** 0 at `from`, 1 at `to`. */
  progress: number;
  /** Fades out over the beat after the flow leaves the state. */
  alpha: number;
  /** The refusal's flash at the wall, 1 at impact fading to 0. */
  hit: number;
  leaving: boolean;
}

/** A refused transfer flies at the vault, hits the wall and drops back. */
function bounce(u: number): { progress: number; hit: number } {
  if (u < 0.55) return { progress: ease(u / 0.55) * 0.7, hit: 0 };
  const back = ease((u - 0.55) / 0.45);
  return { progress: 0.7 - back * 0.22, hit: 1 - back };
}

/** Every flow in either state, with its position along the way at u. */
export function blendFlows(prev: TwinState, next: TwinState, u: number): FlowFrame[] {
  const e = ease(u);
  const out: FlowFrame[] = [];
  for (const flow of next.flows) {
    const was = prev.flows.find((f) => f.id === flow.id);
    if (was) {
      out.push({
        flow,
        progress: lerp(was.progress, flow.progress, e),
        alpha: 1,
        hit: 0,
        leaving: false,
      });
    } else if (flow.status === "refused") {
      const b = bounce(u);
      out.push({ flow, progress: b.progress, alpha: 1, hit: b.hit, leaving: false });
    } else {
      out.push({ flow, progress: e * flow.progress, alpha: 1, hit: 0, leaving: false });
    }
  }
  for (const flow of prev.flows) {
    if (next.flows.some((f) => f.id === flow.id)) continue;
    out.push({ flow, progress: flow.progress, alpha: 1 - e, hit: 0, leaving: true });
  }
  return out;
}

// ------------------------------------------------------------------ lots

export interface LotFrame {
  lot: TwinLot;
  box: Box;
  /** The cage's height above its resting place while it drops in. */
  drop: number;
  /** The cage's opacity: 1 in quarantine, fading as QC decides. */
  cage: number;
  /** 0 amber (quarantine), 1 the decided colour (released green, rejected red). */
  decided: number;
}

export function blendLots(prev: TwinState, next: TwinState, u: number): LotFrame[] {
  const e = ease(u);
  const out: LotFrame[] = [];
  for (const lot of next.lots) {
    const box = deptBox(lot.facility, lot.department);
    if (!box) continue;
    const was = prev.lots.find((l) => l.code === lot.code);
    if (!was) {
      out.push({
        lot,
        box,
        drop: (1 - e) * 12,
        cage: 1,
        decided: lot.state === "quarantine" ? 0 : 1,
      });
    } else if (was.state === "quarantine" && lot.state !== "quarantine") {
      out.push({ lot, box, drop: e * 6, cage: 1 - e, decided: e });
    } else {
      out.push({
        lot,
        box,
        drop: 0,
        cage: lot.state === "quarantine" ? 1 : 0,
        decided: lot.state === "quarantine" ? 0 : 1,
      });
    }
  }
  return out;
}

export function blendEscrowCents(prev: TwinState, next: TwinState, u: number): number {
  return Math.round(lerp(prev.escrowHeldCents, next.escrowHeldCents, ease(u)));
}

// ------------------------------------------------------------------ suppliers

export interface Depot {
  quote?: TwinQuote;
  position: V3;
}

/**
 * Three depots on the suppliers' pad, one per quote once Kevin has them, unnamed before. They
 * sit along the pad's diagonal so their labels spread across the screen from the map's corner.
 */
export function depots(state: TwinState): Depot[] {
  const pad = PADS.suppliers;
  const n = 3;
  return Array.from({ length: n }, (_, i) => {
    const quote = state.quotes[i];
    const x = pad.x + (pad.w * (i + 0.5)) / n;
    const y = pad.y + (pad.d * (n - i - 0.5)) / n;
    return quote ? { quote, position: world(x, y, PAD_Z) } : { position: world(x, y, PAD_Z) };
  });
}

// ------------------------------------------------------------------ camera

export interface Framing {
  target: V3;
  distance: number;
  /** Radians around world y; π/4 looks from the +x +z corner, like the flat map. */
  azimuth: number;
  /** Radians above the ground. */
  elevation: number;
}

const ISO = Math.PI / 4;
const UP = 0.62;

function around(box: Box, distance: number, lift = 2, azimuth = ISO, elevation = UP): Framing {
  const [x, y] = centerOf(box);
  return { target: world(x, y, lift), distance, azimuth, elevation };
}

/** Department labels hide beyond this camera distance; the whole-site view keeps plant names only. */
export const LABEL_DISTANCE = 135;

const SITE: Framing = { target: [14, 0, 20], distance: 160, azimuth: ISO, elevation: UP };
const PLANT_B: Framing = {
  target: [19, 2, 19],
  distance: 78,
  azimuth: ISO - 0.15,
  elevation: 0.58,
};
const MONEY: Framing = { target: [56, 1, 4], distance: 92, azimuth: ISO + 0.3, elevation: 0.5 };
const SUPPLIERS: Framing = {
  target: [10, 0, 46],
  distance: 100,
  azimuth: ISO - 0.3,
  elevation: 0.55,
};
const TWO_PLANTS: Framing = { target: [-10, 0, 18], distance: 120, azimuth: ISO, elevation: 0.6 };
const PAYOUT: Framing = { target: [32, 0, 38], distance: 125, azimuth: ISO + 0.1, elevation: 0.6 };

/** Where the story camera looks at a step, by the step's title (web/src/run.ts AUDIENCE). */
export function framingFor(title: string): Framing {
  if (title.startsWith("Upload ") || title.endsWith(" confirms")) return PLANT_B;
  if (title.endsWith(" texts")) return MONEY;
  switch (title) {
    case "Discrepancy":
      return TWO_PLANTS;
    case "Forecast":
      return PLANT_B;
    case "Quotes":
      return SUPPLIERS;
    case "Small PO":
    case "Big PO":
    case "Kevin retries":
      return MONEY;
    case "Supplier ships":
      return SUPPLIERS;
    case "Delivery":
    case "QC release":
    case "QC reject": {
      const lab = deptBox("B", "qc_lab");
      return lab ? around(lab, 80, 3, ISO - 0.25, 0.5) : PLANT_B;
    }
    case "Paid":
      return PAYOUT;
    default:
      return SITE;
  }
}

export function lerpFraming(a: Framing, b: Framing, u: number): Framing {
  const e = ease(u);
  return {
    target: lerp3(a.target, b.target, e),
    distance: lerp(a.distance, b.distance, e),
    azimuth: lerp(a.azimuth, b.azimuth, e),
    elevation: lerp(a.elevation, b.elevation, e),
  };
}

export function cameraPosition(f: Framing): V3 {
  const r = f.distance * Math.cos(f.elevation);
  return [
    f.target[0] + r * Math.sin(f.azimuth),
    f.target[1] + f.distance * Math.sin(f.elevation),
    f.target[2] + r * Math.cos(f.azimuth),
  ];
}

/** The pads' and floors' world boxes, for the ground plane and the tests. */
export function siteBounds(): { min: [number, number]; max: [number, number] } {
  const boxes = [...FACILITY_LAYOUTS.map((f) => f.floor), ...Object.values(PADS)];
  const xs = boxes.flatMap((b) => [b.x, b.x + b.w]);
  const ys = boxes.flatMap((b) => [b.y, b.y + b.d]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}
