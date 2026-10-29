// The 3D twin: the same TwinState and layout.ts as the flat map, drawn with three.js through
// React Three Fiber (docs/TWIN3D.md, research 16). Every frame is a function of the previous
// step's state, the current step's state and a demo clock: wall time scaled in normal use, a
// fixed 1000/60 ms per frame in record mode (?record=1), where the run also advances itself
// one step every STEP_MS. Procedural geometry only; labels are DOM, so no font file. Staff see
// dollars, POs, plants and names; hashes and accounts appear only behind the curtain.

import { Edges, Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Line2, OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RunData } from "../run.ts";
import { type Box, FACILITY_LAYOUTS, FLOOR_Z, PAD_Z, PADS } from "../twin/layout.ts";
import {
  deriveTwinState,
  type Flow,
  formatCents,
  formatQuotes,
  formatTwinState,
  type QuoteStanding,
  type TwinState,
} from "../twin/model.ts";
import {
  bodyHeight,
  buildingParts,
  type Part,
  type PartKind,
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
  CAMERA_MS,
  cameraPosition,
  centerOf,
  clamp01,
  type DeptFrame,
  type DeptLook,
  depots,
  dock3,
  type FlowFrame,
  type Framing,
  framingFor,
  LABEL_DISTANCE,
  type LotFrame,
  lerp,
  lerpFraming,
  RECORD_FRAME_MS,
  road3,
  STEP_MS,
  type V3,
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

const FALLBACK: Theme = {
  bg: "#f6f5f1",
  panel: "#ffffff",
  ink: "#1d1f22",
  muted: "#646a73",
  floor: "#e9e7e0",
  off: "#cfccc3",
  warm: "#9ed1c2",
  steady: "#8dbfae",
  pad: "#d8d5cc",
  accent: "#1f6f5c",
  money: "#b8860b",
  quarantine: "#d58a00",
  warn: "#b3261e",
  ok: "#1f6f5c",
};

const VARS: Record<keyof Theme, string> = {
  bg: "--bg",
  panel: "--panel",
  ink: "--ink",
  muted: "--muted",
  floor: "--map-floor",
  off: "--map-off",
  warm: "--map-warm",
  steady: "--map-steady",
  pad: "--map-pad",
  accent: "--accent",
  money: "--money",
  quarantine: "--quarantine",
  warn: "--warn",
  ok: "--ok",
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
  /** The buildings, one part list per frame (buildings.ts). */
  parts: { part: Part; dept: DeptFrame }[];
  /** How far the camera is from what it looks at; department labels hide when far. */
  cameraDistance: number;
}

const FrameContext = createContext<React.RefObject<Frame> | null>(null);

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
      parts: departments.flatMap((d) => buildingParts(d).map((part) => ({ part, dept: d }))),
      cameraDistance: frame.current.cameraDistance,
    };
  }, -1);
  return null;
}

// ------------------------------------------------------------------ camera

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

function StoryCamera({
  title,
  at,
  record,
  reduced,
}: {
  title: string;
  at: number;
  record: boolean;
  reduced: boolean;
}) {
  const frame = useFrameRef();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useRef<OrbitControlsImpl>(null);
  const free = useRef(false);
  const from = useRef<Framing>(framingFor(title, size));
  const to = useRef<Framing>(framingFor(title, size));
  const since = useRef(0);
  const seen = useRef(-1);
  const sized = useRef(`${size.width}x${size.height}`);

  useFrame(() => {
    const f = frame.current;
    const c = controls.current;
    if (!c) return;
    const sizeNow = `${size.width}x${size.height}`;
    if (seen.current !== at) {
      // A new step: the story takes the camera back from wherever the user left it.
      seen.current = at;
      sized.current = sizeNow;
      from.current = framingOf(camera, c.target);
      to.current = framingFor(title, size);
      since.current = f.t;
      free.current = false;
    } else if (sized.current !== sizeNow && !free.current) {
      // The stage changed size (a rotated phone, a resized window): refit the same shot.
      sized.current = sizeNow;
      from.current = framingOf(camera, c.target);
      to.current = framingFor(title, size);
      since.current = f.t;
    }
    if (window.dayOneTwin) window.dayOneTwin.camera = camera.position.toArray();
    if (free.current && !record) {
      f.cameraDistance = camera.position.distanceTo(c.target);
      return;
    }
    const u = reduced ? 1 : clamp01((f.t - since.current) / CAMERA_MS);
    const now = lerpFraming(from.current, to.current, u);
    camera.position.set(...cameraPosition(now));
    c.target.set(...now.target);
    c.update();
    f.cameraDistance = camera.position.distanceTo(c.target);
  });

  return (
    <OrbitControls
      ref={controls}
      enableDamping={false}
      enablePan={!record}
      enableZoom={!record}
      enableRotate={!record}
      minDistance={25}
      maxDistance={480}
      maxPolarAngle={Math.PI / 2 - 0.08}
      onStart={() => {
        free.current = true;
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
 * labels on coins stacked in the vault stay apart at every camera distance.
 */
function Label({
  className,
  zIndexRange,
  stackPx = 0,
  hidden,
  children,
}: {
  className: string;
  zIndexRange: [number, number];
  stackPx?: number;
  /** Set by a parent each frame to hide the label for a reason of its own (an overprint). */
  hidden?: React.RefObject<boolean>;
  children: React.ReactNode;
}) {
  const anchor = useRef<THREE.Group>(null);
  const div = useRef<HTMLDivElement>(null);
  const box = useRef<[number, number]>([0, 0]);
  const observer = useRef<ResizeObserver | null>(null);
  const shown = useRef(true);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => () => observer.current?.disconnect(), []);
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
    const show = inFrame && !hidden?.current;
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

/** How many of each part the instanced meshes can hold; the site needs well under these. */
const PART_CAPACITY: Record<PartKind, number> = {
  body: 24,
  gable: 12,
  saw: 32,
  silo: 8,
  tank: 4,
  stack: 12,
  window: 900,
  door: 48,
  vent: 16,
  unit: 24,
  dock: 4,
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

function tintColor(theme: Theme, tint: Tint, d: DeptFrame, t: number): THREE.Color {
  switch (tint) {
    case "body":
      return COLORS.set(lookColor(theme, d.from)).lerp(
        COLOR_B.set(lookColor(theme, d.look)),
        d.mix,
      );
    case "roof":
      return tintColor(theme, "body", d, t).multiplyScalar(0.78);
    case "metal":
      return COLORS.set(theme.off).lerp(COLOR_B.set(theme.panel), 0.5);
    case "dark":
      return COLORS.set(theme.ink).lerp(COLOR_B.set(theme.off), 0.35);
    case "pad":
      return COLORS.set(theme.pad);
    default: {
      const on = lerp(litness(d.from, t), litness(d.look, t), d.mix);
      return COLORS.set(theme.off).multiplyScalar(0.5).lerp(COLOR_B.set(LIT), on);
    }
  }
}

/** Every building on the site: one instanced mesh per part kind (buildings.ts). */
function Buildings({ theme }: { theme: Theme }) {
  const frame = useFrameRef();
  const meshes = useRef<Partial<Record<PartKind, THREE.InstancedMesh | null>>>({});
  const gable = useMemo(() => prism(false), []);
  const saw = useMemo(() => prism(true), []);
  useFrame(() => {
    const f = frame.current;
    const counts: Partial<Record<PartKind, number>> = {};
    for (const { part, dept } of f.parts) {
      const m = meshes.current[part.kind];
      if (!m) continue;
      const i = counts[part.kind] ?? 0;
      if (i >= PART_CAPACITY[part.kind]) continue;
      counts[part.kind] = i + 1;
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
    for (const kind of Object.keys(PART_CAPACITY) as PartKind[]) {
      const m = meshes.current[kind];
      if (!m) continue;
      m.count = counts[kind] ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });
  const ref = (kind: PartKind) => (el: THREE.InstancedMesh | null) => {
    meshes.current[kind] = el;
  };
  const boxes: PartKind[] = ["body", "door", "vent", "unit", "dock"];
  const rounds: PartKind[] = ["silo", "tank", "stack"];
  return (
    <>
      {boxes.map((kind) => (
        <instancedMesh
          key={kind}
          ref={ref(kind)}
          args={[undefined, undefined, PART_CAPACITY[kind]]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <boxGeometry />
          <meshStandardMaterial color="#ffffff" roughness={0.85} metalness={0} />
        </instancedMesh>
      ))}
      {rounds.map((kind) => (
        <instancedMesh
          key={kind}
          ref={ref(kind)}
          args={[undefined, undefined, PART_CAPACITY[kind]]}
          castShadow
          frustumCulled={false}
        >
          <cylinderGeometry args={[0.5, 0.5, 1, 18]} />
          <meshStandardMaterial color="#ffffff" roughness={0.5} metalness={0.25} />
        </instancedMesh>
      ))}
      <instancedMesh
        ref={ref("gable")}
        args={[gable, undefined, PART_CAPACITY.gable]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={ref("saw")}
        args={[saw, undefined, PART_CAPACITY.saw]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={ref("window")}
        args={[undefined, undefined, PART_CAPACITY.window]}
        frustumCulled={false}
      >
        <boxGeometry />
        <meshBasicMaterial color="#ffffff" />
      </instancedMesh>
    </>
  );
}

/** The glow around a department the moment it comes online, and its label. */
const NEVER_HIDDEN: React.RefObject<boolean> = { current: false };

/** About the size of a department pill on screen, from its text (11 px font, 6 px padding). */
function pillSize(label: string): [number, number] {
  return [label.length * 6.2 + 12, 17];
}

function DepartmentExtras({ theme, hideLabels }: { theme: Theme; hideLabels: boolean }) {
  const frame = useFrameRef();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const glows = useRef<(THREE.Mesh | null)[]>([]);
  const labels = useRef<(THREE.Group | null)[]>([]);
  const plantB = useMemo(() => FACILITY_LAYOUTS.find((l) => l.id === "B")?.departments ?? [], []);
  const hidden = useRef(plantB.map(() => ({ current: false })));
  const pills = useRef<{ i: number; x: number; y: number; z: number; w: number; h: number }[]>([]);
  useFrame(() => {
    const f = frame.current;
    // Where each pill lands on screen; a pill behind a nearer one it would overprint hides.
    pills.current.length = 0;
    plantB.forEach(({ code }, i) => {
      const g = labels.current[i];
      const d = f.departments.find((x) => x.facility === "B" && x.code === code);
      if (!g || !d) return;
      g.getWorldPosition(SCREEN).project(camera);
      const [w, h] = pillSize(d.label);
      pills.current.push({
        i,
        x: ((SCREEN.x + 1) / 2) * size.width,
        y: ((1 - SCREEN.y) / 2) * size.height,
        z: SCREEN.z,
        w,
        h,
      });
    });
    pills.current.sort((a, b) => a.z - b.z);
    const kept: typeof pills.current = [];
    for (const p of pills.current) {
      const overprints = kept.some(
        (k) =>
          Math.abs(k.x - p.x) < (k.w + p.w) / 2 - 4 && Math.abs(k.y - p.y) < (k.h + p.h) / 2 - 4,
      );
      const flag = hidden.current[p.i];
      if (flag) flag.current = overprints;
      if (!overprints) kept.push(p);
    }
    plantB.forEach(({ code, box }, i) => {
      const d = f.departments.find((x) => x.facility === "B" && x.code === code);
      const [cx, cy] = centerOf(box);
      const glow = glows.current[i];
      if (glow && d) {
        glow.visible = d.glow > 0.01;
        const h = bodyHeight(d.code, d.height);
        glow.position.set(cx, FLOOR_Z + h / 2, cy);
        const s = 1 + 0.12 * (1 - d.glow);
        glow.scale.set(box.w * 0.88 * s, h * s, box.d * 0.88 * s);
        (glow.material as THREE.MeshBasicMaterial).opacity = d.glow * 0.55;
      }
      const label = labels.current[i];
      if (label && d) label.position.set(cx, FLOOR_Z + topHeight(d.code, d.height) + 0.6, cy);
    });
  });
  return (
    <>
      {plantB.map(({ code }, i) => (
        <mesh
          key={`glow-${code}`}
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
            <DeptLabel code={code} hidden={hidden.current[i] ?? NEVER_HIDDEN} />
          </group>
        ))}
    </>
  );
}

function DeptLabel({ code, hidden }: { code: string; hidden: React.RefObject<boolean> }) {
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
      className={`t3-label dept ${look}${far ? " far" : ""}`}
      hidden={hidden}
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
  children,
}: {
  box: Box;
  z0: number;
  height: number;
  color: string;
  children?: React.ReactNode;
}) {
  const [cx, cy] = centerOf(box);
  return (
    <mesh position={[cx, z0 + height / 2, cy]} castShadow receiveShadow>
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
            <Slab box={layout.floor} z0={0} height={FLOOR_Z} color={theme.floor} />
            <group position={world(fx - layout.floor.w * 0.5, fy + 1.5, 0)}>
              <Label zIndexRange={[8, 0]} className="t3-label plant">
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
    <Label zIndexRange={[8, 0]} className="t3-label pad">
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
  return (
    <>
      {(Object.keys(PADS) as (keyof typeof PADS)[]).map((kind) => (
        <Slab key={kind} box={PADS[kind]} z0={0} height={PAD_Z} color={theme.pad} />
      ))}
      {/* The vault: where a PO's money waits for QC. */}
      <mesh position={[ex, PAD_Z + 2.6, ey]} castShadow>
        <boxGeometry args={[6.5, 5.2, 6.5]} />
        <meshStandardMaterial color={theme.muted} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[ex, PAD_Z + 2.6, ey]}>
        <boxGeometry args={[6.7, 0.7, 6.7]} />
        <meshStandardMaterial color={theme.money} roughness={0.4} metalness={0.4} />
      </mesh>
      {/* Acme HQ: the budget. */}
      <mesh position={[hx, PAD_Z + 4.5, hy]} castShadow>
        <boxGeometry args={[5.5, 9, 5.5]} />
        <meshStandardMaterial color={theme.steady} roughness={0.8} />
      </mesh>
      <group position={label("hq")}>
        <Label zIndexRange={[8, 0]} className="t3-label pad">
          <strong>Acme HQ</strong>
          <span>budget</span>
        </Label>
      </group>
      <group position={label("escrow")}>
        <EscrowLabel />
      </group>
      <group position={label("suppliers")}>
        <Label zIndexRange={[8, 0]} className="t3-label pad">
          <strong>Suppliers</strong>
        </Label>
      </group>
      {depots(state).map((d, i) => {
        const standing = d.quote?.standing;
        const refused = d.quote?.chainTx?.status === "refused";
        return (
          <group key={d.quote?.supplier ?? i} position={d.position}>
            <mesh position={[0, 1.1, 0]} castShadow>
              <boxGeometry args={[2.6, 2.2, 2.6]} />
              <meshStandardMaterial color={standingColor(theme, standing)} roughness={0.85} />
            </mesh>
            {d.quote && (
              <group position={[0, 3.4, 0]}>
                <Label
                  zIndexRange={[9, 0]}
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
  const mover = useRef<THREE.Group>(null);
  const line = useRef<Line2>(null);
  const wall = useRef<THREE.Mesh>(null);
  const [gone, setGone] = useState(false);
  const money = flow.kind === "money";
  const refused = flow.status === "refused";
  const disputed = flow.status === "disputed";
  const color = refused || disputed ? theme.warn : money ? theme.money : theme.ink;

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
      <group ref={mover}>
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
            className={`t3-label flow ${flow.kind} ${flow.status}`}
            stackPx={
              money && flow.status === "held"
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
    const d = f.departments.find((x) => x.facility === lot.facility && x.code === lot.department);
    if (!l || !d) return;
    const roof = FLOOR_Z + bodyHeight(d.code, d.height);
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
  return (
    <group>
      <mesh ref={pallet} castShadow>
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
          <Label zIndexRange={[12, 0]} className={`t3-label lot ${lot.state}`}>
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
}: {
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
    parts: blendDepartments(prev, next, 1).flatMap((d) =>
      buildingParts(d).map((part) => ({ part, dept: d })),
    ),
    cameraDistance: framingFor(title).distance,
  });
  // Flows in either state are drawn; a flow that left fades out and unmounts itself.
  const flows = useMemo(() => {
    const ids = new Set(next.flows.map((f) => f.id));
    return [...next.flows, ...prev.flows.filter((f) => !ids.has(f.id))];
  }, [prev, next]);
  const lots = useMemo(() => blendLots(prev, next, 1), [prev, next]);
  const held = flows.filter((f) => f.kind === "money" && f.status === "held").map((f) => f.id);

  return (
    <FrameContext.Provider value={frame}>
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
      <Buildings theme={theme} />
      <DepartmentExtras theme={theme} hideLabels={hideLabels} />
      <Pads theme={theme} state={next} curtain={curtain} narrow={hideLabels} />
      <Road theme={theme} state={next} />
      {flows.map((flow) => (
        <FlowView
          key={flow.id}
          flow={flow}
          state={next}
          theme={theme}
          curtain={curtain}
          narrow={hideLabels}
          index={held.indexOf(flow.id)}
        />
      ))}
      {lots.map((l) => (
        <LotView key={l.lot.code} frameLot={l} theme={theme} />
      ))}
      <StoryCamera title={title} at={at} record={record} reduced={reduced} />
    </FrameContext.Provider>
  );
}

export default function Twin3D({ run, at, curtain, record, onStep }: Twin3DProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const last = run.steps.length - 1;
  const prev = useMemo(() => deriveTwinState(run, Math.max(0, at - 1)), [run, at]);
  const next = useMemo(() => deriveTwinState(run, at), [run, at]);
  const title = run.steps[Math.min(last, Math.max(0, Math.floor(at)))]?.title ?? "";
  const notes = [...formatTwinState(next, curtain), ...formatQuotes(next, curtain)];
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 560px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width: 560px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <>
      <div className="t3-stage" data-record={record ? "1" : undefined}>
        <Canvas
          flat
          shadows
          dpr={record ? 1 : [1, 1.5]}
          frameloop="always"
          gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
          camera={{ fov: 32, near: 2, far: 1200, position: cameraPosition(framingFor(title)) }}
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
          />
        </Canvas>
      </div>
      <ul className="map-notes">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
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
