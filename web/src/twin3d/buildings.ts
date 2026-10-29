// Procedural buildings for the 3D twin: each department is a building kind built from a few
// primitives (a body, a roof, doors, windows, rooftop equipment), listed here as parts that the
// view draws with one instanced mesh per part kind. Pure: a function of the department's
// frame, so it is tested without a GPU. A department that is still grey stands as a low
// foundation; as it comes online it rises to its full height and its windows light up.

import { DEPT_Z, FLOOR_Z } from "../twin/layout.ts";
import type { DeptCode } from "../twin/model.ts";
import type { DeptFrame, V3 } from "./scene.ts";

// Local copies of two one-liners from scene.ts, which imports this file for the anchors.
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const centerOf = (b: { x: number; y: number; w: number; d: number }): [number, number] => [
  b.x + b.w / 2,
  b.y + b.d / 2,
];

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
  | "dock";

/** Which colour a part takes from the department's look. */
export type Tint = "body" | "roof" | "metal" | "dark" | "lit" | "pad";

export interface Part {
  kind: PartKind;
  position: V3;
  scale: V3;
  /** Radians about world y. */
  rotation: number;
  tint: Tint;
}

type Shape = "shed" | "process" | "office" | "lab" | "pack";

const SHAPE: Record<DeptCode, Shape> = {
  receiving: "shed",
  warehouse: "shed",
  weigh_dispense: "process",
  blending: "process",
  compression: "process",
  packaging: "pack",
  qc_lab: "lab",
  purchasing: "office",
  accounting: "office",
};

/** Full height of the body, by department. */
export const BUILDING_HEIGHT: Record<DeptCode, number> = {
  receiving: 4,
  warehouse: 4.5,
  weigh_dispense: 5.5,
  blending: 5.5,
  compression: 5.5,
  packaging: 4.5,
  qc_lab: 4.5,
  purchasing: 7.5,
  accounting: 7,
};

/** What stands on the roof at full height, so labels and arcs clear it. */
const ROOF_EXTRA: Record<DeptCode, number> = {
  receiving: 1.2,
  warehouse: 1.3,
  weigh_dispense: 4.2,
  blending: 3.2,
  compression: 4.2,
  packaging: 0.8,
  qc_lab: 1.4,
  purchasing: 1,
  accounting: 1,
};

/** 0 for a grey foundation, 1 for a building at full height, from a frame height in DEPT_Z. */
export function rise(frameHeight: number): number {
  return clamp01((frameHeight - DEPT_Z.offline) / (DEPT_Z.online - DEPT_Z.offline));
}

/** The body's height for a frame height. */
export function bodyHeight(code: DeptCode, frameHeight: number): number {
  return DEPT_Z.offline + rise(frameHeight) * (BUILDING_HEIGHT[code] - DEPT_Z.offline);
}

/** The highest point of the building above the floor slab, equipment included. */
export function topHeight(code: DeptCode, frameHeight: number): number {
  return bodyHeight(code, frameHeight) + rise(frameHeight) * ROOF_EXTRA[code];
}

/** The parts of one department's building for the frame. */
export function buildingParts(d: DeptFrame): Part[] {
  const k = rise(d.height);
  const h = bodyHeight(d.code, d.height);
  const [cx, cz] = centerOf(d.box);
  const w = d.box.w * 0.88;
  const depth = d.box.d * 0.88;
  const y0 = FLOOR_Z;
  const roof = y0 + h;
  const parts: Part[] = [
    {
      kind: "body",
      position: [cx, y0 + h / 2, cz],
      scale: [w, h, depth],
      rotation: 0,
      tint: "body",
    },
  ];
  if (k < 0.05) return parts;
  const shape = SHAPE[d.code];
  const front = cz + depth / 2;
  const side = cx + w / 2;

  // Windows on the two faces the camera sees (+x and +z), scaled up as the building rises.
  const windows = (rows: number[], step = 1.7, size = 1.1, tall = 0.8) => {
    for (const y of rows) {
      for (let x = cx - w / 2 + step; x < cx + w / 2 - step * 0.6; x += step)
        parts.push({
          kind: "window",
          position: [x, y, front + 0.06],
          scale: [size, tall * k, 0.1],
          rotation: 0,
          tint: "lit",
        });
      for (let z = cz - depth / 2 + step; z < cz + depth / 2 - step * 0.6; z += step)
        parts.push({
          kind: "window",
          position: [side + 0.06, y, z],
          scale: [0.1, tall * k, size],
          rotation: 0,
          tint: "lit",
        });
    }
  };

  switch (shape) {
    case "shed": {
      parts.push({
        kind: "gable",
        position: [cx, roof, cz],
        scale: [w, 1.2 * k, depth],
        rotation: 0,
        tint: "roof",
      });
      for (const x of [cx - w / 4, cx + w / 4])
        parts.push({
          kind: "door",
          position: [x, y0 + 1.3 * k, front + 0.07],
          scale: [2.6, 2.6 * k, 0.12],
          rotation: 0,
          tint: "dark",
        });
      windows([y0 + h - 0.9], 1.7, 1.1, 0.5);
      if (d.code === "receiving")
        parts.push({
          kind: "dock",
          position: [cx, y0 + 0.35 * k, front + 0.9],
          scale: [w * 0.85, 0.7 * k, 1.8],
          rotation: 0,
          tint: "pad",
        });
      break;
    }
    case "process": {
      const teeth = 3;
      const tw = w / teeth;
      for (let i = 0; i < teeth; i++)
        parts.push({
          kind: "saw",
          position: [cx - w / 2 + tw * (i + 0.5), roof, cz],
          scale: [tw, 1 * k, depth],
          rotation: 0,
          tint: "roof",
        });
      windows([y0 + h * 0.55], 1.7, 1.1, 0.7);
      parts.push({
        kind: "door",
        position: [cx, y0 + 1.1 * k, front + 0.07],
        scale: [2.2, 2.2 * k, 0.12],
        rotation: 0,
        tint: "dark",
      });
      if (d.code === "weigh_dispense") {
        for (const x of [cx - w * 0.28, cx - w * 0.05])
          parts.push({
            kind: "silo",
            position: [x, roof + 1 + 1.5 * k, cz - depth * 0.22],
            scale: [1.8, 3 * k, 1.8],
            rotation: 0,
            tint: "metal",
          });
      } else if (d.code === "blending") {
        parts.push({
          kind: "tank",
          position: [cx - w * 0.2, roof + 1 + 1.1 * k, cz - depth * 0.2],
          scale: [3.2, 2.2 * k, 3.2],
          rotation: 0,
          tint: "metal",
        });
      } else {
        parts.push({
          kind: "stack",
          position: [cx - w * 0.35, roof + 1 + 1.6 * k, cz - depth * 0.35],
          scale: [0.8, 3.2 * k, 0.8],
          rotation: 0,
          tint: "dark",
        });
        parts.push({
          kind: "unit",
          position: [cx + w * 0.2, roof + 1 + 0.45 * k, cz - depth * 0.2],
          scale: [2.2, 0.9 * k, 1.6],
          rotation: 0,
          tint: "metal",
        });
      }
      break;
    }
    case "office": {
      const rows: number[] = [];
      for (let y = y0 + 1.3; y < y0 + h - 0.6; y += 1.6) rows.push(y);
      windows(rows, 1.6, 1.0, 0.8);
      parts.push({
        kind: "door",
        position: [cx, y0 + 1.1 * k, front + 0.07],
        scale: [1.8, 2.2 * k, 0.12],
        rotation: 0,
        tint: "dark",
      });
      parts.push({
        kind: "unit",
        position: [cx - w * 0.25, roof + 0.45 * k, cz - depth * 0.25],
        scale: [2, 0.9 * k, 1.5],
        rotation: 0,
        tint: "metal",
      });
      break;
    }
    case "lab": {
      windows([y0 + h * 0.6], 1.5, 1.0, 0.9);
      parts.push({
        kind: "door",
        position: [cx, y0 + 1.1 * k, front + 0.07],
        scale: [1.6, 2.2 * k, 0.12],
        rotation: 0,
        tint: "dark",
      });
      parts.push({
        kind: "stack",
        position: [cx - w / 2 + 0.9, roof + 1 * k, cz - depth / 2 + 0.9],
        scale: [0.6, 2 * k, 0.6],
        rotation: 0,
        tint: "metal",
      });
      break;
    }
    case "pack": {
      windows([y0 + h * 0.6], 1.7, 1.1, 0.6);
      parts.push({
        kind: "door",
        position: [cx + w / 4, y0 + 1.3 * k, front + 0.07],
        scale: [2.6, 2.6 * k, 0.12],
        rotation: 0,
        tint: "dark",
      });
      for (const x of [cx - w * 0.3, cx, cx + w * 0.3])
        parts.push({
          kind: "vent",
          position: [x, roof + 0.35 * k, cz - depth * 0.25],
          scale: [0.9, 0.7 * k, 0.9],
          rotation: 0,
          tint: "metal",
        });
      break;
    }
  }
  return parts;
}
