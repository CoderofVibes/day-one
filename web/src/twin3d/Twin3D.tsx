// The 3D twin: the same TwinState and layout.ts as the flat map, drawn with three.js through
// React Three Fiber (docs/TWIN3D.md, research 16). Every frame is a function of the previous
// step's state, the current step's state and a demo clock: wall time scaled in normal use, a
// fixed 1000/60 ms per frame in record mode (?record=1), where the run also advances itself
// one step every STEP_MS. Procedural geometry only; labels are DOM, so no font file. Staff see
// dollars, POs, plants and names; hashes and accounts appear only behind the curtain.

import { CameraControls, type CameraControlsImpl, Edges, Html, Line } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import type { RunData } from "../run.ts";
import {
  AREAS,
  type AreaCode,
  type Box,
  FACILITY_LAYOUTS,
  FLOOR_Z,
  PAD_Z,
  PADS,
  siteScale,
} from "../twin/layout.ts";
import {
  deriveTwinState,
  type FacilityId,
  type Flow,
  formatCents,
  formatQuotes,
  formatTwinState,
  type QuoteStanding,
  type TwinOptions,
  type TwinState,
} from "../twin/model.ts";
import { type Focus, flowObjectId, supplierObjectId } from "../twin/objects.ts";
import {
  BUILDING_HEIGHT,
  type PartKind,
  type SitePart,
  siteParts,
  type Tint,
  topHeight,
} from "./buildings.ts";
import {
  anchor3,
  arc3,
  BEAT_MS,
  blendDepartments,
  blendEscrowCents,
  blendFlows,
  blendLots,
  CAMERA_LIMITS,
  CAMERA_MS,
  cameraPosition,
  centerOf,
  clamp01,
  type DeptFrame,
  type DeptLook,
  depots,
  dock3,
  FLY_MS,
  type FlowFrame,
  type Framing,
  framingFor,
  isPooled,
  LABEL_DISTANCE,
  type LotFrame,
  lerp,
  lerpFraming,
  objectFraming,
  RECORD_FRAME_MS,
  road3,
  STEP_MS,
  targetBounds,
  type V3,
  viewFraming,
  world,
} from "./scene.ts";
import "./twin3d.css";

export interface Twin3DProps {
  run: RunData;
  /** The step index shown; transitions play from the step before it. */
  at: number;
  curtain: boolean;
  /** Fixed-step clock and the run advancing itself (research 16). */
  record: boolean;
  /** Record mode reports the step it has reached. */
  onStep?: (at: number) => void;
  /** How the run starts (every plant online for the group run); the demo's default otherwise. */
  options?: TwinOptions;
  /** An area was clicked: the plant map opens its sheet. */
  onPick?: (pick: AreaPick) => void;
  /** The area whose sheet is open, outlined on the map. */
  picked?: AreaPick | null;
  /**
   * An object was clicked (src/twin/objects.ts ids): a plant, a pad, a depot, a coin, a truck, a
   * lot, and a building's department when `onPick` is not set.
   */
  onSelect?: (id: string) => void;
  /** A preset or object to fly to; each new `seq` starts one move. */
  camera?: CameraRequest | null;
}

/** An area of a plant, as the maps hand it to the area sheet. */
export interface AreaPick {
  facility: FacilityId;
  area: AreaCode;
}

// ------------------------------------------------------------------ theme

/** The flat map's palette, read from the page's CSS variables so light and dark match. */
interface Theme {
  bg: string;
  panel: string;
  ink: string;
  muted: string;
  floor: string;
  off: string;
  warm: string;
  steady: string;
  pad: string;
  accent: string;
  money: string;
  quarantine: string;
  warn: string;
  ok: string;
}

// The light tokens (src/tokens.css), read from the page at mount so dark mode and any later
// token change reach the scene without touching this file.
const FALLBACK: Theme = {
  bg: "#f4f3ee",
  panel: "#ffffff",
  ink: "#1b1d20",
  muted: "#5c6370",
  floor: "#e9e7e0",
  off: "#cfccc3",
  warm: "#9ed1c2",
  steady: "#8dbfae",
  pad: "#d8d5cc",
  accent: "#1f6f5c",
  money: "#9a6d00",
  quarantine: "#b8731a",
  warn: "#a9261d",
  ok: "#1b6b3a",
};

const VARS: Record<keyof Theme, string> = {
  bg: "--map-floor",
  panel: "--surface",
  ink: "--ink",
  muted: "--ink-2",
  floor: "--surface-2",
  off: "--map-off",
  warm: "--map-warm",
  steady: "--map-steady",
  pad: "--map-pad",
  accent: "--brand",
  money: "--money",
  quarantine: "--quarantine",
  warn: "--refused",
  ok: "--paid",
};

function readTheme(): Theme {
  const style = getComputedStyle(document.documentElement);
  const theme = { ...FALLBACK };
  for (const key of Object.keys(VARS) as (keyof Theme)[]) {
    const value = style.getPropertyValue(VARS[key]).trim();
    if (value) theme[key] = value;
  }
  return theme;
}

function useTheme(): Theme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTheme(readTheme());
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return theme;
}

function useReducedMotion(): boolean {
  return useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
}

// ------------------------------------------------------------------ the frame

/** What every part of the scene reads each frame; written once per frame by the driver. */
interface Frame {
  t: number;
  u: number;
  departments: DeptFrame[];
  flows: FlowFrame[];
  lots: LotFrame[];
  escrowCents: number;
  /** The sites' buildings and grounds, one part list per frame (buildings.ts). */
  parts: SitePart[];
  /** How far the camera is from what it looks at; department labels hide when far. */
  cameraDistance: number;
}

const FrameContext = createContext<React.RefObject<Frame> | null>(null);

/** What the stage's buttons ask of the camera; read and cleared by StoryCamera each frame. */
interface CameraCommand {
  /** Multiply the distance by this (below 1 closer); 1 for nothing pending. */
  zoom: number;
  /** Hand the camera back to the story's framing for the step. */
  fit: boolean;
}
const CommandContext = createContext<React.RefObject<CameraCommand> | null>(null);

/** Selecting an object by its id (src/twin/objects.ts); null when the stage has no inspector. */
const SelectContext = createContext<((id: string) => void) | null>(null);

/** Pointer props that make a mesh select an object: a click selects it, hover shows the hand. */
function useSelectable(id: string | undefined) {
  const select = useContext(SelectContext);
  if (!select || !id) return {};
  return {
    onClick: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      select(id);
    },
    onPointerOver: (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      document.body.style.cursor = "";
    },
  };
}

/** The stage's layers (docs/VISION.md §6.5.6): the buildings always, the rest switchable. */
export interface Layers {
  equipment: boolean;
  money: boolean;
  labels: boolean;
}

/** Equipment on and around the buildings: silos, tanks, stacks, rooftop units and vents. */
const EQUIPMENT_KINDS = new Set<PartKind>(["silo", "tank", "stack", "unit", "vent"]);

/** A label's box on screen this frame, for the overprint pass (LabelPass). */
interface LabelSlot {
  /** Which label wins an overprint: coins over lots over plant names over pads, depots, pills. */
  rank: number;
  /** Depth; nearer wins among equals. */
  z: number;
  x: number;
  y: number;
  /** 0 while the label is out of frame or unmeasured, so it blocks nothing. */
  w: number;
  h: number;
  hidden: boolean;
}

const SlotsContext = createContext<React.RefObject<Map<string, LabelSlot>> | null>(null);

const RANK = { flow: 9, lot: 8, plant: 7, pad: 6, depot: 5, dept: 1 } as const;

function useFrameRef(): React.RefObject<Frame> {
  const ref = useContext(FrameContext);
  if (!ref) throw new Error("Twin3D parts must be inside the scene");
  return ref;
}

/**
 * Advances the demo clock and blends the two states into the frame. In record mode the clock
 * is a frame counter and the step is a function of it; otherwise the clock follows wall time
 * and a transition starts whenever the step changes.
 */
function Driver({
  prev,
  next,
  at,
  last,
  record,
  reduced,
  onStep,
  frame,
}: {
  prev: TwinState;
  next: TwinState;
  at: number;
  last: number;
  record: boolean;
  reduced: boolean;
  onStep: ((at: number) => void) | undefined;
  frame: React.RefObject<Frame>;
}) {
  const clock = useRef(0);
  const start = useRef(0);
  const seen = useRef(at);
  if (seen.current !== at) {
    seen.current = at;
    // A step the twin advanced itself starts on its own grid; one set from outside (the video
    // page's storyboard clock) starts now.
    start.current = record && onStep ? at * STEP_MS : clock.current;
  }
  useFrame((_, delta) => {
    clock.current += record ? RECORD_FRAME_MS : Math.min(delta * 1000, 100);
    const t = clock.current;
    if (window.dayOneTwin) window.dayOneTwin.clock = t;
    if (record && onStep) {
      const due = Math.min(last, Math.floor(t / STEP_MS));
      if (due !== at) onStep(due);
    }
    const u = reduced ? 1 : clamp01((t - start.current) / BEAT_MS);
    const departments = blendDepartments(prev, next, u);
    frame.current = {
      t,
      u,
      departments,
      flows: blendFlows(prev, next, u),
      lots: blendLots(prev, next, u),
      escrowCents: blendEscrowCents(prev, next, u),
      parts: siteParts(departments),
      cameraDistance: frame.current.cameraDistance,
    };
  }, -1);
  return null;
}

// ------------------------------------------------------------------ camera

/** A camera move asked for from outside the canvas: a preset view or an object; a new seq starts it. */
export interface CameraRequest {
  seq: number;
  view?: string;
  focus?: Focus;
}

const TARGET = new THREE.Vector3();
/** The inspector's width and margin on a wide stage (twin3d.css .twin-inspector); a fly-to keeps clear of it. */
const INSPECTOR_PX = 400;

/** The current camera as a framing, so a handoff from free orbit eases from where it is. */
function framingOf(camera: THREE.Camera, target: THREE.Vector3): Framing {
  const d = camera.position.clone().sub(target);
  const distance = d.length() || 1;
  return {
    target: [target.x, target.y, target.z],
    distance,
    azimuth: Math.atan2(d.x, d.z),
    elevation: Math.asin(clamp01(d.y / distance)),
  };
}

/**
 * The camera rig: drei's CameraControls (camera-controls) under the user's hands, with damping
 * and the limits of CAMERA_LIMITS, and three ways the camera is moved for them. The story takes
 * it to each step's shot; a preset or a picked object flies it there over FLY_MS and leaves it
 * with the user; the zoom buttons dolly it. Every move is an eased framing set each frame on the
 * demo clock, so record mode stays frame-exact and reduced motion makes each move a cut.
 */
function StoryCamera({
  title,
  at,
  pooled,
  record,
  reduced,
  request,
}: {
  title: string;
  at: number;
  /** The run holds a pooled PO: the money steps frame both plants' purchasing and the vault. */
  pooled: boolean;
  record: boolean;
  reduced: boolean;
  request: CameraRequest | null;
}) {
  const frame = useFrameRef();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useRef<CameraControlsImpl>(null);
  /** story: the step's shot; fly: a preset or object, then free; free: the user's. */
  const mode = useRef<"story" | "fly" | "free">("story");
  const from = useRef<Framing>(framingFor(title, size, pooled));
  const to = useRef<Framing>(framingFor(title, size, pooled));
  const since = useRef(0);
  const length = useRef(CAMERA_MS);
  const seen = useRef(-1);
  const seenRequest = useRef(0);
  const sized = useRef(`${size.width}x${size.height}`);
  const command = useContext(CommandContext);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const { min, max } = targetBounds();
    c.setBoundary(new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)));
  }, []);

  useFrame(() => {
    const f = frame.current;
    const c = controls.current;
    if (!c) return;
    c.getTarget(TARGET, false);
    const move = (target: Framing, ms: number, next: "story" | "fly") => {
      from.current = framingOf(camera, TARGET);
      to.current = target;
      since.current = f.t;
      length.current = ms;
      mode.current = next;
    };
    const cmd = command?.current;
    if (cmd?.fit) {
      // "Fit": the story takes the camera back, easing from where the user left it.
      cmd.fit = false;
      move(framingFor(title, size, pooled), CAMERA_MS, "story");
    }
    if (cmd && cmd.zoom !== 1 && !record) {
      // A zoom button: the camera dollies along its line to the target and stays where it lands.
      c.dollyTo(
        Math.min(
          CAMERA_LIMITS.maxDistance,
          Math.max(CAMERA_LIMITS.minDistance, c.distance * cmd.zoom),
        ),
        !reduced,
      );
      cmd.zoom = 1;
      mode.current = "free";
    }
    const sizeNow = `${size.width}x${size.height}`;
    if (seen.current !== at) {
      // A new step: the story takes the camera back from wherever the user left it.
      seen.current = at;
      sized.current = sizeNow;
      move(framingFor(title, size, pooled), CAMERA_MS, "story");
    } else if (sized.current !== sizeNow && mode.current === "story") {
      // The stage changed size (a rotated phone, a resized window, full screen): refit the shot.
      sized.current = sizeNow;
      move(framingFor(title, size, pooled), CAMERA_MS, "story");
    }
    if (request && request.seq !== seenRequest.current && !record) {
      seenRequest.current = request.seq;
      const target = request.view
        ? viewFraming(request.view, size)
        : request.focus
          ? objectFraming(request.focus, size, size.width >= 768 ? INSPECTOR_PX : 0)
          : undefined;
      if (target) move(target, FLY_MS, "fly");
    }
    if (window.dayOneTwin) window.dayOneTwin.camera = camera.position.toArray();
    if (mode.current === "free" && !record) {
      f.cameraDistance = camera.position.distanceTo(TARGET);
      return;
    }
    const u = reduced ? 1 : clamp01((f.t - since.current) / length.current);
    const now = lerpFraming(from.current, to.current, u);
    const p = cameraPosition(now);
    c.setLookAt(p[0], p[1], p[2], now.target[0], now.target[1], now.target[2], false);
    c.update(0);
    if (mode.current === "fly" && u >= 1) mode.current = "free";
    f.cameraDistance = camera.position.distanceTo(c.getTarget(TARGET));
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      enabled={!record}
      minDistance={CAMERA_LIMITS.minDistance}
      maxDistance={CAMERA_LIMITS.maxDistance}
      minPolarAngle={CAMERA_LIMITS.minPolar}
      maxPolarAngle={CAMERA_LIMITS.maxPolar}
      smoothTime={0.25}
      draggingSmoothTime={0.12}
      onStart={() => {
        mode.current = "free";
      }}
    />
  );
}

// ------------------------------------------------------------------ labels

const SCREEN = new THREE.Vector3();

/**
 * A DOM label at its parent's position that fades out when any of it would cross the frame
 * edge: half a plant name at the edge of the stage reads as a mistake, and the story camera
 * frames the step's subjects, not every label. `stackPx` lifts the label by whole pixels so
 * labels on coins stacked in the vault stay apart at every camera distance. Each label also
 * reports its box to the overprint pass and hides when a higher-ranked or nearer label covers it.
 */
function Label({
  className,
  zIndexRange,
  rank,
  stackPx = 0,
  children,
}: {
  className: string;
  zIndexRange: [number, number];
  rank: number;
  stackPx?: number;
  children: React.ReactNode;
}) {
  const anchor = useRef<THREE.Group>(null);
  const div = useRef<HTMLDivElement>(null);
  const box = useRef<[number, number]>([0, 0]);
  const observer = useRef<ResizeObserver | null>(null);
  const shown = useRef(true);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const slots = useContext(SlotsContext);
  const id = useId();
  useEffect(() => () => observer.current?.disconnect(), []);
  useEffect(() => () => void slots?.current?.delete(id), [slots, id]);
  useFrame(() => {
    const g = anchor.current;
    const el = div.current;
    if (!g || !el) return;
    if (!observer.current) {
      // drei renders the div in its own React root, so it exists only after our first frames.
      // Measured once here and then off the frame loop, so the check forces no layout.
      box.current = [el.offsetWidth, el.offsetHeight];
      observer.current = new ResizeObserver(() => {
        box.current = [el.offsetWidth, el.offsetHeight];
      });
      observer.current.observe(el);
    }
    g.getWorldPosition(SCREEN).project(camera);
    const [w, h] = box.current;
    const x = ((SCREEN.x + 1) / 2) * size.width;
    const y = ((1 - SCREEN.y) / 2) * size.height - stackPx;
    const inFrame =
      SCREEN.z < 1 &&
      x - w / 2 >= 0 &&
      x + w / 2 <= size.width &&
      y - h / 2 >= 0 &&
      y + h / 2 <= size.height;
    let covered = false;
    if (slots?.current) {
      const slot = slots.current.get(id);
      covered = slot?.hidden ?? false;
      slots.current.set(id, {
        rank,
        z: SCREEN.z,
        x,
        y,
        w: inFrame ? w : 0,
        h,
        hidden: covered,
      });
    }
    const show = inFrame && !covered;
    if (show !== shown.current) {
      shown.current = show;
      el.style.opacity = show ? "" : "0";
    }
  });
  return (
    <group ref={anchor}>
      <Html
        ref={div}
        center
        pointerEvents="none"
        zIndexRange={zIndexRange}
        className={className}
        style={stackPx ? { marginTop: -stackPx } : undefined}
      >
        {children}
      </Html>
    </group>
  );
}

/**
 * The overprint pass over the boxes the labels reported: labels are taken in rank order,
 * nearer first among equals, and one that would overprint a label already kept hides until
 * the camera moves them apart. A hidden label keeps reporting, so the picture is a function
 * of the camera, not of the order things happened in. It runs at the default priority (a
 * positive one would switch off fiber's own rendering), so a label mounted after it reports
 * a frame late; the fade covers that.
 */
function LabelPass() {
  const slots = useContext(SlotsContext);
  useFrame(() => {
    const all = slots?.current;
    if (!all) return;
    const boxes = [...all.values()].filter((s) => s.w > 0);
    boxes.sort((a, b) => b.rank - a.rank || a.z - b.z);
    const kept: LabelSlot[] = [];
    for (const s of boxes) {
      // A few pixels of touching corners is not overprinting.
      s.hidden = kept.some(
        (k) =>
          Math.abs(k.x - s.x) < (k.w + s.w) / 2 - 4 && Math.abs(k.y - s.y) < (k.h + s.h) / 2 - 4,
      );
      if (!s.hidden) kept.push(s);
    }
  });
  return null;
}

// ------------------------------------------------------------------ buildings

const COLORS = new THREE.Color();
const COLOR_B = new THREE.Color();
const MATRIX = new THREE.Matrix4();
const POSITION = new THREE.Vector3();
const SCALE = new THREE.Vector3();
const QUAT = new THREE.Quaternion();

function lookColor(theme: Theme, look: DeptLook): string {
  switch (look) {
    case "online":
      return theme.accent;
    case "onboarding":
      return theme.warm;
    case "steady":
      return theme.steady;
    default:
      return theme.off;
  }
}

/** Lit windows: a warm light in both themes. */
const LIT = "#f6e3a1";
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * The instanced meshes, one per geometry, and the part kinds each draws: one draw call per group
 * (and one more for its shadow), whatever the number of buildings. The sites need well under the
 * capacities.
 */
type MeshGroup = "box" | "round" | "cone" | "gable" | "saw" | "window";
const GROUP_OF: Record<PartKind, MeshGroup> = {
  body: "box",
  door: "box",
  vent: "box",
  unit: "box",
  dock: "box",
  panel: "box",
  paving: "box",
  car: "box",
  silo: "round",
  tank: "round",
  stack: "round",
  tree: "cone",
  gable: "gable",
  saw: "saw",
  window: "window",
};
const GROUP_CAPACITY: Record<MeshGroup, number> = {
  box: 700,
  round: 60,
  cone: 120,
  gable: 8,
  saw: 96,
  window: 1600,
};

/** A unit prism: a gable (ridge in the middle) or a sawtooth (vertical face at +x). */
function prism(saw: boolean): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(saw ? 0.5 : 0, 1);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

/** How lit a department's windows are: dark offline, flickering on while onboarding, on when online. */
function litness(look: DeptLook, t: number): number {
  if (look === "online" || look === "steady") return 1;
  if (look === "onboarding") return 0.45 + 0.45 * Math.sin(t / 170);
  return 0;
}

/** Trees: one muted green in both themes. */
const TREE = "#6f9a78";

function tintColor(theme: Theme, tint: Tint, d: DeptFrame | null, t: number): THREE.Color {
  switch (tint) {
    case "shell":
      return COLORS.set(theme.panel).lerp(COLOR_B.set(theme.off), 0.3);
    case "zone":
      if (!d) return COLORS.set(theme.off);
      return COLORS.set(lookColor(theme, d.from)).lerp(
        COLOR_B.set(lookColor(theme, d.look)),
        d.mix,
      );
    case "roof":
      return tintColor(theme, "zone", d, t).multiplyScalar(0.86);
    case "paving":
      return COLORS.set(theme.off).lerp(COLOR_B.set(theme.ink), 0.12);
    case "tree":
      return COLORS.set(TREE);
    case "metal":
      return COLORS.set(theme.off).lerp(COLOR_B.set(theme.panel), 0.5);
    case "dark":
      return COLORS.set(theme.ink).lerp(COLOR_B.set(theme.off), 0.35);
    case "pad":
      return COLORS.set(theme.pad);
    default: {
      const on = d ? lerp(litness(d.from, t), litness(d.look, t), d.mix) : 0.15;
      return COLORS.set(theme.off).multiplyScalar(0.5).lerp(COLOR_B.set(LIT), on);
    }
  }
}

/** Every building and the grounds: one instanced mesh per geometry (buildings.ts). */
/** The area under a point on the ground plane, at any plant. */
function areaAt(x: number, z: number): AreaPick | null {
  for (const f of FACILITY_LAYOUTS)
    for (const zone of f.zones)
      if (
        x >= zone.box.x &&
        x <= zone.box.x + zone.box.w &&
        z >= zone.box.y &&
        z <= zone.box.y + zone.box.d
      )
        return { facility: f.id, area: zone.area };
  return null;
}

function Buildings({
  theme,
  onPick,
  equipment = true,
}: {
  theme: Theme;
  onPick?: ((pick: AreaPick) => void) | undefined;
  equipment?: boolean;
}) {
  const frame = useFrameRef();
  const meshes = useRef<Partial<Record<MeshGroup, THREE.InstancedMesh | null>>>({});
  const gable = useMemo(() => prism(false), []);
  const saw = useMemo(() => prism(true), []);
  useFrame(() => {
    const f = frame.current;
    const counts: Partial<Record<MeshGroup, number>> = {};
    for (const { part, dept } of f.parts) {
      if (!equipment && EQUIPMENT_KINDS.has(part.kind)) continue;
      const group = GROUP_OF[part.kind];
      const m = meshes.current[group];
      if (!m) continue;
      const i = counts[group] ?? 0;
      if (i >= GROUP_CAPACITY[group]) continue;
      counts[group] = i + 1;
      POSITION.set(part.position[0], part.position[1], part.position[2]);
      SCALE.set(
        Math.max(0.01, part.scale[0]),
        Math.max(0.01, part.scale[1]),
        Math.max(0.01, part.scale[2]),
      );
      QUAT.setFromAxisAngle(Y_AXIS, part.rotation);
      m.setMatrixAt(i, MATRIX.compose(POSITION, QUAT, SCALE));
      m.setColorAt(i, tintColor(theme, part.tint, dept, f.t));
    }
    for (const group of Object.keys(GROUP_CAPACITY) as MeshGroup[]) {
      const m = meshes.current[group];
      if (!m) continue;
      m.count = counts[group] ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });
  const ref = (group: MeshGroup) => (el: THREE.InstancedMesh | null) => {
    meshes.current[group] = el;
  };
  // A click on a building picks the area under it: the hit point, moved a little inward from the
  // face it struck, decides which area's footprint it is in. Without an area sheet, it selects
  // the area's department for the inspector.
  const select = useContext(SelectContext);
  const onArea =
    onPick ??
    (select ? (hit: AreaPick) => select(`dept-${hit.facility}-${AREAS[hit.area].dept}`) : null);
  const pick = onArea
    ? {
        onClick: (e: {
          stopPropagation: () => void;
          point: THREE.Vector3;
          face?: THREE.Face | null;
        }) => {
          e.stopPropagation();
          const n = e.face?.normal;
          const hit = areaAt(e.point.x - (n?.x ?? 0) * 0.2, e.point.z - (n?.z ?? 0) * 0.2);
          if (hit) onArea(hit);
        },
        onPointerOver: () => {
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          document.body.style.cursor = "";
        },
      }
    : {};
  return (
    <>
      <instancedMesh
        ref={ref("box")}
        args={[undefined, undefined, GROUP_CAPACITY.box]}
        castShadow
        receiveShadow
        frustumCulled={false}
        {...pick}
      >
        <boxGeometry />
        <meshStandardMaterial color="#ffffff" roughness={0.82} metalness={0.02} />
      </instancedMesh>
      <instancedMesh
        ref={ref("round")}
        args={[undefined, undefined, GROUP_CAPACITY.round]}
        castShadow
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.5, 0.5, 1, 18]} />
        <meshStandardMaterial color="#ffffff" roughness={0.45} metalness={0.3} />
      </instancedMesh>
      <instancedMesh
        ref={ref("cone")}
        args={[undefined, undefined, GROUP_CAPACITY.cone]}
        castShadow
        frustumCulled={false}
      >
        <coneGeometry args={[0.5, 1, 10]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} />
      </instancedMesh>
      <instancedMesh
        ref={ref("gable")}
        args={[gable, undefined, GROUP_CAPACITY.gable]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </instancedMesh>
      {/* The hall's sawtooth glass: smoother, so the status colour reads as lit panes. */}
      <instancedMesh
        ref={ref("saw")}
        args={[saw, undefined, GROUP_CAPACITY.saw]}
        castShadow
        frustumCulled={false}
        {...pick}
      >
        <meshStandardMaterial color="#ffffff" roughness={0.35} metalness={0.15} />
      </instancedMesh>
      <instancedMesh
        ref={ref("window")}
        args={[undefined, undefined, GROUP_CAPACITY.window]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>
    </>
  );
}

/** Up to this many rings at once: the departments a step changed and the ends of its new flows. */
const PINGS = 6;

/** Where a step's changes happened: departments whose status moved, and the ends of new flows. */
function pingPoints(prev: TwinState, next: TwinState): [number, number][] {
  const out: [number, number][] = [];
  const at = (facility: FacilityId, code: string) => {
    const box = FACILITY_LAYOUTS.find((l) => l.id === facility)?.departments.find(
      (d) => d.code === code,
    )?.box;
    if (box) out.push(centerOf(box));
  };
  for (const f of next.facilities)
    for (const d of f.departments) {
      const was = prev.facilities
        .find((x) => x.id === f.id)
        ?.departments.find((x) => x.code === d.code);
      if (was && was.status !== d.status) at(f.id, d.code);
    }
  for (const flow of next.flows) {
    if (prev.flows.some((x) => x.id === flow.id && x.status === flow.status)) continue;
    for (const end of [flow.from, flow.to]) {
      if (end.kind === "dept") at(end.facility, end.dept);
      else out.push(centerOf(PADS[end.kind]));
    }
  }
  return out.slice(0, PINGS);
}

/** Soft rings that spread and fade over the beat where the step's change happened. */
function Pings({ prev, next, theme }: { prev: TwinState; next: TwinState; theme: Theme }) {
  const frame = useFrameRef();
  const points = useMemo(() => pingPoints(prev, next), [prev, next]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(() => {
    const u = frame.current.u;
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const p = points[i];
      ring.visible = Boolean(p) && u < 1;
      if (!p) return;
      ring.position.set(p[0], 0.08, p[1]);
      const r = 2 + u * 9;
      ring.scale.set(r, r, r);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - u);
    });
  });
  return (
    <>
      {Array.from({ length: PINGS }, (_, i) => (
        <mesh
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool of rings, reused every step
          key={i}
          ref={(el) => {
            rings.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
          visible={false}
        >
          <ringGeometry args={[0.85, 1, 48]} />
          <meshBasicMaterial color={theme.accent} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** The picked area: an outline round it from the ground to its roof. */
function PickedOutline({ picked, theme }: { picked: AreaPick; theme: Theme }) {
  const layout = FACILITY_LAYOUTS.find((l) => l.id === picked.facility);
  const zone = layout?.zones.find((z) => z.area === picked.area);
  if (!zone) return null;
  const [cx, cy] = centerOf(zone.box);
  const h = BUILDING_HEIGHT[zone.building] * siteScale(picked.facility) + 0.6;
  return (
    <mesh position={[cx, FLOOR_Z + h / 2, cy]}>
      <boxGeometry args={[zone.box.w + 0.3, h, zone.box.d + 0.3]} />
      <meshBasicMaterial color={theme.accent} transparent opacity={0.12} depthWrite={false} />
      <Edges color={theme.accent} lineWidth={2} />
    </mesh>
  );
}

/**
 * The glow over each of Plant B's areas the moment its department comes online, and each
 * department's name (a pill) over its main area.
 */
function DepartmentExtras({ theme, hideLabels }: { theme: Theme; hideLabels: boolean }) {
  const frame = useFrameRef();
  const glows = useRef<(THREE.Mesh | null)[]>([]);
  const labels = useRef<(THREE.Group | null)[]>([]);
  const layoutB = useMemo(() => FACILITY_LAYOUTS.find((l) => l.id === "B"), []);
  const zones = layoutB?.zones ?? [];
  const plantB = layoutB?.departments ?? [];
  useFrame(() => {
    const f = frame.current;
    zones.forEach((zone, i) => {
      const d = f.departments.find((x) => x.facility === "B" && x.code === zone.dept);
      const glow = glows.current[i];
      if (!glow || !d) return;
      glow.visible = d.glow > 0.01;
      const [cx, cy] = centerOf(zone.box);
      const h = BUILDING_HEIGHT[zone.building];
      glow.position.set(cx, FLOOR_Z + h / 2, cy);
      const k = 1 + 0.1 * (1 - d.glow);
      glow.scale.set(zone.box.w * k, h * k + 0.4, zone.box.d * k);
      (glow.material as THREE.MeshBasicMaterial).opacity = d.glow * 0.5;
    });
    plantB.forEach(({ code, box }, i) => {
      const label = labels.current[i];
      const [cx, cy] = centerOf(box);
      if (label) label.position.set(cx, FLOOR_Z + topHeight(code, "B") + 0.6, cy);
    });
  });
  return (
    <>
      {zones.map((zone, i) => (
        <mesh
          key={`glow-${zone.area}`}
          ref={(el) => {
            glows.current[i] = el;
          }}
          visible={false}
        >
          <boxGeometry />
          <meshBasicMaterial color={theme.accent} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      {!hideLabels &&
        plantB.map(({ code }, i) => (
          <group
            key={`label-${code}`}
            ref={(el) => {
              labels.current[i] = el;
            }}
          >
            <DeptLabel code={code} />
          </group>
        ))}
    </>
  );
}

function DeptLabel({ code }: { code: string }) {
  const frame = useFrameRef();
  const [look, setLook] = useState<DeptLook>("offline");
  const [far, setFar] = useState(false);
  const [label, setLabel] = useState(code);
  useFrame(() => {
    const d = frame.current.departments.find((x) => x.facility === "B" && x.code === code);
    const isFar = frame.current.cameraDistance > LABEL_DISTANCE;
    if (isFar !== far) setFar(isFar);
    if (d && (d.look !== look || d.label !== label)) {
      setLook(d.look);
      setLabel(d.label);
    }
  });
  return (
    <Label
      zIndexRange={[8, 0]}
      rank={RANK.dept}
      className={`t3-label dept ${look}${far ? " far" : ""}`}
    >
      {label}
    </Label>
  );
}

function Slab({
  box,
  z0,
  height,
  color,
  select,
  children,
}: {
  box: Box;
  z0: number;
  height: number;
  color: string;
  /** The object a click on the slab selects. */
  select?: string;
  children?: React.ReactNode;
}) {
  const [cx, cy] = centerOf(box);
  const selectable = useSelectable(select);
  return (
    <mesh position={[cx, z0 + height / 2, cy]} castShadow receiveShadow {...selectable}>
      <boxGeometry args={[box.w, height, box.d]} />
      <meshStandardMaterial color={color} roughness={0.9} />
      {children}
    </mesh>
  );
}

function Floors({ theme, state }: { theme: Theme; state: TwinState }) {
  return (
    <>
      {FACILITY_LAYOUTS.map((layout) => {
        const facility = state.facilities.find((f) => f.id === layout.id);
        const [fx, fy] = [layout.floor.x + layout.floor.w, layout.floor.y + layout.floor.d];
        return (
          <group key={layout.id}>
            <Slab
              box={layout.floor}
              z0={0}
              height={FLOOR_Z}
              color={theme.floor}
              select={`plant-${layout.id}`}
            />
            <group position={world(fx - layout.floor.w * 0.5, fy + 1.5, 0)}>
              <Label zIndexRange={[8, 0]} rank={RANK.plant} className="t3-label plant">
                <strong>{facility?.name ?? layout.id}</strong>
                <span>
                  {layout.id === "B"
                    ? `${facility?.online ?? 0} of ${facility?.departments.length ?? 0} departments online`
                    : "online"}
                  {facility && facility.alerts.length > 0 && " · ⚠ review"}
                </span>
              </Label>
            </group>
          </group>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ pads: suppliers, escrow, HQ

function EscrowLabel() {
  const frame = useFrameRef();
  const [cents, setCents] = useState(0);
  useFrame(() => {
    if (frame.current.escrowCents !== cents) setCents(frame.current.escrowCents);
  });
  return (
    <Label zIndexRange={[8, 0]} rank={RANK.pad} className="t3-label pad">
      <strong>Escrow</strong>
      <span>{cents > 0 ? `${formatCents(cents)} held` : "nothing held"}</span>
    </Label>
  );
}

function standingColor(theme: Theme, standing: QuoteStanding | undefined): string {
  if (standing === "selected") return theme.accent;
  if (standing === "excluded") return theme.warn;
  return theme.off;
}

/** One depot label's height on screen: three lines, four with the curtain's hash; the name alone on a phone. */
function depotStackPx(curtain: boolean, narrow: boolean): number {
  return narrow ? 24 : curtain ? 64 : 52;
}

/** A supplier's depot on the pad; a click selects the supplier. */
function Depot({ select, children }: { select: string; children: React.ReactNode }) {
  const selectable = useSelectable(select);
  return (
    <mesh position={[0, 1.1, 0]} castShadow {...selectable}>
      <boxGeometry args={[2.6, 2.2, 2.6]} />
      {children}
    </mesh>
  );
}

function Pads({
  theme,
  state,
  curtain,
  narrow,
}: {
  theme: Theme;
  state: TwinState;
  curtain: boolean;
  narrow: boolean;
}) {
  const label = (kind: keyof typeof PADS) => {
    const b = PADS[kind];
    return world(b.x + b.w / 2, b.y + b.d + 1.5, 0);
  };
  const [ex, ey] = centerOf(PADS.escrow);
  const [hx, hy] = centerOf(PADS.hq);
  const escrow = useSelectable("escrow");
  const hq = useSelectable("hq");
  return (
    <>
      {(Object.keys(PADS) as (keyof typeof PADS)[]).map((kind) => (
        <Slab key={kind} box={PADS[kind]} z0={0} height={PAD_Z} color={theme.pad} select={kind} />
      ))}
      {/* The vault: where a PO's money waits for QC. */}
      <mesh position={[ex, PAD_Z + 2.6, ey]} castShadow {...escrow}>
        <boxGeometry args={[6.5, 5.2, 6.5]} />
        <meshStandardMaterial color={theme.muted} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[ex, PAD_Z + 2.6, ey]}>
        <boxGeometry args={[6.7, 0.7, 6.7]} />
        <meshStandardMaterial color={theme.money} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* Acme HQ: the budget. */}
      <mesh position={[hx, PAD_Z + 4.5, hy]} castShadow {...hq}>
        <boxGeometry args={[5.5, 9, 5.5]} />
        <meshStandardMaterial color={theme.steady} roughness={0.8} />
      </mesh>
      <group position={label("hq")}>
        <Label zIndexRange={[8, 0]} rank={RANK.pad} className="t3-label pad">
          <strong>Acme HQ</strong>
          <span>budget</span>
        </Label>
      </group>
      <group position={label("escrow")}>
        <EscrowLabel />
      </group>
      <group position={label("suppliers")}>
        <Label zIndexRange={[8, 0]} rank={RANK.pad} className="t3-label pad">
          <strong>Suppliers</strong>
        </Label>
      </group>
      {depots(state).map((d, i) => {
        const standing = d.quote?.standing;
        const refused = d.quote?.chainTx?.status === "refused";
        return (
          <group key={d.quote?.supplier ?? i} position={d.position}>
            <Depot select={d.quote ? supplierObjectId(d.quote.supplier) : "suppliers"}>
              <meshStandardMaterial color={standingColor(theme, standing)} roughness={0.85} />
            </Depot>
            {d.quote && (
              <group position={[0, 3.4, 0]}>
                <Label
                  zIndexRange={[9, 0]}
                  rank={RANK.depot}
                  className={`t3-label depot ${standing ?? ""}`}
                  stackPx={i * depotStackPx(curtain, narrow)}
                >
                  <strong>{d.quote.supplier}</strong>
                  <span>
                    {d.quote.price}
                    {d.quote.leadTime ? ` · ${d.quote.leadTime}` : ""}
                  </span>
                  <span>
                    {standing === "excluded"
                      ? `✗ ${d.quote.reason ?? "not qualified"}`
                      : standing === "selected"
                        ? "✓ selected"
                        : "runner-up"}
                  </span>
                  {curtain && d.quote.chainTx && (
                    <span className="hash">
                      {refused ? "anchor refused" : "anchored"} · {d.quote.chainTx.hash.slice(0, 6)}
                      …
                    </span>
                  )}
                </Label>
              </group>
            )}
          </group>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------------ flows

function Road({ theme, state }: { theme: Theme; state: TwinState }) {
  const points = useMemo(() => {
    const a = anchor3({ kind: "suppliers" }, state);
    return road3(a, dock3({ kind: "dept", facility: "B", dept: "receiving" }, a)).points.map(
      ([x, y, z]) => [x, y + 0.05, z] as V3,
    );
  }, [state]);
  return <Line points={points} color={theme.off} lineWidth={5} transparent opacity={0.9} />;
}

function Truck({ theme }: { theme: Theme }) {
  return (
    <group>
      <mesh position={[0, 1.6, -0.6]} castShadow>
        <boxGeometry args={[2.4, 2.4, 4.2]} />
        <meshStandardMaterial color={theme.panel} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.2, 2.4]} castShadow>
        <boxGeometry args={[2.2, 1.7, 1.6]} />
        <meshStandardMaterial color={theme.ink} roughness={0.6} />
      </mesh>
      {[-1.9, 1.3].map((z) =>
        [-1.1, 1.1].map((x) => (
          <mesh key={`${x}:${z}`} position={[x, 0.45, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.45, 0.45, 0.4, 12]} />
            <meshStandardMaterial color={theme.ink} roughness={0.9} />
          </mesh>
        )),
      )}
    </group>
  );
}

function flowLabel(flow: Flow, curtain: boolean): string {
  return curtain && flow.chainTx ? `${flow.short} · ${flow.chainTx.hash.slice(0, 6)}…` : flow.short;
}

/** One flow: a money arc with a coin, a shipment as a truck on the road, or a disputed transfer. */
function FlowView({
  flow,
  state,
  theme,
  curtain,
  narrow,
  index,
}: {
  flow: Flow;
  state: TwinState;
  theme: Theme;
  curtain: boolean;
  narrow: boolean;
  index: number;
}) {
  const frame = useFrameRef();
  const path = useMemo(() => {
    const a = anchor3(flow.from, state);
    const b = anchor3(flow.to, state);
    return flow.kind === "material" && flow.status !== "disputed"
      ? road3(a, dock3(flow.to, a))
      : arc3(a, b);
  }, [flow, state]);
  // A shipment between plants (the hub's earmarked share) drives on a road of its own; the
  // suppliers' road to the dock is drawn once by Road.
  const ownRoad =
    flow.kind === "material" && flow.status !== "disputed" && flow.from.kind === "dept";
  const roadPoints = useMemo(
    () => (ownRoad ? path.points.map(([x, y, z]) => [x, y + 0.05, z] as V3) : []),
    [ownRoad, path],
  );
  const mover = useRef<THREE.Group>(null);
  const line = useRef<Line2>(null);
  const wall = useRef<THREE.Mesh>(null);
  const [gone, setGone] = useState(false);
  const money = flow.kind === "money";
  const refused = flow.status === "refused";
  const disputed = flow.status === "disputed";
  const color = refused || disputed ? theme.warn : money ? theme.money : theme.ink;
  const selectable = useSelectable(flowObjectId(flow));

  useFrame(() => {
    const f = frame.current.flows.find((x) => x.flow.id === flow.id);
    if (!f) return;
    if (f.alpha <= 0.01 && !gone) setGone(true);
    const p = path.at(f.progress);
    const m = mover.current;
    if (m) {
      // Coins waiting in the vault stack up; the truck turns along the road.
      m.position.set(p[0], p[1] + (money && flow.status === "held" ? index * 0.7 : 0), p[2]);
      if (!money) m.rotation.y = path.heading(f.progress);
      m.visible = f.alpha > 0.01;
    }
    const l = line.current;
    if (l?.material) {
      const rest = flow.status === "held" || flow.status === "arrived" ? 0.45 : 0.9;
      l.material.opacity = rest * f.alpha;
    }
    const w = wall.current;
    if (w) {
      (w.material as THREE.MeshBasicMaterial).opacity = (0.22 + 0.55 * f.hit) * f.alpha;
      const s = 1 + 0.15 * f.hit;
      w.scale.set(s, s, 1);
    }
  });
  if (gone) return null;

  const end = path.at(1);
  const start = path.at(0);
  const facing = Math.atan2(start[0] - end[0], start[2] - end[2]);
  // The wall stands in front of the vault, on the side the coin comes from.
  const gap = 7 / (Math.hypot(start[0] - end[0], start[2] - end[2]) || 1);
  const wallAt: V3 = [end[0] + (start[0] - end[0]) * gap, 4.5, end[2] + (start[2] - end[2]) * gap];
  return (
    <group>
      {ownRoad && (
        <Line points={roadPoints} color={theme.off} lineWidth={5} transparent opacity={0.9} />
      )}
      {(money || disputed) && (
        <Line
          ref={line}
          points={path.points}
          color={color}
          lineWidth={disputed ? 2 : 2.5}
          dashed={disputed || flow.status === "moving"}
          dashSize={2}
          gapSize={1.4}
          transparent
          opacity={0.9}
        />
      )}
      {refused && (
        <mesh ref={wall} position={wallAt} rotation={[0, facing, 0]}>
          <boxGeometry args={[11, 9, 1.4]} />
          <Edges color={theme.warn} lineWidth={1.5} />
          <meshBasicMaterial
            color={theme.warn}
            transparent
            opacity={0.22}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      <group ref={mover} {...selectable}>
        {money ? (
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[1.3, 1.3, 0.5, 24]} />
            <meshStandardMaterial color={theme.money} roughness={0.35} metalness={0.5} />
          </mesh>
        ) : disputed ? (
          <mesh>
            <sphereGeometry args={[0.9, 16, 12]} />
            <meshStandardMaterial color={theme.warn} roughness={0.6} />
          </mesh>
        ) : (
          <Truck theme={theme} />
        )}
        {/* Labels stack by whole pixels, so they stay apart at every camera distance: coins
            held in the vault one above the other, and a paid coin's label above the three
            depot labels it lands among. */}
        <group position={[0, money ? (flow.status === "arrived" ? 3.4 : 2.2) : 4.2, 0]}>
          <Label
            zIndexRange={[12, 0]}
            rank={RANK.flow}
            className={`t3-label flow ${flow.kind} ${flow.status}`}
            stackPx={
              money && (flow.status === "held" || flow.status === "refused")
                ? index * 26
                : money && flow.status === "arrived"
                  ? 3 * depotStackPx(curtain, narrow)
                  : 0
            }
          >
            {flowLabel(flow, curtain)}
          </Label>
        </group>
      </group>
    </group>
  );
}

// ------------------------------------------------------------------ lots

function LotView({ frameLot, theme }: { frameLot: LotFrame; theme: Theme }) {
  const frame = useFrameRef();
  const cage = useRef<THREE.Group>(null);
  const shell = useRef<THREE.Mesh>(null);
  const pallet = useRef<THREE.Mesh>(null);
  const { lot, box } = frameLot;
  const [cx, cy] = centerOf(box);
  const decidedColor = lot.state === "rejected" ? theme.warn : theme.ok;
  useFrame(() => {
    const f = frame.current;
    const l = f.lots.find((x) => x.lot.code === lot.code);
    if (!l) return;
    // The pallet stands on the roof over the quarantine area, the cage dropped over it.
    const roof = FLOOR_Z + BUILDING_HEIGHT.warehouse * siteScale(lot.facility);
    const c = cage.current;
    if (c) {
      c.position.set(cx, roof + l.drop, cy);
      c.visible = l.cage > 0.01;
    }
    const s = shell.current;
    if (s) {
      const mat = s.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.16 * l.cage;
      mat.color.set(theme.quarantine).lerp(COLOR_B.set(decidedColor), l.decided);
    }
    const p = pallet.current;
    if (p) {
      p.position.set(cx, roof + 0.9, cy);
      (p.material as THREE.MeshStandardMaterial).color
        .set(theme.quarantine)
        .lerp(COLOR_B.set(decidedColor), l.decided);
    }
  });
  const mark = lot.state === "quarantine" ? "⚠" : lot.state === "released" ? "✓" : "✗";
  const selectable = useSelectable(lot.code);
  return (
    <group>
      <mesh ref={pallet} castShadow {...selectable}>
        <boxGeometry args={[3.2, 1.8, 3.2]} />
        <meshStandardMaterial color={theme.quarantine} roughness={0.8} />
      </mesh>
      <group ref={cage}>
        <mesh ref={shell} position={[0, 2.6, 0]}>
          <boxGeometry args={[box.w * 0.8, 5.2, box.d * 0.8]} />
          <meshBasicMaterial
            color={theme.quarantine}
            transparent
            opacity={0.16}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
          <Edges
            color={lot.state === "quarantine" ? theme.quarantine : decidedColor}
            lineWidth={1.5}
          />
        </mesh>
        <group position={[0, 6.4, 0]}>
          <Label zIndexRange={[12, 0]} rank={RANK.lot} className={`t3-label lot ${lot.state}`}>
            {mark} {lot.code}
          </Label>
        </group>
      </group>
    </group>
  );
}

// ------------------------------------------------------------------ the scene

function Scene({
  theme,
  prev,
  next,
  at,
  last,
  title,
  curtain,
  record,
  reduced,
  hideLabels,
  onStep,
  onPick,
  picked,
  layers,
  camera,
}: {
  onPick?: ((pick: AreaPick) => void) | undefined;
  picked?: AreaPick | null | undefined;
  layers: Layers;
  camera: CameraRequest | null;
  theme: Theme;
  prev: TwinState;
  next: TwinState;
  at: number;
  last: number;
  title: string;
  curtain: boolean;
  record: boolean;
  reduced: boolean;
  hideLabels: boolean;
  onStep: ((at: number) => void) | undefined;
}) {
  const frame = useRef<Frame>({
    t: 0,
    u: 1,
    departments: blendDepartments(prev, next, 1),
    flows: blendFlows(prev, next, 1),
    lots: blendLots(prev, next, 1),
    escrowCents: next.escrowHeldCents,
    parts: siteParts(blendDepartments(prev, next, 1)),
    cameraDistance: framingFor(title, undefined, isPooled(next)).distance,
  });
  const pooled = isPooled(next);
  // Flows in either state are drawn; a flow that left fades out and unmounts itself.
  const flows = useMemo(() => {
    const ids = new Set(next.flows.map((f) => f.id));
    return [...next.flows, ...prev.flows.filter((f) => !ids.has(f.id))];
  }, [prev, next]);
  const lots = useMemo(() => blendLots(prev, next, 1), [prev, next]);
  // Coins that share a place stack: those held in the vault, and a pooled PO's shares at the wall.
  const held = flows.filter((f) => f.kind === "money" && f.status === "held").map((f) => f.id);
  const refused = flows
    .filter((f) => f.kind === "money" && f.status === "refused")
    .map((f) => f.id);
  const stackIndex = (id: string) => Math.max(held.indexOf(id), refused.indexOf(id));
  const slots = useRef(new Map<string, LabelSlot>());

  return (
    <FrameContext.Provider value={frame}>
      <SlotsContext.Provider value={slots}>
        <Driver
          prev={prev}
          next={next}
          at={at}
          last={last}
          record={record}
          reduced={reduced}
          onStep={onStep}
          frame={frame}
        />
        <color attach="background" args={[theme.bg]} />
        <hemisphereLight args={[theme.panel, theme.floor, 1.1]} />
        <directionalLight
          position={[70, 110, 50]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-130}
          shadow-camera-right={130}
          shadow-camera-top={130}
          shadow-camera-bottom={-130}
          shadow-camera-near={10}
          shadow-camera-far={400}
          shadow-bias={-0.0004}
        />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[15, -0.02, 20]} receiveShadow>
          <planeGeometry args={[900, 900]} />
          <meshStandardMaterial color={theme.bg} roughness={1} />
        </mesh>
        <Floors theme={theme} state={next} />
        <Buildings theme={theme} onPick={onPick} equipment={layers.equipment} />
        <Pings prev={prev} next={next} theme={theme} />
        {picked && <PickedOutline picked={picked} theme={theme} />}
        <DepartmentExtras theme={theme} hideLabels={hideLabels || !layers.labels} />
        <Pads theme={theme} state={next} curtain={curtain} narrow={hideLabels} />
        <Road theme={theme} state={next} />
        {layers.money &&
          flows.map((flow) => (
            <FlowView
              key={flow.id}
              flow={flow}
              state={next}
              theme={theme}
              curtain={curtain}
              narrow={hideLabels}
              index={stackIndex(flow.id)}
            />
          ))}
        {layers.money && lots.map((l) => <LotView key={l.lot.code} frameLot={l} theme={theme} />)}
        <StoryCamera
          title={title}
          at={at}
          pooled={pooled}
          record={record}
          reduced={reduced}
          request={camera}
        />
        <LabelPass />
      </SlotsContext.Provider>
    </FrameContext.Provider>
  );
}

export default function Twin3D({
  run,
  at,
  curtain,
  record,
  onStep,
  options,
  onPick,
  picked,
  onSelect,
  camera,
  children,
}: Twin3DProps & { children?: React.ReactNode }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const last = run.steps.length - 1;
  const prev = useMemo(
    () => deriveTwinState(run, Math.max(0, at - 1), options),
    [run, at, options],
  );
  const next = useMemo(() => deriveTwinState(run, at, options), [run, at, options]);
  const title = run.steps[Math.min(last, Math.max(0, Math.floor(at)))]?.title ?? "";
  const notes = [...formatTwinState(next, curtain), ...formatQuotes(next, curtain)];
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 560px)").matches);
  const command = useRef<CameraCommand>({ zoom: 1, fit: false });
  const [layers, setLayers] = useState<Layers>({ equipment: true, money: true, labels: true });
  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  useEffect(() => {
    const media = matchMedia("(max-width: 560px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // The frame around the stage (switches, caption, legend) is PlantView's; the notes are the
  // canvas's accessible description.
  return (
    <div
      className={layers.labels ? "t3-stage" : "t3-stage no-labels"}
      data-record={record ? "1" : undefined}
    >
      <CommandContext.Provider value={command}>
        <SelectContext.Provider value={onSelect ?? null}>
          <Canvas
            flat
            shadows
            dpr={record ? 1 : [1, 1.5]}
            frameloop="always"
            gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
            camera={{
              fov: 32,
              near: 2,
              far: 1200,
              position: cameraPosition(framingFor(title, undefined, isPooled(next))),
            }}
            aria-label={`3D plant view. ${notes.join(" ")}`}
            onCreated={({ gl }) => {
              // For npm run web:shot:3d: the renderer's draw calls and triangles per frame.
              window.dayOneTwin = {
                info: () => ({ calls: gl.info.render.calls, triangles: gl.info.render.triangles }),
              };
            }}
          >
            <Scene
              theme={theme}
              prev={prev}
              next={next}
              at={at}
              last={last}
              title={title}
              curtain={curtain}
              record={record}
              reduced={reduced}
              hideLabels={narrow}
              onStep={onStep}
              onPick={onPick}
              picked={picked}
              layers={layers}
              camera={camera ?? null}
            />
          </Canvas>
        </SelectContext.Provider>
      </CommandContext.Provider>
      {!record && (
        <>
          <fieldset className="t3-tools">
            <legend className="sr-only">Zoom</legend>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => (command.current.zoom = 0.75)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => (command.current.zoom = 1.33)}
            >
              −
            </button>
            <button type="button" onClick={() => (command.current.fit = true)}>
              Fit
            </button>
          </fieldset>
          <fieldset className="t3-layers">
            <legend className="sr-only">Layers</legend>
            {(
              [
                ["equipment", "Equipment"],
                ["money", "Orders & money"],
                ["labels", "Labels"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={layers[k]} onClick={() => toggle(k)}>
                {label}
              </button>
            ))}
          </fieldset>
        </>
      )}
      {children}
    </div>
  );
}

declare global {
  interface Window {
    dayOneTwin?: {
      info: () => { calls: number; triangles: number };
      clock?: number;
      camera?: number[];
    };
  }
}
