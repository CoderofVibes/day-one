// The pure half of the 3D twin (docs/TWIN3D.md): where things stand, where the camera looks
// and how one TwinState becomes the next. Everything here is a function of the two states
// and a number u in [0, 1] from the demo clock, so the view is the same on every run and
// testable without a GPU. Positions come from the same layout.ts the flat map uses: a layout
// point (x, y) is the world point (x, 0, y), and heights are the same DEPT_Z and FLOOR_Z.

import {
  type Box,
  DEPT_Z,
  FACILITY_LAYOUTS,
  FLOOR_Z,
  PAD_Z,
  PADS,
  siteScale,
  zoneOf,
} from "../twin/layout.ts";
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
import type { Focus } from "../twin/objects.ts";
import type { Pallet } from "../twin/pallets.ts";
import { BUILDING_HEIGHT, siteTop, topHeight } from "./buildings.ts";

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
  // Exact at both ends (a at 0, b at 1), so a finished transition lands on its framing.
  return a * (1 - u) + b * u;
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

/**
 * Where a flow starts or ends: just above the middle of a department's main area or a pad. The
 * buildings stand from the start, so a grey area's anchor is at roof height like a lit one's;
 * the state is kept in the signature for the callers that pass it.
 */
export function anchor3(ref: NodeRef, _state?: TwinState): V3 {
  if (ref.kind === "dept") {
    const box = deptBox(ref.facility, ref.dept);
    if (box) {
      const [x, y] = centerOf(box);
      return world(x, y, FLOOR_Z + topHeight(ref.dept, ref.facility) + 1);
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
  /** Where the pallet stands: the warehouse's quarantine area, or its department's main area. */
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
    // A delivered lot waits in the warehouse's quarantine cage until QC decides, wherever QC sits.
    const box = zoneOf(lot.facility, "quarantine")?.box ?? deptBox(lot.facility, lot.department);
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
  return depotPositions().map((position, i) => {
    const quote = state.quotes[i];
    return quote ? { quote, position } : { position };
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

/** Department labels hide beyond this camera distance; the whole-site view keeps plant names only. */
export const LABEL_DISTANCE = 190;

/** The canvas in CSS pixels. Labels are DOM, so their size is in pixels, whatever the camera does. */
export interface Viewport {
  width: number;
  height: number;
}

/** The storyboard was framed at this size: the wide view of `npm run web:shot:3d`. */
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 720 };

/** The camera's vertical field of view, in degrees (Twin3D.tsx passes the same to the Canvas). */
export const FOV = 32;

/** A world point a shot keeps in frame, with half the size in pixels of any label hung on it. */
export interface Subject {
  point: V3;
  padPx?: [number, number];
}

/** What a shot shows: the subjects to keep in frame and the angle to look from. */
export interface Shot {
  subjects: Subject[];
  azimuth: number;
  elevation: number;
  /** Keeps a small subject in context: the camera comes no closer than this. */
  minDistance?: number;
}

/** Clear space between a subject (or its label) and the frame edge, in pixels. */
const EDGE_PX = 14;
/** Stages this wide or narrower are phones: labels thin out and may fade at the edge instead. */
export const NARROW_PX = 560;

/**
 * How much of a label's pixels a shot keeps inside the frame: all of it on a wide stage, none
 * on a phone, where fitting 160 px labels into a 330 px stage would push the camera so far
 * that the plants shrink to specks under them. There the labels are smaller and fade when
 * they would cross the edge (Label in Twin3D.tsx).
 */
export function labelPadScale(viewport: Viewport): number {
  return viewport.width <= NARROW_PX ? 0 : 1;
}
/** Half the size of a plant's name and its line below, and of a pad's name, in pixels. */
const PLANT_LABEL_PX: [number, number] = [84, 18];
const PAD_LABEL_PX: [number, number] = [44, 18];
const DEPOT_LABEL_PX: [number, number] = [78, 30];
const TRUCK_LABEL_PX: [number, number] = [36, 12];
/** The camera never comes closer than this, so a tiny shot still shows some ground. */
const MIN_DISTANCE = 30;

/** A box's eight corners, on the ground and at `height`. */
export function boxSubjects(box: Box, height: number): Subject[] {
  const out: Subject[] = [];
  for (const x of [box.x, box.x + box.w]) {
    for (const y of [box.y, box.y + box.d]) {
      out.push({ point: world(x, y, 0) }, { point: world(x, y, height) });
    }
  }
  return out;
}

/** Where a plant's name hangs: the middle of its floor's front edge (Floors in Twin3D.tsx). */
export function plantLabelPoint(floor: Box): V3 {
  return world(floor.x + floor.w / 2, floor.y + floor.d + 1.5, 0);
}

/** Where a pad's name hangs: the middle of its front edge (Pads in Twin3D.tsx). */
export function padLabelPoint(pad: Box): V3 {
  return world(pad.x + pad.w / 2, pad.y + pad.d + 1.5, 0);
}

/** The three depots' places on the suppliers' pad, along its diagonal. */
export function depotPositions(): V3[] {
  const pad = PADS.suppliers;
  const n = 3;
  return Array.from({ length: n }, (_, i) =>
    world(pad.x + (pad.w * (i + 0.5)) / n, pad.y + (pad.d * (n - i - 0.5)) / n, PAD_Z),
  );
}

function plantSubjects(id: FacilityId): Subject[] {
  const layout = FACILITY_LAYOUTS.find((l) => l.id === id);
  if (!layout) return [];
  const top = FLOOR_Z + siteTop(id);
  return [
    ...boxSubjects(layout.floor, top),
    { point: plantLabelPoint(layout.floor), padPx: PLANT_LABEL_PX },
  ];
}

function padSubjects(kind: keyof typeof PADS, height: number): Subject[] {
  return [
    ...boxSubjects(PADS[kind], height),
    { point: padLabelPoint(PADS[kind]), padPx: PAD_LABEL_PX },
  ];
}

/** The vault with the refusal wall in front of it and the coins' labels above. */
const ESCROW = (): Subject[] => padSubjects("escrow", PAD_Z + 9.5);
/** The HQ tower. */
const HQ = (): Subject[] => padSubjects("hq", PAD_Z + 10);
/** The suppliers' pad with the three depots and their stacked quote labels. */
const SUPPLIERS = (): Subject[] => [
  ...padSubjects("suppliers", PAD_Z + 3),
  ...depotPositions().map((p, i) => ({
    point: [p[0], p[1] + 3.4 + i * 1.5, p[2]] as V3,
    padPx: DEPOT_LABEL_PX,
  })),
];
/** Plant B's dock: the truck stops in front of receiving, on the apron it came in by. */
const DOCK = (): Subject[] => {
  const box = deptBox("B", "receiving");
  return box
    ? [{ point: world(box.x + box.w / 2, box.y + box.d + 5, 0), padPx: TRUCK_LABEL_PX }]
    : [];
};

const SITE: Shot = {
  subjects: [
    ...plantSubjects("A"),
    ...plantSubjects("B"),
    ...plantSubjects("C"),
    ...ESCROW(),
    ...HQ(),
    ...SUPPLIERS(),
  ],
  azimuth: ISO,
  elevation: UP,
};
const PLANT_B: Shot = { subjects: plantSubjects("B"), azimuth: ISO - 0.15, elevation: 0.58 };
/** The vault and HQ, with Plant B's purchasing in the background. */
const MONEY: Shot = {
  subjects: [...ESCROW(), ...HQ()],
  azimuth: ISO + 0.3,
  elevation: 0.5,
  minDistance: 72,
};
/** The three depots, with Plant B's receiving in the background. */
const QUOTES: Shot = {
  subjects: SUPPLIERS(),
  azimuth: ISO - 0.3,
  elevation: 0.55,
  minDistance: 80,
};
const SHIPPING: Shot = {
  subjects: [...SUPPLIERS(), ...plantSubjects("B"), ...DOCK()],
  azimuth: ISO - 0.3,
  elevation: 0.55,
};
const TWO_PLANTS: Shot = {
  subjects: [...plantSubjects("A"), ...plantSubjects("B")],
  azimuth: ISO,
  elevation: 0.6,
};
/** The pallet in its cage and the money waiting for QC in the vault, in one frame. */
const QC: Shot = {
  subjects: [...plantSubjects("B"), ...DOCK(), ...ESCROW()],
  azimuth: ISO - 0.25,
  elevation: 0.5,
};
const PAYOUT: Shot = {
  subjects: [...ESCROW(), ...SUPPLIERS(), ...plantSubjects("B")],
  azimuth: ISO + 0.1,
  elevation: 0.6,
};

/** About the size of a coin's label on screen ("Plant B's $4,745.00 refused"). */
const COIN_LABEL_PX: [number, number] = [110, 18];

/** A department's building, with room above its roof for the label of a coin leaving it. */
function deptSubjects(id: FacilityId, code: DeptCode): Subject[] {
  const box = deptBox(id, code);
  if (!box) return [];
  const top = FLOOR_Z + topHeight(code, id);
  const [x, y] = centerOf(box);
  return [...boxSubjects(box, top), { point: world(x, y, top + 3), padPx: COIN_LABEL_PX }];
}

/** The pooled order (docs/GROUP_BUY.md): each plant's purchasing roof, where its coin leaves, and the vault. */
const POOLED: Shot = {
  subjects: [...deptSubjects("A", "purchasing"), ...deptSubjects("B", "purchasing"), ...ESCROW()],
  azimuth: ISO + 0.2,
  elevation: 0.55,
};
/** Where the earmarked share's truck stands on the road from the hub to Plant A: halfway. */
const EARMARK_ROAD = (): Subject[] => {
  const b = deptBox("B", "warehouse");
  if (!b) return [];
  const [bx, by] = centerOf(b);
  const from = world(bx, by, 0);
  const p = road3(from, dock3({ kind: "dept", facility: "A", dept: "warehouse" }, from)).at(0.5);
  return [{ point: [p[0], p[1] + 4.2, p[2]], padPx: TRUCK_LABEL_PX }];
};
/** The pooled payout and the earmarked share's truck leaving the hub for Plant A, in one frame. */
const POOLED_PAYOUT: Shot = {
  subjects: [...ESCROW(), ...SUPPLIERS(), ...plantSubjects("B"), ...EARMARK_ROAD()],
  azimuth: ISO + 0.1,
  elevation: 0.6,
};

/**
 * What the story camera shows at a step, by the step's title (web/src/run.ts AUDIENCE and the
 * group run's titles in docs/GROUP_BUY.md). `pooled` is true once the run holds a pooled PO.
 */
export function shotFor(title: string, pooled = false): Shot {
  if (title.startsWith("Upload ") || title.endsWith(" confirms")) return PLANT_B;
  if (title.endsWith(" texts")) return pooled ? POOLED : MONEY;
  switch (title) {
    case "Discrepancy":
      return TWO_PLANTS;
    case "Forecast":
      return PLANT_B;
    case "Quotes":
    case "Pooled quotes":
      return QUOTES;
    case "Pooled PO":
      return POOLED;
    case "Small PO":
    case "Big PO":
      return MONEY;
    case "Kevin retries":
      return pooled ? POOLED : MONEY;
    case "Supplier ships":
      return SHIPPING;
    case "Delivery":
    case "Delivery at the hub":
    case "QC reject":
      return QC;
    case "QC release":
      return pooled ? POOLED_PAYOUT : QC;
    case "Paid":
      return PAYOUT;
    default:
      return SITE;
  }
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: V3): V3 {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** The camera's axes for a framing: forward (towards what it looks at), right and up. */
function axes(azimuth: number, elevation: number): { f: V3; r: V3; u: V3 } {
  const f: V3 = [
    -Math.sin(azimuth) * Math.cos(elevation),
    -Math.sin(elevation),
    -Math.cos(azimuth) * Math.cos(elevation),
  ];
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}

/**
 * The framing that keeps every subject, label included, inside the viewport from the shot's
 * angle: the target is the middle of what is shown and the distance the smallest that fits
 * the frame's narrower side. A phone's 4:3 stage gets a farther camera than the 16:9 wide view
 * for the same shot, instead of clipping the plants at both edges.
 */
export function frameShot(shot: Shot, viewport: Viewport = DEFAULT_VIEWPORT): Framing {
  const { f, r, u } = axes(shot.azimuth, shot.elevation);
  const views = shot.subjects.map((s) => ({
    x: dot(s.point, r),
    y: dot(s.point, u),
    z: dot(s.point, f),
    pad: s.padPx ?? ([0, 0] as [number, number]),
  }));
  if (views.length === 0) {
    return {
      target: [0, 0, 0],
      distance: Math.max(MIN_DISTANCE, shot.minDistance ?? 0),
      azimuth: shot.azimuth,
      elevation: shot.elevation,
    };
  }
  const mid = (k: "x" | "y") =>
    (Math.min(...views.map((v) => v[k])) + Math.max(...views.map((v) => v[k]))) / 2;
  const cx = mid("x");
  const cy = mid("y");
  const cz = views.reduce((s, v) => s + v.z, 0) / views.length;
  const tanH = Math.tan((FOV / 2) * (Math.PI / 180));
  const tanW = tanH * (viewport.width / viewport.height);
  const pads = labelPadScale(viewport);
  let distance = Math.max(MIN_DISTANCE, shot.minDistance ?? 0);
  for (const v of views) {
    // The label's pixels and the edge margin are taken off the frame, not scaled with it.
    const fx = Math.max(0.2, 1 - (2 * (v.pad[0] * pads + EDGE_PX)) / viewport.width);
    const fy = Math.max(0.2, 1 - (2 * (v.pad[1] * pads + EDGE_PX)) / viewport.height);
    const depth = v.z - cz;
    distance = Math.max(
      distance,
      Math.abs(v.x - cx) / (tanW * fx) - depth,
      Math.abs(v.y - cy) / (tanH * fy) - depth,
    );
  }
  const target: V3 = [
    cx * r[0] + cy * u[0] + cz * f[0],
    cx * r[1] + cy * u[1] + cz * f[1],
    cx * r[2] + cy * u[2] + cz * f[2],
  ];
  return { target, distance, azimuth: shot.azimuth, elevation: shot.elevation };
}

/** Where the story camera stands at a step, fitted to the viewport. */
export function framingFor(
  title: string,
  viewport: Viewport = DEFAULT_VIEWPORT,
  pooled = false,
  /** More to keep in frame: the chain layer's part in the step when the curtain is on. */
  extra: Subject[] = [],
): Framing {
  const shot = shotFor(title, pooled);
  return frameShot(
    extra.length ? { ...shot, subjects: [...shot.subjects, ...extra] } : shot,
    viewport,
  );
}

/** True once the run has a pooled PO: its money moves as plant shares and the shots widen. */
export function isPooled(state: TwinState): boolean {
  return state.pooled !== undefined;
}

/**
 * A world point on the screen for a framing, in pixels from the top left, or undefined when it
 * is behind the camera. The tests check a shot's subjects with it.
 */
export function projectPoint(
  framing: Framing,
  point: V3,
  viewport: Viewport = DEFAULT_VIEWPORT,
): [number, number] | undefined {
  const { f, r, u } = axes(framing.azimuth, framing.elevation);
  const cam = cameraPosition(framing);
  const d: V3 = [point[0] - cam[0], point[1] - cam[1], point[2] - cam[2]];
  const depth = dot(d, f);
  if (depth <= 0) return undefined;
  const tanH = Math.tan((FOV / 2) * (Math.PI / 180));
  const tanW = tanH * (viewport.width / viewport.height);
  const nx = dot(d, r) / (depth * tanW);
  const ny = dot(d, u) / (depth * tanH);
  return [((nx + 1) / 2) * viewport.width, ((1 - ny) / 2) * viewport.height];
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

// ------------------------------------------------------------------ views, fly-to and limits

/** A fly-to's length: long enough to follow, short enough not to wait for (brief §4.6: 1.2–1.8 s). */
export const FLY_MS = 1500;

/**
 * What the camera may do under the user's hands: no lower than 10° above the ground nor
 * steeper than 75° (15°–80° from vertical), no nearer or farther than the distances, and the
 * point it looks at kept over the campus.
 */
export const CAMERA_LIMITS = {
  minPolar: (15 * Math.PI) / 180,
  maxPolar: (80 * Math.PI) / 180,
  minDistance: 12,
  maxDistance: 600,
  /** How far past the outermost floor or pad the camera's target may wander. */
  margin: 40,
} as const;

/** The box the camera's target stays in: the campus and a margin, from the ground to 40 up. */
export function targetBounds(): { min: V3; max: V3 } {
  const { min, max } = siteBounds();
  const m = CAMERA_LIMITS.margin;
  return { min: [min[0] - m, 0, min[1] - m], max: [max[0] + m, 40, max[1] + m] };
}

/** A framing kept within the limits, so a preset or fly-to lands where the user could also go. */
export function clampFraming(f: Framing): Framing {
  const minElev = Math.PI / 2 - CAMERA_LIMITS.maxPolar;
  const maxElev = Math.PI / 2 - CAMERA_LIMITS.minPolar;
  const { min, max } = targetBounds();
  return {
    target: [0, 1, 2].map((i) =>
      Math.min(max[i] as number, Math.max(min[i] as number, f.target[i] as number)),
    ) as V3,
    distance: Math.min(CAMERA_LIMITS.maxDistance, Math.max(CAMERA_LIMITS.minDistance, f.distance)),
    azimuth: f.azimuth,
    elevation: Math.min(maxElev, Math.max(minElev, f.elevation)),
  };
}

const deptsShot = (codes: DeptCode[], azimuth: number, elevation: number): Shot => ({
  subjects: codes.flatMap((c) => deptSubjects("B", c)),
  azimuth,
  elevation,
  minDistance: 45,
});

/** The camera presets: the "Views" pill and keys 1–8, named as the scene names its places. */
export const VIEWS: { key: string; id: string; label: string; shot: Shot }[] = [
  { key: "1", id: "campus", label: "Campus", shot: SITE },
  { key: "2", id: "plant-b", label: "Hollow Pine", shot: PLANT_B },
  {
    key: "3",
    id: "receiving",
    label: "Receiving & Warehouse",
    shot: deptsShot(["receiving", "warehouse"], ISO - 0.2, 0.6),
  },
  {
    key: "4",
    id: "production",
    label: "Production",
    shot: deptsShot(["weigh_dispense", "blending", "compression"], ISO + 0.15, 0.62),
  },
  { key: "5", id: "qc", label: "QC Lab", shot: deptsShot(["qc_lab"], ISO - 0.1, 0.6) },
  { key: "6", id: "money", label: "HQ & Escrow", shot: MONEY },
  { key: "7", id: "suppliers", label: "Suppliers", shot: QUOTES },
  {
    key: "8",
    id: "plants",
    label: "Riverside & Lakeview",
    shot: {
      subjects: [...plantSubjects("A"), ...plantSubjects("C")],
      azimuth: ISO,
      elevation: 0.6,
    },
  },
];

export function viewFraming(
  id: string,
  viewport: Viewport = DEFAULT_VIEWPORT,
): Framing | undefined {
  const view = VIEWS.find((v) => v.id === id);
  return view ? clampFraming(frameShot(view.shot, viewport)) : undefined;
}

/** What the camera frames when an object is picked (src/twin/objects.ts). */
export function objectShot(focus: Focus): Shot {
  switch (focus.kind) {
    case "plant":
      return { subjects: plantSubjects(focus.facility), azimuth: ISO - 0.15, elevation: 0.58 };
    case "dept":
      return {
        subjects: deptSubjects(focus.facility, focus.dept),
        azimuth: ISO - 0.1,
        elevation: 0.6,
        minDistance: 40,
      };
    case "pad":
      return focus.pad === "escrow"
        ? { subjects: ESCROW(), azimuth: ISO + 0.3, elevation: 0.5, minDistance: 50 }
        : focus.pad === "hq"
          ? { subjects: HQ(), azimuth: ISO + 0.3, elevation: 0.5, minDistance: 50 }
          : QUOTES;
    case "depot": {
      const p = depotPositions()[focus.index] ?? depotPositions()[0] ?? world(0, 0);
      return {
        subjects: [{ point: p, padPx: DEPOT_LABEL_PX }, { point: [p[0], p[1] + 4, p[2]] }],
        azimuth: ISO - 0.3,
        elevation: 0.55,
        minDistance: 40,
      };
    }
    case "lot": {
      const box = zoneOf(focus.facility, focus.area)?.box;
      return {
        subjects: box ? boxSubjects(box, FLOOR_Z + 14) : plantSubjects(focus.facility),
        azimuth: ISO - 0.2,
        elevation: 0.6,
        minDistance: 40,
      };
    }
    case "flow": {
      const a = anchor3(focus.from);
      const b = anchor3(focus.to);
      return {
        subjects: [
          { point: a, padPx: COIN_LABEL_PX },
          { point: b, padPx: COIN_LABEL_PX },
          { point: [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 10, (a[2] + b[2]) / 2] },
        ],
        azimuth: ISO + 0.1,
        elevation: 0.58,
        minDistance: 50,
      };
    }
  }
}

/**
 * A task's shot: the picked object at its own angle, with the subjects of the other places the
 * task touches added, so the frame is sized to all of it (the presses with the line feeding them,
 * Linda's purchasing office with the escrow her approval funds).
 */
export function taskShot(focus: Focus, also: Focus[] = []): Shot {
  const shot = objectShot(focus);
  if (also.length === 0) return shot;
  return { ...shot, subjects: [...shot.subjects, ...also.flatMap((f) => objectShot(f).subjects)] };
}

/**
 * An object's framing in the part of the stage a panel on the right leaves free: fitted to the
 * narrower width, then the target moved right by half the panel so the object sits mid-left.
 * `also` widens the shot to the other places the task touches.
 */
export function objectFraming(
  focus: Focus,
  viewport: Viewport = DEFAULT_VIEWPORT,
  rightPanelPx = 0,
  also: Focus[] = [],
): Framing {
  const free = { width: Math.max(200, viewport.width - rightPanelPx), height: viewport.height };
  const f = frameShot(taskShot(focus, also), free);
  const shift =
    ((rightPanelPx / 2) * 2 * f.distance * Math.tan((FOV / 2) * (Math.PI / 180))) / viewport.height;
  return clampFraming({
    ...f,
    target: [
      f.target[0] + Math.cos(f.azimuth) * shift,
      f.target[1],
      f.target[2] - Math.sin(f.azimuth) * shift,
    ],
  });
}

// ------------------------------------------------------------------ pallets

/** A pallet's footprint and height, and the grid it stands on, in plant units. */
export const PALLET = { w: 1.3, h: 0.9, cell: 1.9, inset: 1 } as const;

/** A run's own lot stands this much larger, in the middle of the quarantine cage it is caged in. */
export const HERO_SCALE = 2;

export interface PalletPlace {
  position: V3;
  /** 1 for a stock pallet, HERO_SCALE for the run's lot. */
  scale: number;
}

/**
 * Where each pallet stands: in rows on the roof over its area, the way the run's lot stands over
 * the quarantine cage, stacked a level higher when an area's roof is full. The run's lots stand
 * larger in the middle of the cage, and stock pallets leave the middle of the quarantine roof to them.
 */
export function palletPlaces(pallets: Pallet[]): PalletPlace[] {
  const used = new Map<string, number>();
  return pallets.map((p) => {
    const zone = zoneOf(p.facility, p.area);
    if (!zone) return { position: world(0, 0, -10), scale: 1 };
    const { x, y, w, d } = zone.box;
    const [cx, cy] = centerOf(zone.box);
    const roof = FLOOR_Z + BUILDING_HEIGHT[zone.building] * siteScale(p.facility);
    if (p.run)
      return { position: world(cx, cy, roof + (PALLET.h * HERO_SCALE) / 2), scale: HERO_SCALE };
    const cols = Math.max(1, Math.floor((w - 2 * PALLET.inset) / PALLET.cell));
    const rows = Math.max(1, Math.floor((d - 2 * PALLET.inset) / PALLET.cell));
    const slotAt = (n: number): [number, number, number] => {
      const level = Math.floor(n / (cols * rows));
      const slot = n % (cols * rows);
      return [
        x + (w - cols * PALLET.cell) / 2 + ((slot % cols) + 0.5) * PALLET.cell,
        y + (d - rows * PALLET.cell) / 2 + (Math.floor(slot / cols) + 0.5) * PALLET.cell,
        level,
      ];
    };
    const key = `${p.facility}:${p.area}`;
    let n = used.get(key) ?? 0;
    let [x0, y0, level] = slotAt(n);
    // The cage's middle is the run's lot's: a stock pallet there moves on to the next place.
    while (
      p.area === "quarantine" &&
      level === 0 &&
      Math.hypot(x0 - cx, y0 - cy) < PALLET.cell * 1.6 &&
      n < cols * rows
    )
      [x0, y0, level] = slotAt(++n);
    used.set(key, n + 1);
    return { position: world(x0, y0, roof + PALLET.h / 2 + level * (PALLET.h + 0.1)), scale: 1 };
  });
}

/** The pads' and floors' world boxes, for the ground plane and the tests. */
export function siteBounds(): { min: [number, number]; max: [number, number] } {
  const boxes = [...FACILITY_LAYOUTS.map((f) => f.floor), ...Object.values(PADS)];
  const xs = boxes.flatMap((b) => [b.x, b.x + b.w]);
  const ys = boxes.flatMap((b) => [b.y, b.y + b.d]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}
