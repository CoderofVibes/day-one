// Procedural buildings for the 3D twin (docs/VISION.md §6.5, §6.12.1): each plant is a site of real
// buildings (the warehouse with its docks, the processing hall under a sawtooth roof, the dry side,
// the QC lab, the office, a utilities yard and a gatehouse) on a lot with paving and trees. The
// buildings stand from the start, because the plant existed before Day One; what changes is each
// area's status, shown on its roof panel (the sawtooth glass over the hall's areas) and in its
// windows: dark while the area is not on Day One, flickering while onboarding, lit once online.
// Everything is listed here as parts that the view draws with one instanced mesh per geometry.
// Pure: a function of the department frames, so it is tested without a GPU.

import {
  AREAS,
  type AreaCode,
  type Box,
  type BuildingKind,
  FACILITY_LAYOUTS,
  type FacilityLayout,
  FLOOR_Z,
  mainArea,
  siteScale,
  type Zone,
} from "../twin/layout.ts";
import type { DeptCode, FacilityId } from "../twin/model.ts";
import type { DeptFrame, V3 } from "./scene.ts";

export type PartKind =
  | "body"
  | "gable"
  | "saw"
  | "silo"
  | "tank"
  | "stack"
  | "window"
  | "door"
  | "vent"
  | "unit"
  | "dock"
  | "panel"
  | "paving"
  | "car"
  | "tree";

/**
 * Which colour a part takes: "shell" the building's walls; "zone", "roof" and "lit" the area's
 * status (panel, sawtooth glass, windows); the rest fixed materials.
 */
export type Tint = "shell" | "zone" | "roof" | "metal" | "dark" | "lit" | "pad" | "paving" | "tree";

export interface Part {
  kind: PartKind;
  position: V3;
  scale: V3;
  /** Radians about world y. */
  rotation: number;
  tint: Tint;
}

/** A part and the department frame its colour follows (none for walls and the grounds). */
export interface SitePart {
  part: Part;
  dept: DeptFrame | null;
}

/** Each building's wall height at full size; Riverside's kit is drawn smaller. */
export const BUILDING_HEIGHT: Record<BuildingKind, number> = {
  warehouse: 6.5,
  processing: 5.5,
  dryside: 4.6,
  lab: 4.2,
  office: 8.4,
};

/** What stands on a building's roof over an area, so labels and arcs clear it. */
const ROOF_EXTRA: Partial<Record<AreaCode, number>> = {
  weigh_cells: 5,
  formulation: 3.6,
  tableting: 4.6,
  qc_lab: 2.4,
};

const SAW_RISE = 1.6;

/** The wall height of a department's building at its plant. */
export function bodyHeight(code: DeptCode, facility: FacilityId = "B"): number {
  return BUILDING_HEIGHT[AREAS[mainArea(code)].building] * siteScale(facility);
}

/** The highest point above the site slab over a department's main area, equipment included. */
export function topHeight(code: DeptCode, facility: FacilityId = "B"): number {
  const area = mainArea(code);
  const kind = AREAS[area].building;
  const saw = kind === "processing" ? SAW_RISE : 0;
  return (BUILDING_HEIGHT[kind] + saw + (ROOF_EXTRA[area] ?? 0.4)) * siteScale(facility);
}

/** The highest point of a whole site above its slab. */
export function siteTop(facility: FacilityId): number {
  const layout = FACILITY_LAYOUTS.find((l) => l.id === facility);
  if (!layout) return 0;
  return Math.max(...layout.departments.map((d) => topHeight(d.code, facility)));
}

const centerOf = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.d / 2];

/** Every part of every site for the frame's departments. */
export function siteParts(departments: DeptFrame[]): SitePart[] {
  return FACILITY_LAYOUTS.flatMap((layout) =>
    facilityParts(
      layout,
      departments.filter((d) => d.facility === layout.id),
    ),
  );
}

/** One plant's site. */
export function facilityParts(layout: FacilityLayout, frames: DeptFrame[]): SitePart[] {
  const s = siteScale(layout.id);
  const y0 = FLOOR_Z;
  const out: SitePart[] = [];
  const frameOf = (z: Zone) => frames.find((f) => f.code === z.dept) ?? null;
  const add = (part: Part, dept: DeptFrame | null = null) => out.push({ part, dept });
  const box = (
    kind: PartKind,
    [x, y, z]: V3,
    [w, h, d]: V3,
    tint: Tint,
    dept: DeptFrame | null = null,
  ) => add({ kind, position: [x, y, z], scale: [w, h, d], rotation: 0, tint }, dept);

  // The grounds: the truck apron in front of the warehouse, the road along the front and the car
  // park beside the office, all just above the slab so they do not flicker against it.
  const f = layout.floor;
  const front = f.y + f.d;
  box("paving", [f.x + f.w / 2, y0 + 0.03, front - 1.4 * s], [f.w, 0.06, 2.4 * s], "paving");
  const warehouse = layout.buildings.find((b) => b.kind === "warehouse");
  if (warehouse) {
    const apronD = front - 2.6 * s - (warehouse.box.y + warehouse.box.d);
    if (apronD > 1)
      box(
        "paving",
        [
          warehouse.box.x + warehouse.box.w / 2,
          y0 + 0.03,
          warehouse.box.y + warehouse.box.d + apronD / 2,
        ],
        [warehouse.box.w, 0.06, apronD],
        "paving",
      );
  }
  const office = layout.buildings.find((b) => b.kind === "office");
  if (office) {
    // Staff parking to the office's left, two rows of cars.
    const px = office.box.x - 2.6 * s;
    for (let i = 0; i < 4; i++)
      box(
        "car",
        [px, y0 + 0.45 * s, office.box.y + 1.6 * s + i * 2.6 * s],
        [1.6 * s, 0.9 * s, 2.2 * s],
        i % 2 ? "metal" : "dark",
      );
  }
  // Trees along the front and the right-hand edge of the lot.
  for (let x = f.x + 2 * s; x < f.x + f.w - 1; x += 5.5 * s)
    box("tree", [x, y0 + 1.6 * s, front - 0.2 * s], [1.8 * s, 3.2 * s, 1.8 * s], "tree");
  for (let z = f.y + 3 * s; z < front - 4 * s; z += 6 * s)
    box("tree", [f.x + f.w - 0.6 * s, y0 + 1.6 * s, z], [1.8 * s, 3.2 * s, 1.8 * s], "tree");

  for (const b of layout.buildings) {
    const H = BUILDING_HEIGHT[b.kind] * s;
    const [cx, cz] = centerOf(b.box);
    const roof = y0 + H;
    const zones = layout.zones.filter(
      (z) =>
        z.building === b.kind &&
        z.box.x >= b.box.x - 0.01 &&
        z.box.x + z.box.w <= b.box.x + b.box.w + 0.01,
    );
    // The walls.
    box("body", [cx, y0 + H / 2, cz], [b.box.w, H, b.box.d], "shell");

    // Each area's roof: sawtooth glass over the hall, a panel elsewhere, in the area's status.
    for (const z of zones) {
      const dept = frameOf(z);
      const [zx, zz] = centerOf(z.box);
      if (b.kind === "processing") {
        const teeth = Math.max(1, Math.round(z.box.w / (4 * s)));
        const tw = z.box.w / teeth;
        for (let i = 0; i < teeth; i++)
          add(
            {
              kind: "saw",
              position: [z.box.x + tw * (i + 0.5), roof, zz],
              scale: [tw * 0.98, SAW_RISE * s, z.box.d * 0.98],
              rotation: 0,
              tint: "roof",
            },
            dept,
          );
      } else {
        box(
          "panel",
          [zx, roof + 0.12, zz],
          [z.box.w - 0.5 * s, 0.24, z.box.d - 0.5 * s],
          "zone",
          dept,
        );
      }
    }

    // Windows on the two faces the camera sees, each lit with the area behind it.
    const frontZ = b.box.y + b.box.d;
    const sideX = b.box.x + b.box.w;
    const bands =
      b.kind === "office"
        ? [0.22, 0.5, 0.78]
        : b.kind === "warehouse"
          ? [0.82]
          : b.kind === "lab"
            ? [0.55]
            : [0.6];
    const step = (b.kind === "office" ? 1.5 : 2) * s;
    const winW = (b.kind === "office" ? 1 : 1.3) * s;
    const winH = (b.kind === "warehouse" ? 0.6 : 0.9) * s;
    for (const band of bands) {
      const y = y0 + H * band;
      for (let x = b.box.x + step * 0.75; x < sideX - step * 0.5; x += step) {
        const z = zoneAt(zones, x, frontZ - 0.1);
        // The receiving and shipping faces are dock doors, not windows.
        if (b.kind === "warehouse" && band < 0.9 && z?.area === "receiving") continue;
        add(
          {
            kind: "window",
            position: [x, y, frontZ + 0.05],
            scale: [winW, winH, 0.1],
            rotation: 0,
            tint: "lit",
          },
          z ? frameOf(z) : null,
        );
      }
      for (let zz = b.box.y + step * 0.75; zz < frontZ - step * 0.5; zz += step) {
        const z = zoneAt(zones, sideX - 0.1, zz);
        add(
          {
            kind: "window",
            position: [sideX + 0.05, y, zz],
            scale: [0.1, winH, winW],
            rotation: 0,
            tint: "lit",
          },
          z ? frameOf(z) : null,
        );
      }
    }

    switch (b.kind) {
      case "warehouse": {
        // Dock doors and a dock plate along receiving's front, where the trucks back in.
        const recv = zones.find((z) => z.area === "receiving");
        if (recv) {
          const doors = Math.max(2, Math.floor(recv.box.w / (4 * s)));
          const dw = recv.box.w / doors;
          for (let i = 0; i < doors; i++)
            box(
              "door",
              [recv.box.x + dw * (i + 0.5), y0 + 1.6 * s, frontZ + 0.07],
              [dw * 0.62, 3.2 * s, 0.12],
              "dark",
            );
          box(
            "dock",
            [recv.box.x + recv.box.w / 2, y0 + 0.5 * s, frontZ + 1 * s],
            [recv.box.w * 0.92, 1 * s, 2 * s],
            "pad",
          );
        }
        // Shipping's doors on the side yard.
        const ship = zones.find((z) => z.area === "shipping");
        if (ship && ship.box.x + ship.box.w >= sideX - 0.01)
          box(
            "door",
            [sideX + 0.07, y0 + 1.6 * s, ship.box.y + ship.box.d / 2],
            [0.12, 3.2 * s, ship.box.d * 0.5],
            "dark",
          );
        // Rooftop units over the storage.
        for (const z of zones.filter((x) => x.area === "rm_storage" || x.area === "fg_storage")) {
          const [zx, zz] = centerOf(z.box);
          box("unit", [zx, roof + 0.7 * s, zz - z.box.d * 0.2], [2.2 * s, 1 * s, 1.6 * s], "metal");
        }
        break;
      }
      case "processing": {
        box("door", [cx, y0 + 1.1 * s, frontZ + 0.07], [2 * s, 2.2 * s, 0.12], "dark");
        for (const z of zones) {
          const [zx, zz] = centerOf(z.box);
          const dept = frameOf(z);
          const top = roof + SAW_RISE * s;
          if (z.area === "weigh_cells")
            for (const dx of [-0.22, 0.18])
              add(
                {
                  kind: "silo",
                  position: [zx + z.box.w * dx, top + 2.2 * s, zz - z.box.d * 0.25],
                  scale: [1.8 * s, 4.4 * s, 1.8 * s],
                  rotation: 0,
                  tint: "metal",
                },
                dept,
              );
          if (z.area === "formulation")
            add(
              {
                kind: "tank",
                position: [zx, top + 1.6 * s, zz - z.box.d * 0.2],
                scale: [3 * s, 3.2 * s, 3 * s],
                rotation: 0,
                tint: "metal",
              },
              dept,
            );
          if (z.area === "tableting") {
            add(
              {
                kind: "stack",
                position: [zx + z.box.w * 0.25, top + 2 * s, zz - z.box.d * 0.3],
                scale: [0.8 * s, 4 * s, 0.8 * s],
                rotation: 0,
                tint: "dark",
              },
              dept,
            );
            box(
              "unit",
              [zx - z.box.w * 0.15, top + 0.5 * s, zz],
              [2.2 * s, 1 * s, 1.6 * s],
              "metal",
            );
          }
        }
        break;
      }
      case "dryside": {
        // A roller door for the pallets at the side, vents over the lines.
        box("door", [sideX + 0.07, y0 + 1.5 * s, cz], [0.12, 3 * s, 3 * s], "dark");
        for (const z of zones) {
          const [zx, zz] = centerOf(z.box);
          box(
            "vent",
            [zx, roof + 0.55 * s, zz - z.box.d * 0.25],
            [0.9 * s, 0.7 * s, 0.9 * s],
            "metal",
          );
        }
        break;
      }
      case "lab": {
        box("door", [cx, y0 + 1.1 * s, frontZ + 0.07], [1.6 * s, 2.2 * s, 0.12], "dark");
        add(
          {
            kind: "stack",
            position: [b.box.x + 1 * s, roof + 1.2 * s, b.box.y + 1 * s],
            scale: [0.6 * s, 2.4 * s, 0.6 * s],
            rotation: 0,
            tint: "metal",
          },
          zones[0] ? frameOf(zones[0]) : null,
        );
        break;
      }
      case "office": {
        // The entrance: a door and a canopy over it.
        box("door", [cx, y0 + 1.1 * s, frontZ + 0.07], [1.8 * s, 2.2 * s, 0.12], "dark");
        box("unit", [cx, y0 + 2.5 * s, frontZ + 1 * s], [4 * s, 0.25, 2 * s], "metal");
        box(
          "unit",
          [cx - b.box.w * 0.2, roof + 0.6 * s, cz - b.box.d * 0.25],
          [2 * s, 1 * s, 1.5 * s],
          "metal",
        );
        break;
      }
    }
  }

  for (const d of layout.decor) {
    const [cx, cz] = centerOf(d.box);
    if (d.kind === "gatehouse") {
      box("body", [cx, y0 + 1.2 * s, cz], [d.box.w, 2.4 * s, d.box.d], "shell");
      add({
        kind: "gable",
        position: [cx, y0 + 2.4 * s, cz],
        scale: [d.box.w + 0.4, 1 * s, d.box.d + 0.4],
        rotation: 0,
        tint: "dark",
      });
    } else {
      // The utilities yard: a pad, three tanks, a boiler stack and two chillers.
      box("paving", [cx, y0 + 0.05, cz], [d.box.w, 0.1, d.box.d], "pad");
      for (const [i, dz] of [-0.3, 0, 0.3].entries())
        add({
          kind: "silo",
          position: [d.box.x + d.box.w * 0.3, y0 + 2 * s, cz + d.box.d * dz],
          scale: [2 * s, 4 * s, 2 * s],
          rotation: i,
          tint: "metal",
        });
      add({
        kind: "stack",
        position: [d.box.x + d.box.w * 0.75, y0 + 4 * s, d.box.y + d.box.d * 0.25],
        scale: [0.8 * s, 8 * s, 0.8 * s],
        rotation: 0,
        tint: "dark",
      });
      for (const dz of [0.55, 0.8])
        box(
          "unit",
          [d.box.x + d.box.w * 0.72, y0 + 0.8 * s, d.box.y + d.box.d * dz],
          [3 * s, 1.6 * s, 2 * s],
          "metal",
        );
    }
  }
  return out;
}

/** The area a point on a building's face belongs to. */
function zoneAt(zones: Zone[], x: number, z: number): Zone | undefined {
  return zones.find(
    (q) =>
      x >= q.box.x - 0.01 &&
      x <= q.box.x + q.box.w + 0.01 &&
      z >= q.box.y - 0.01 &&
      z <= q.box.y + q.box.d + 0.01,
  );
}
