// The only place the plant map's coordinates live (research 16). Everything is in plant units
// on a flat ground plane: a facility is a footprint with a grid of department cells, and the
// suppliers, the escrow and Acme HQ are pads beside the plants. `iso` projects a point to the
// screen for the 2D map; a 3D view would read the same numbers as (x, 0, y).

import type { DeptCode, FacilityId, NodeRef } from "./model.ts";
import { DEPARTMENTS } from "./model.ts";

export type Pt = [number, number];

const COS = 0.866;
const SIN = 0.5;

/** Isometric projection: +x runs to the lower right, +y to the lower left, +z straight up. */
export function iso(x: number, y: number, z = 0): Pt {
  return [(x - y) * COS, (x + y) * SIN - z];
}

export interface Box {
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface FacilityLayout {
  id: FacilityId;
  floor: Box;
  departments: { code: DeptCode; box: Box }[];
}

/** How tall things stand: the floor slab, and a department by its status. */
export const FLOOR_Z = 1.5;
export const DEPT_Z = { offline: 1, onboarding: 3, online: 5 } as const;
export const PAD_Z = 1;

interface Grid {
  origin: Pt;
  cell: number;
  gap: number;
  margin: number;
  cols: number;
  /** Row-major, back row first; `null` leaves the cell empty. */
  order: (DeptCode | null)[];
}

// Receiving sits at the front left, towards the suppliers; purchasing and accounting at the back
// right, towards HQ and the escrow; the production line runs across the middle.
const GRIDS: Record<FacilityId, Grid> = {
  B: {
    origin: [0, 0],
    cell: 10,
    gap: 2,
    margin: 2,
    cols: 3,
    order: [
      "packaging",
      "accounting",
      "purchasing",
      "weigh_dispense",
      "blending",
      "compression",
      "receiving",
      "warehouse",
      "qc_lab",
    ],
  },
  A: {
    origin: [-50, 4],
    cell: 7,
    gap: 1.5,
    margin: 2,
    cols: 3,
    order: [
      "packaging",
      "accounting",
      "purchasing",
      "weigh_dispense",
      "blending",
      "compression",
      "receiving",
      "warehouse",
      "qc_lab",
    ],
  },
  C: {
    origin: [14, -34],
    cell: 7,
    gap: 1.5,
    margin: 2,
    cols: 2,
    order: ["packaging", "accounting", "receiving", "warehouse"],
  },
};

function layoutFacility(id: FacilityId): FacilityLayout {
  const g = GRIDS[id];
  const has = new Set(DEPARTMENTS.filter((d) => d.plants.includes(id)).map((d) => d.code));
  const rows = Math.ceil(g.order.length / g.cols);
  const side = (n: number) => n * g.cell + (n - 1) * g.gap + 2 * g.margin;
  const departments = g.order.flatMap((code, i) => {
    if (!code || !has.has(code)) return [];
    const col = i % g.cols;
    const row = Math.floor(i / g.cols);
    return [
      {
        code,
        box: {
          x: g.origin[0] + g.margin + col * (g.cell + g.gap),
          y: g.origin[1] + g.margin + row * (g.cell + g.gap),
          w: g.cell,
          d: g.cell,
        },
      },
    ];
  });
  return {
    id,
    floor: { x: g.origin[0], y: g.origin[1], w: side(g.cols), d: side(rows) },
    departments,
  };
}

export const FACILITY_LAYOUTS: FacilityLayout[] = (["C", "A", "B"] as FacilityId[]).map(
  layoutFacility,
);

/** The pads beside the plants. */
export const PADS: Record<"suppliers" | "escrow" | "hq", Box> = {
  suppliers: { x: 0, y: 64, w: 11, d: 11 },
  escrow: { x: 58, y: 8, w: 11, d: 11 },
  hq: { x: 70, y: -18, w: 11, d: 11 },
};

function center(b: Box): Pt {
  return [b.x + b.w / 2, b.y + b.d / 2];
}

/** Where a flow starts or ends on screen: the middle of a department roof or a pad, lifted. */
export function anchor(ref: NodeRef, deptZ: (facility: FacilityId, dept: DeptCode) => number): Pt {
  if (ref.kind === "dept") {
    const f = FACILITY_LAYOUTS.find((l) => l.id === ref.facility);
    const dep = f?.departments.find((d) => d.code === ref.dept);
    const box = dep?.box ?? f?.floor ?? PADS.hq;
    const [x, y] = center(box);
    return iso(x, y, FLOOR_Z + deptZ(ref.facility, ref.dept) + 1);
  }
  const [x, y] = center(PADS[ref.kind]);
  return iso(x, y, PAD_Z + 1);
}

/** The three visible faces of a box standing from z0 to z1, as SVG path data. */
export function slab(b: Box, z0: number, z1: number): { top: string; left: string; right: string } {
  const p = (pts: Pt[]) => `M${pts.map(([x, y]) => `${r(x)},${r(y)}`).join("L")}Z`;
  const { x, y, w, d } = b;
  return {
    top: p([iso(x, y, z1), iso(x + w, y, z1), iso(x + w, y + d, z1), iso(x, y + d, z1)]),
    left: p([iso(x, y + d, z1), iso(x + w, y + d, z1), iso(x + w, y + d, z0), iso(x, y + d, z0)]),
    right: p([iso(x + w, y, z1), iso(x + w, y + d, z1), iso(x + w, y + d, z0), iso(x + w, y, z0)]),
  };
}

/** The outline of a roof, for the quarantine cage and the onboarding pulse. */
export function roof(b: Box, z: number): string {
  const { x, y, w, d } = b;
  return [iso(x, y, z), iso(x + w, y, z), iso(x + w, y + d, z), iso(x, y + d, z)]
    .map(([px, py]) => `${r(px)},${r(py)}`)
    .join(" ");
}

/** A flow's arc between two anchors, and the point a fraction of the way along it. */
export function arc(a: Pt, b: Pt): { d: string; at: (p: number) => Pt } {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const c: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - Math.max(12, dist * 0.42)];
  const at = (p: number): Pt => {
    const q = 1 - p;
    return [
      q * q * a[0] + 2 * q * p * c[0] + p * p * b[0],
      q * q * a[1] + 2 * q * p * c[1] + p * p * b[1],
    ];
  };
  return { d: `M${r(a[0])},${r(a[1])}Q${r(c[0])},${r(c[1])} ${r(b[0])},${r(b[1])}`, at };
}

/** The front-most ground point of a box, where its name goes. */
export function front(b: Box): Pt {
  return iso(b.x + b.w, b.y + b.d, 0);
}

export function roofCenter(b: Box, z: number): Pt {
  const [x, y] = center(b);
  return iso(x, y, z);
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The viewBox that fits every floor and pad with room for labels. */
export const VIEW = (() => {
  const boxes = [...FACILITY_LAYOUTS.map((f) => f.floor), ...Object.values(PADS)];
  const pts = boxes.flatMap((b) => [
    iso(b.x, b.y, 8),
    iso(b.x + b.w, b.y, 0),
    iso(b.x + b.w, b.y + b.d, 0),
    iso(b.x, b.y + b.d, 0),
  ]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs) - 6;
  const y = Math.min(...ys) - 8;
  return { x, y, w: Math.max(...xs) + 6 - x, h: Math.max(...ys) + 9 - y };
})();
