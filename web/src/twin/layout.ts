// The only place the plant map's coordinates live (research 16, docs/VISION.md §6.5 and §6.12.1).
// Everything is in plant units on a flat ground plane. Each plant is a site laid out the way a
// plant is: a warehouse with its docks, the processing hall, the dry side, the QC lab and the
// office, plus a utilities yard and a gatehouse that carry no status. Each building is split into
// the ledger's areas (server/src/ledger/schema.ts DEPARTMENTS, twenty codes), and each area lights
// with the story department it belongs to (the nine the run's TwinState tracks). The suppliers, the
// escrow and Acme HQ are pads beside the plants. `iso` projects a point to the screen for the flat
// map; the 3D view reads the same numbers as (x, 0, y).

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

/** The ledger's twenty areas (server/src/ledger/schema.ts), grouped by building. */
export type AreaCode =
  | "receiving"
  | "quarantine"
  | "rm_storage"
  | "pkg_storage"
  | "fg_storage"
  | "shipping"
  | "rm_staging"
  | "weigh_cells"
  | "formulation"
  | "tableting"
  | "bulk_hold"
  | "bottling"
  | "labeling"
  | "cartoning"
  | "palletizing"
  | "powder_fill"
  | "qc_lab"
  | "purchasing"
  | "planning"
  | "accounting";

export type BuildingKind = "warehouse" | "processing" | "dryside" | "lab" | "office";
/** Drawn on the site but not a ledger area: nothing in the ledger knows steam or the gate. */
export type DecorKind = "utilities" | "gatehouse";

/** Each area: its name on screen, its building and the story department whose status it shows. */
export const AREAS: Record<AreaCode, { label: string; building: BuildingKind; dept: DeptCode }> = {
  receiving: { label: "Receiving", building: "warehouse", dept: "receiving" },
  quarantine: { label: "Quarantine", building: "warehouse", dept: "warehouse" },
  rm_storage: { label: "Raw material storage", building: "warehouse", dept: "warehouse" },
  pkg_storage: { label: "Packaging storage", building: "warehouse", dept: "warehouse" },
  fg_storage: { label: "Finished goods", building: "warehouse", dept: "warehouse" },
  shipping: { label: "Shipping", building: "warehouse", dept: "warehouse" },
  rm_staging: { label: "Dispensary store", building: "processing", dept: "weigh_dispense" },
  weigh_cells: { label: "Weigh cells", building: "processing", dept: "weigh_dispense" },
  formulation: { label: "Blending suites", building: "processing", dept: "blending" },
  tableting: { label: "Presses and filler", building: "processing", dept: "compression" },
  bulk_hold: { label: "Bulk hold", building: "processing", dept: "compression" },
  bottling: { label: "Bottling lines", building: "dryside", dept: "packaging" },
  labeling: { label: "Labeling", building: "dryside", dept: "packaging" },
  cartoning: { label: "Cartoning", building: "dryside", dept: "packaging" },
  palletizing: { label: "Palletizing", building: "dryside", dept: "packaging" },
  powder_fill: { label: "Powder line", building: "dryside", dept: "packaging" },
  qc_lab: { label: "QC lab", building: "lab", dept: "qc_lab" },
  purchasing: { label: "Purchasing", building: "office", dept: "purchasing" },
  planning: { label: "Planning", building: "office", dept: "purchasing" },
  accounting: { label: "Accounting", building: "office", dept: "accounting" },
};

export const BUILDING_NAMES: Record<BuildingKind, string> = {
  warehouse: "Warehouse",
  processing: "Processing",
  dryside: "Dry side",
  lab: "QC lab",
  office: "Office",
};

/** Where each story department's flows land and its name hangs: its main area. */
const MAIN_AREA: Record<DeptCode, AreaCode> = {
  receiving: "receiving",
  warehouse: "rm_storage",
  weigh_dispense: "weigh_cells",
  blending: "formulation",
  compression: "tableting",
  packaging: "bottling",
  qc_lab: "qc_lab",
  purchasing: "purchasing",
  accounting: "accounting",
};

export interface Zone {
  area: AreaCode;
  dept: DeptCode;
  building: BuildingKind;
  box: Box;
}

export interface Building {
  kind: BuildingKind;
  box: Box;
}

export interface FacilityLayout {
  id: FacilityId;
  /** The site: the fenced lot every building stands on. */
  floor: Box;
  buildings: Building[];
  zones: Zone[];
  /** The utilities yard and the gatehouse: drawn, no status. */
  decor: { kind: DecorKind; box: Box }[];
  /** Each story department at its main area: flows, cages and labels anchor here. */
  departments: { code: DeptCode; box: Box }[];
}

/** How tall things stand: the site slab, a department by its status (the flat map), a pad. */
export const FLOOR_Z = 1.5;
export const DEPT_Z = { offline: 1, onboarding: 3, online: 5 } as const;
export const PAD_Z = 1;

/** A building split into rows (back to front, by depth weight) of areas (left to right, by width weight). */
interface Plan {
  kind: BuildingKind;
  box: Box;
  rows: [number, [AreaCode, number][]][];
}

/** Hollow Pine's site, the full kit, in units from the site's back left corner. */
const FULL: { floor: Box; plans: Plan[]; decor: { kind: DecorKind; box: Box }[] } = {
  floor: { x: 0, y: 0, w: 70, d: 56 },
  plans: [
    {
      kind: "warehouse",
      box: { x: 3, y: 4, w: 24, d: 42 },
      rows: [
        [
          10,
          [
            ["shipping", 10],
            ["fg_storage", 14],
          ],
        ],
        [
          12,
          [
            ["pkg_storage", 10],
            ["rm_storage", 14],
          ],
        ],
        [9, [["quarantine", 1]]],
        [11, [["receiving", 1]]],
      ],
    },
    {
      kind: "processing",
      box: { x: 31, y: 10, w: 24, d: 22 },
      rows: [
        [
          7,
          [
            ["rm_staging", 1],
            ["bulk_hold", 1],
          ],
        ],
        [
          15,
          [
            ["weigh_cells", 1],
            ["formulation", 1],
            ["tableting", 1],
          ],
        ],
      ],
    },
    {
      kind: "dryside",
      box: { x: 31, y: 36, w: 24, d: 12 },
      rows: [
        [
          1,
          [
            ["bottling", 6],
            ["labeling", 4],
            ["cartoning", 5],
            ["palletizing", 4],
            ["powder_fill", 5],
          ],
        ],
      ],
    },
    { kind: "lab", box: { x: 59, y: 23, w: 8, d: 10 }, rows: [[1, [["qc_lab", 1]]]] },
    {
      kind: "office",
      box: { x: 59, y: 37, w: 8, d: 13 },
      rows: [
        [1, [["planning", 1]]],
        [1, [["purchasing", 1]]],
        [1, [["accounting", 1]]],
      ],
    },
  ],
  decor: [
    { kind: "utilities", box: { x: 59, y: 6, w: 8, d: 13 } },
    { kind: "gatehouse", box: { x: 28.5, y: 51.5, w: 3, d: 3 } },
  ],
};

/** Lakeview packs and ships for the others: a warehouse, the dry side and an office. */
const LAKEVIEW: typeof FULL = {
  floor: { x: 0, y: 0, w: 46, d: 34 },
  plans: [
    {
      kind: "warehouse",
      box: { x: 3, y: 3, w: 18, d: 27 },
      rows: [
        [
          9,
          [
            ["shipping", 1],
            ["fg_storage", 1],
          ],
        ],
        [8, [["pkg_storage", 1]]],
        [
          10,
          [
            ["quarantine", 1],
            ["receiving", 1.6],
          ],
        ],
      ],
    },
    {
      kind: "dryside",
      box: { x: 24, y: 5, w: 18, d: 12 },
      rows: [
        [
          1,
          [
            ["bottling", 6],
            ["labeling", 4],
            ["cartoning", 5],
            ["palletizing", 4],
          ],
        ],
      ],
    },
    { kind: "office", box: { x: 24, y: 21, w: 10, d: 9 }, rows: [[1, [["accounting", 1]]]] },
  ],
  decor: [{ kind: "gatehouse", box: { x: 37, y: 29.5, w: 3, d: 3 } }],
};

/** Where each plant's site stands, how large its kit is drawn, and which kit. */
const SITES: Record<FacilityId, { origin: Pt; scale: number; kit: typeof FULL }> = {
  B: { origin: [0, 0], scale: 1, kit: FULL },
  // Riverside: the same kit at seven tenths the size, no powder line.
  A: { origin: [-64, 10], scale: 0.7, kit: FULL },
  C: { origin: [10, -46], scale: 1, kit: LAKEVIEW },
};

/** How large a plant's kit is drawn: heights scale with the footprints. */
export function siteScale(id: FacilityId): number {
  return SITES[id].scale;
}

/** The area a story department's flows land on (its main area). */
export function mainArea(code: DeptCode): AreaCode {
  return MAIN_AREA[code];
}

function place(b: Box, origin: Pt, s: number): Box {
  return { x: origin[0] + b.x * s, y: origin[1] + b.y * s, w: b.w * s, d: b.d * s };
}

function layoutFacility(id: FacilityId): FacilityLayout {
  const { origin, scale, kit } = SITES[id];
  const depts = new Set(DEPARTMENTS.filter((d) => d.plants.includes(id)).map((d) => d.code));
  // An area shows when its department exists at the plant; Riverside has no powder line.
  const hasArea = (area: AreaCode) =>
    depts.has(AREAS[area].dept) && !(id === "A" && area === "powder_fill");
  const buildings: Building[] = [];
  const zones: Zone[] = [];
  for (const plan of kit.plans) {
    const rows = plan.rows
      .map(([depth, cells]) => [depth, cells.filter(([a]) => hasArea(a))] as const)
      .filter(([, cells]) => cells.length > 0);
    if (rows.length === 0) continue;
    const box = place(plan.box, origin, scale);
    buildings.push({ kind: plan.kind, box });
    const totalDepth = rows.reduce((s, [d]) => s + d, 0);
    let y = box.y;
    for (const [depth, cells] of rows) {
      const d = (box.d * depth) / totalDepth;
      const totalWidth = cells.reduce((s, [, w]) => s + w, 0);
      let x = box.x;
      for (const [area, weight] of cells) {
        const w = (box.w * weight) / totalWidth;
        zones.push({ area, dept: AREAS[area].dept, building: plan.kind, box: { x, y, w, d } });
        x += w;
      }
      y += d;
    }
  }
  const departments = DEPARTMENTS.filter((d) => depts.has(d.code)).flatMap(({ code }) => {
    const zone =
      zones.find((z) => z.area === MAIN_AREA[code]) ?? zones.find((z) => z.dept === code);
    return zone ? [{ code, box: zone.box }] : [];
  });
  return {
    id,
    floor: place(kit.floor, origin, scale),
    buildings,
    zones,
    decor: kit.decor.map((d) => ({ kind: d.kind, box: place(d.box, origin, scale) })),
    departments,
  };
}

export const FACILITY_LAYOUTS: FacilityLayout[] = (["C", "A", "B"] as FacilityId[]).map(
  layoutFacility,
);

/** The pads beside the plants: the suppliers down the road from receiving, the money to the east. */
export const PADS: Record<"suppliers" | "escrow" | "hq", Box> = {
  suppliers: { x: 6, y: 68, w: 13, d: 13 },
  escrow: { x: 80, y: 18, w: 11, d: 11 },
  hq: { x: 92, y: -16, w: 11, d: 11 },
};

/** One area of a plant, if the plant has it. */
export function zoneOf(facility: FacilityId, area: AreaCode): Zone | undefined {
  return FACILITY_LAYOUTS.find((l) => l.id === facility)?.zones.find((z) => z.area === area);
}

/** The building that holds a box (a department's main area), for its height. */
export function buildingOf(facility: FacilityId, box: Box): Building | undefined {
  const f = FACILITY_LAYOUTS.find((l) => l.id === facility);
  return f?.buildings.find(
    (b) =>
      box.x >= b.box.x - 0.01 &&
      box.y >= b.box.y - 0.01 &&
      box.x + box.w <= b.box.x + b.box.w + 0.01 &&
      box.y + box.d <= b.box.y + b.box.d + 0.01,
  );
}

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
