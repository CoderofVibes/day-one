// The 3D curtain (docs/UPGRADE_BRIEF.md §4.8): with the curtain on, the plant crossfades to glass
// (ghost.ts) and the chain layer rises above it: the contract's nodes over the buildings they
// govern, the accounts that sign as orbs, beams between them, each recorded transaction as a
// pulse on the twin's clock, a red shield with the contract's own words where it refused, and
// pins where records were anchored (chain.ts holds all of it as data). Every part is instanced,
// so the layer costs a handful of draw calls whatever the run holds; labels are the twin's DOM
// labels, so they share its overprint pass. Turning the curtain off runs it all backwards.

import { useFrame } from "@react-three/fiber";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { RunData } from "../run.ts";
import {
  type ChainEvent,
  type ChainLayout,
  chainLayout,
  chainSnapshot,
  GHOST_MS,
  GHOST_REDUCED_MS,
  GRID_Y,
  MAX_PULSES,
} from "./chain.ts";
import { applyGhost, CHAIN_ORDER, disposeGhost, stepGhost } from "./ghost.ts";
import { ease, type V3 } from "./scene.ts";
import { Label, RANK, SelectContext, useFrameRef } from "./Twin3D.tsx";

/** The brief's colour language (§4.5): cyan the chain, red a refusal, gold money. */
const CYAN = "#38d3e8";
const RED = "#f0524f";
const GOLD = "#f5c451";
/** A simulated call: dimmer, and labelled so. */
const SIMULATED = "#7f9fa8";

const PIN_CAPACITY = 64;
const SHOWN_PINS = 5;
const Y_UP = new THREE.Vector3(0, 1, 0);
const M = new THREE.Matrix4();
const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const DIR = new THREE.Vector3();
const C = new THREE.Color();

function put(
  mesh: THREE.InstancedMesh,
  i: number,
  at: V3,
  scale: number | V3,
  quat: THREE.Quaternion | null = null,
) {
  P.set(at[0], at[1], at[2]);
  if (typeof scale === "number") S.set(scale, scale, scale);
  else S.set(scale[0], scale[1], scale[2]);
  M.compose(P, quat ?? Q.identity(), S);
  mesh.setMatrixAt(i, M);
}

/** A unit cylinder (axis y, height 1) stretched from a to b, `width` thick. */
function putBeam(mesh: THREE.InstancedMesh, i: number, a: V3, b: V3, width: number) {
  DIR.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const length = Math.max(0.001, DIR.length());
  Q.setFromUnitVectors(Y_UP, DIR.normalize());
  P.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  S.set(width, length, width);
  M.compose(P, Q, S);
  mesh.setMatrixAt(i, M);
}

function finish(mesh: THREE.InstancedMesh | null, count: number) {
  if (!mesh) return;
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** The ghost pass and the chain layer, driven by the twin's frame: mounted with the scene. */
export function ChainCurtain({
  ghost,
  run,
  at,
  curtain,
  reduced,
  labels,
}: {
  /** The plant's meshes that turn to glass. */
  ghost: React.RefObject<THREE.Group | null>;
  run: RunData;
  at: number;
  curtain: boolean;
  reduced: boolean;
  /** Node, orb and method labels; a refusal's callout shows even without them. */
  labels: boolean;
}) {
  const frame = useFrameRef();
  const amount = useRef(curtain ? 1 : 0);
  const last = useRef<number | null>(null);
  const [up, setUp] = useState(curtain);
  const layout = useMemo(() => chainLayout(run), [run]);
  useEffect(() => {
    const root = ghost.current;
    return () => {
      if (!root) return;
      applyGhost(root, 0);
      disposeGhost(root);
    };
  }, [ghost]);
  useFrame(() => {
    // The demo clock, not wall time: record mode's fixed frames give the same crossfade every take.
    const t = frame.current.t;
    const dt = last.current === null ? 0 : Math.min(100, Math.max(0, t - last.current));
    last.current = t;
    const g0 = amount.current;
    const g = stepGhost(g0, curtain, dt, reduced ? GHOST_REDUCED_MS : GHOST_MS);
    amount.current = g;
    const root = ghost.current;
    if (root && (g > 0 || g0 > 0)) applyGhost(root, ease(g));
    if (g > 0 !== up) setUp(g > 0);
  });
  return up ? (
    <ChainLayer layout={layout} at={at} amount={amount} reduced={reduced} labels={labels} />
  ) : null;
}

/** What the labels show; React hears it only when it changes, a few times a step. */
interface Shown {
  flashes: ChainEvent[];
  callouts: ChainEvent[];
  refusals: Partial<Record<string, number>>;
  badges: { place: string; position: V3; count: number }[];
}

function shownKey(s: Shown): string {
  return [
    s.flashes.map((e) => e.id).join(","),
    s.callouts.map((e) => e.id).join(","),
    JSON.stringify(s.refusals),
    s.badges.map((b) => `${b.place}:${b.count}`).join(","),
  ].join("|");
}

function ChainLayer({
  layout,
  at,
  amount,
  reduced,
  labels,
}: {
  layout: ChainLayout;
  at: number;
  amount: React.RefObject<number>;
  reduced: boolean;
  labels: boolean;
}) {
  const frame = useFrameRef();
  const select = useContext(SelectContext);
  const group = useRef<THREE.Group>(null);
  const nodes = useRef<THREE.InstancedMesh>(null);
  const halos = useRef<THREE.InstancedMesh>(null);
  const markers = useRef<THREE.InstancedMesh>(null);
  const orbs = useRef<THREE.InstancedMesh>(null);
  const pulses = useRef<THREE.InstancedMesh>(null);
  const shields = useRef<THREE.InstancedMesh>(null);
  const gold = useRef<THREE.InstancedMesh>(null);
  const pins = useRef<THREE.InstancedMesh>(null);
  const enclave = useRef<THREE.Mesh>(null);
  /** Which event each pulse, shield and pin instance is, for clicks. */
  const picks = useRef<{ pulses: string[]; shields: string[]; pins: string[] }>({
    pulses: [],
    shields: [],
    pins: [],
  });
  const [shown, setShown] = useState<Shown>({
    flashes: [],
    callouts: [],
    refusals: {},
    badges: [],
  });
  const shownRef = useRef(shownKey(shown));

  const kevin = layout.accounts.find((a) => /^kevin\./.test(a.account));
  const center = useMemo<V3>(() => {
    const xs = layout.nodes.map((n) => n.position[0]);
    const zs = layout.nodes.map((n) => n.position[2]);
    return [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      GRID_Y,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ];
  }, [layout]);

  // The beams: solid for signing, gas and pillars, dashed between the one contract's roles.
  const beams = useMemo(() => {
    const solid: number[] = [];
    const colors: number[] = [];
    const dashed: number[] = [];
    const tone = { sign: 1, gas: 0.45, pillar: 0.6, contract: 1 } as const;
    for (const b of layout.beams) {
      if (b.kind === "contract") {
        dashed.push(...b.from, ...b.to);
        continue;
      }
      solid.push(...b.from, ...b.to);
      C.set(CYAN).multiplyScalar(tone[b.kind]);
      colors.push(C.r, C.g, C.b, C.r, C.g, C.b);
    }
    const a = new THREE.BufferGeometry();
    a.setAttribute("position", new THREE.Float32BufferAttribute(solid, 3));
    a.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const d = new THREE.BufferGeometry();
    d.setAttribute("position", new THREE.Float32BufferAttribute(dashed, 3));
    // The dashes need each segment's length along it.
    new THREE.LineSegments(d).computeLineDistances();
    return { solid: a, dashed: d };
  }, [layout]);
  useEffect(
    () => () => {
      beams.solid.dispose();
      beams.dashed.dispose();
    },
    [beams],
  );

  const hex = useMemo(() => new THREE.CylinderGeometry(2.2, 2.2, 1.8, 6), []);
  const halo = useMemo(() => new THREE.CylinderGeometry(3.4, 3.4, 0.25, 6), []);
  const shield = useMemo(() => new THREE.CylinderGeometry(3.6, 3.6, 0.3, 6), []);
  const marker = useMemo(() => new THREE.CylinderGeometry(0.7, 0.7, 0.5, 6), []);
  const pin = useMemo(() => {
    const g = new THREE.ConeGeometry(0.45, 1.6, 8);
    g.rotateX(Math.PI);
    g.translate(0, 0.8, 0);
    return g;
  }, []);
  useEffect(
    () => () => {
      for (const g of [hex, halo, shield, marker, pin]) g.dispose();
    },
    [hex, halo, shield, marker, pin],
  );

  useFrame(() => {
    const g = ease(amount.current ?? 0);
    const root = group.current;
    if (!root) return;
    // The layer rises into place as it fades in, and sinks as it fades out.
    root.position.y = (1 - g) * -8;
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || Array.isArray(m)) return;
      const base = (m.userData.base as number | undefined) ?? m.opacity;
      m.userData.base = base;
      m.opacity = base * g;
    });

    const snap = chainSnapshot(layout, at, frame.current.since);
    const n = nodes.current;
    const h = halos.current;
    if (n && h) {
      layout.nodes.forEach((node, i) => {
        const burst = snap.bursts.find((b) => b.role === node.role);
        const k =
          (node.role === "token" ? 0.65 : 1) *
          (1 + (burst ? 0.4 * Math.sin(Math.PI * burst.u) : 0));
        put(n, i, node.position, k);
        put(
          h,
          i,
          [node.position[0], node.position[1] - 1.1, node.position[2]],
          k * (burst ? 1 + burst.u : 1),
        );
      });
      finish(n, layout.nodes.length);
      finish(h, layout.nodes.length);
    }
    const mk = markers.current;
    if (mk) {
      let i = 0;
      for (const node of layout.nodes) {
        if (!snap.refusals[node.role]) continue;
        put(mk, i++, [node.position[0] + 2.6, node.position[1] + 1.6, node.position[2] + 2.6], 1);
      }
      finish(mk, i);
    }
    const o = orbs.current;
    if (o) {
      layout.accounts.forEach((a, i) => {
        put(o, i, a.position, 1);
      });
      finish(o, layout.accounts.length);
    }
    const p = pulses.current;
    if (p) {
      const live = reduced ? [] : snap.pulses.slice(0, MAX_PULSES);
      picks.current.pulses = live.map((x) => x.event.id);
      live.forEach((x, i) => {
        put(p, i, x.position, x.money ? 1.1 : 0.9);
        p.setColorAt(i, C.set(x.money ? GOLD : x.event.recorded ? CYAN : SIMULATED));
      });
      finish(p, live.length);
    }
    const sh = shields.current;
    if (sh) {
      picks.current.shields = snap.shields.map((x) => x.event.id);
      snap.shields.forEach((x, i) => {
        const e = x.event;
        const s = e.shield as V3;
        const from = e.path[e.path.length - 2] as V3;
        DIR.set(s[0] - from[0], s[1] - from[1], s[2] - from[2]).normalize();
        Q.setFromUnitVectors(Y_UP, DIR);
        put(sh, i, s, Math.max(0.001, x.scale), Q);
      });
      finish(sh, snap.shields.length);
    }
    const gl = gold.current;
    if (gl) {
      snap.money.forEach((x, i) => {
        const to: V3 = [
          x.from[0] + (x.to[0] - x.from[0]) * x.u,
          x.from[1] + (x.to[1] - x.from[1]) * x.u,
          x.from[2] + (x.to[2] - x.from[2]) * x.u,
        ];
        putBeam(gl, i, x.from, to, 0.45);
      });
      finish(gl, snap.money.length);
    }
    const pn = pins.current;
    if (pn) {
      const ids: string[] = [];
      for (const c of snap.pins) {
        const shownPins = c.pins.slice(0, SHOWN_PINS);
        shownPins.forEach((x, k) => {
          if (ids.length >= PIN_CAPACITY) return;
          const a = (k / Math.max(1, shownPins.length)) * Math.PI * 2;
          const r = shownPins.length > 1 ? 1.3 : 0;
          put(
            pn,
            ids.length,
            [c.position[0] + r * Math.cos(a), c.position[1], c.position[2] + r * Math.sin(a)],
            1,
          );
          ids.push(x.event.id);
        });
      }
      for (const f of reduced ? [] : snap.falling) {
        if (ids.length >= PIN_CAPACITY) break;
        put(pn, ids.length, f.position, 1);
        ids.push(f.event.id);
      }
      picks.current.pins = ids;
      finish(pn, ids.length);
    }
    const en = enclave.current;
    if (en) {
      const m = en.material as THREE.MeshBasicMaterial;
      m.color.set(CYAN).lerp(C.set("#ffffff"), snap.enclave * 0.7);
      en.scale.setScalar(1 + 0.25 * snap.enclave);
    }

    const next: Shown = {
      flashes: snap.flashes.map((f) => f.event),
      callouts: snap.shields.filter((s) => s.callout).map((s) => s.event),
      refusals: snap.refusals,
      badges: snap.pins
        .filter((c) => c.pins.length > SHOWN_PINS)
        .map((c) => ({ place: c.place, position: c.position, count: c.pins.length })),
    };
    const key = shownKey(next);
    if (key !== shownRef.current) {
      shownRef.current = key;
      setShown(next);
    }
  });

  const pick = (list: () => string[]) =>
    select
      ? {
          onClick: (e: { stopPropagation: () => void; instanceId?: number | undefined }) => {
            e.stopPropagation();
            const id = e.instanceId !== undefined ? list()[e.instanceId] : undefined;
            if (id) select(id);
          },
          onPointerOver: (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            document.body.style.cursor = "pointer";
          },
          onPointerOut: () => {
            document.body.style.cursor = "";
          },
        }
      : {};
  const nodeIds = layout.nodes.map((x) => x.id);
  const orbIds = layout.accounts.map((x) => x.id);
  const order = CHAIN_ORDER;
  // Each flash stacks above the ones already at its node.
  const flashStack = (e: ChainEvent) =>
    shown.flashes.filter((f) => f.role === e.role).indexOf(e) * 20;

  return (
    <group ref={group}>
      <gridHelper
        args={[240, 24, CYAN, CYAN]}
        position={center}
        renderOrder={order}
        material-transparent
        material-opacity={0.14}
        material-depthWrite={false}
      />
      <lineSegments geometry={beams.solid} renderOrder={order}>
        <lineBasicMaterial vertexColors transparent opacity={0.7} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={beams.dashed} renderOrder={order}>
        <lineDashedMaterial
          color={CYAN}
          dashSize={1.6}
          gapSize={1.2}
          transparent
          opacity={0.75}
          depthWrite={false}
        />
      </lineSegments>
      <instancedMesh
        ref={nodes}
        args={[hex, undefined, 8]}
        frustumCulled={false}
        renderOrder={order + 1}
        {...pick(() => nodeIds)}
      >
        <meshBasicMaterial color={CYAN} transparent opacity={0.92} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={halos}
        args={[halo, undefined, 8]}
        frustumCulled={false}
        renderOrder={order}
        raycast={() => undefined}
      >
        <meshBasicMaterial
          color={CYAN}
          transparent
          opacity={0.28}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
      <instancedMesh
        ref={markers}
        args={[marker, undefined, 8]}
        frustumCulled={false}
        renderOrder={order + 1}
      >
        <meshBasicMaterial color={RED} transparent opacity={1} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={orbs}
        args={[undefined, undefined, 32]}
        frustumCulled={false}
        renderOrder={order + 1}
        {...pick(() => orbIds)}
      >
        <sphereGeometry args={[0.9, 16, 12]} />
        <meshBasicMaterial color="#bff4fb" transparent opacity={0.95} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={pulses}
        args={[undefined, undefined, MAX_PULSES]}
        frustumCulled={false}
        renderOrder={order + 2}
        {...pick(() => picks.current.pulses)}
      >
        <sphereGeometry args={[0.7, 12, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={1} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={shields}
        args={[shield, undefined, 8]}
        frustumCulled={false}
        renderOrder={order + 2}
        {...pick(() => picks.current.shields)}
      >
        <meshBasicMaterial
          color={RED}
          transparent
          opacity={0.6}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={gold}
        args={[undefined, undefined, 8]}
        frustumCulled={false}
        renderOrder={order + 1}
        raycast={() => undefined}
      >
        <cylinderGeometry args={[0.5, 0.5, 1, 8]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0.9} depthWrite={false} />
      </instancedMesh>
      <instancedMesh
        ref={pins}
        args={[pin, undefined, PIN_CAPACITY]}
        frustumCulled={false}
        renderOrder={order + 1}
        {...pick(() => picks.current.pins)}
      >
        <meshBasicMaterial color={CYAN} transparent opacity={1} depthWrite={false} />
      </instancedMesh>
      {kevin && (
        <mesh
          ref={enclave}
          position={[kevin.position[0] + 2.4, kevin.position[1], kevin.position[2]]}
          renderOrder={order + 1}
        >
          <boxGeometry args={[1.1, 1.1, 1.1]} />
          <meshBasicMaterial color={CYAN} transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}

      {labels &&
        layout.nodes.map((node) => {
          const refused = shown.refusals[node.role] ?? 0;
          return (
            <group
              key={node.id}
              position={[node.position[0], node.position[1] + 3.6, node.position[2]]}
            >
              <Label zIndexRange={[12, 0]} rank={RANK.node} className="t3-label chain node">
                <strong>{node.label}</strong>
                <span>
                  {node.contract.split(".")[0]}
                  {refused > 0 && <b className="refusals"> · ✗ {refused} refused</b>}
                </span>
              </Label>
            </group>
          );
        })}
      {labels &&
        layout.accounts.map((a) => (
          <group key={a.id} position={[a.position[0], a.position[1] - 2, a.position[2]]}>
            <Label zIndexRange={[11, 0]} rank={RANK.orb} className="t3-label chain orb">
              {a.short}
            </Label>
          </group>
        ))}
      {labels &&
        shown.flashes.map((e) => {
          const node = layout.nodes.find((x) => x.role === e.role);
          if (!node) return null;
          return (
            <group
              key={`flash-${e.id}`}
              position={[node.position[0] - 5, node.position[1] + 1, node.position[2] + 5]}
            >
              <Label
                zIndexRange={[13, 0]}
                rank={RANK.method}
                className={`t3-label chain method${e.refused ? " refused" : ""}${e.recorded ? "" : " simulated"}`}
                stackPx={flashStack(e)}
              >
                <code>{e.tx.method}</code>
                {!e.recorded && <span>Simulated</span>}
              </Label>
            </group>
          );
        })}
      {shown.callouts.map((e) => {
        const s = e.shield as V3;
        return (
          <group key={`callout-${e.id}`} position={[s[0], s[1] + 5, s[2]]}>
            <Label zIndexRange={[14, 0]} rank={RANK.callout} className="t3-label chain callout">
              <strong>Refused · {e.tx.method}</strong>
              <span>“{e.tx.error ?? "refused by the contract"}”</span>
            </Label>
          </group>
        );
      })}
      {shown.badges.map((b) => (
        <group
          key={`badge-${b.place}`}
          position={[b.position[0], b.position[1] + 3, b.position[2]]}
        >
          <Label zIndexRange={[12, 0]} rank={RANK.orb} className="t3-label chain badge">
            {b.count} anchored
          </Label>
        </group>
      ))}
    </group>
  );
}
