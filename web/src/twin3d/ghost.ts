// The curtain's ghost pass (docs/UPGRADE_BRIEF.md §4.8 item 1): the plant's meshes crossfade
// to glass, faint and blue-gray with thin edges, so the chain layer above reads first. One
// amount from 0 (solid) to 1 (ghost) drives every material in place: no material is swapped or
// recompiled per frame, the instanced buildings keep their per-instance status colours (only
// their white base colour is tinted, so amber and green stay faintly visible), and each mesh
// turned to glass stops writing depth and draws in a fixed order, before the chain layer.

import * as THREE from "three";

/** How much of a material's opacity the ghost keeps. */
export const GHOST_OPACITY = 0.18;
/** The ghost's tint, mixed into the white base of the instanced meshes. */
const TINT = new THREE.Color("#8ea6c8");
/** The ghosts' render order; the chain layer draws after it. */
export const GHOST_ORDER = 1;
export const CHAIN_ORDER = 10;

/** The next ghost amount: towards 1 with the curtain on, towards 0 with it off, over `ms`. */
export function stepGhost(g: number, on: boolean, deltaMs: number, ms: number): number {
  const d = deltaMs / Math.max(1, ms);
  return on ? Math.min(1, g + d) : Math.max(0, g - d);
}

interface Saved {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  white: boolean;
}

const EDGE_MATERIAL = new THREE.MeshBasicMaterial({
  color: "#86a4cf",
  wireframe: true,
  transparent: true,
  depthWrite: false,
  opacity: 0,
});
const LINE_MATERIAL = new THREE.LineBasicMaterial({
  color: "#86a4cf",
  transparent: true,
  depthWrite: false,
  opacity: 0,
});

/**
 * A geometry's feature edges as triangles (a, b, b), so an instanced mesh drawn as wireframe
 * draws exactly those edges for every instance in one call.
 */
export function edgeTriangles(
  geometry: THREE.BufferGeometry,
  threshold = 35,
): THREE.BufferGeometry {
  const edges = new THREE.EdgesGeometry(geometry, threshold);
  const n = edges.getAttribute("position").count;
  const index: number[] = [];
  for (let i = 0; i + 1 < n; i += 2) index.push(i, i + 1, i + 1);
  edges.setIndex(index);
  return edges;
}

const NO_RAYCAST = () => undefined;

// What the pass keeps, outside the objects' userData: React Three Fiber replaces a mesh's
// userData whenever it re-renders one that sets it, which would lose them.
const SAVED = new WeakMap<THREE.Material, Saved>();
const SHADOW = new WeakMap<THREE.Object3D, boolean>();
const EDGES = new WeakMap<THREE.Object3D, THREE.InstancedMesh>();
const LINES = new WeakMap<THREE.Object3D, { lines: THREE.LineSegments; key: string }>();
const OVERLAYS = new WeakSet<THREE.Object3D>();

function overlay<T extends THREE.Object3D>(edge: T): T {
  edge.raycast = NO_RAYCAST;
  edge.renderOrder = GHOST_ORDER;
  OVERLAYS.add(edge);
  return edge;
}

/** An instanced mesh's edges: one more instanced call sharing its instance matrices. */
function addEdges(mesh: THREE.InstancedMesh): void {
  const im = new THREE.InstancedMesh(edgeTriangles(mesh.geometry), EDGE_MATERIAL, mesh.count);
  im.instanceMatrix = mesh.instanceMatrix;
  im.frustumCulled = false;
  EDGES.set(mesh, overlay(im));
  mesh.add(im);
}

const INVERSE = new THREE.Matrix4();
const POINT = new THREE.Vector3();

/**
 * The plain boxes' edges (slabs, pads, the vault, HQ, depots), merged into one line set under
 * `root` and rebuilt only when the set of boxes changes: one draw call for all of them.
 */
function syncLines(root: THREE.Object3D, boxes: THREE.Mesh[], on: boolean): void {
  const kept = LINES.get(root);
  let lines = kept?.lines;
  const key = boxes.map((b) => b.uuid).join(",");
  if (on && kept?.key !== key) {
    INVERSE.copy(root.matrixWorld).invert();
    const out: number[] = [];
    for (const b of boxes) {
      b.updateWorldMatrix(true, false);
      const edges = new THREE.EdgesGeometry(b.geometry, 35);
      const pos = edges.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        POINT.fromBufferAttribute(pos, i).applyMatrix4(b.matrixWorld).applyMatrix4(INVERSE);
        out.push(POINT.x, POINT.y, POINT.z);
      }
      edges.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
    if (lines) {
      lines.geometry.dispose();
      lines.geometry = g;
    } else {
      lines = overlay(new THREE.LineSegments(g, LINE_MATERIAL));
      lines.frustumCulled = false;
      root.add(lines);
    }
    LINES.set(root, { lines, key });
  }
  if (lines) lines.visible = on;
}

/**
 * Sets every mesh under `root` to ghost amount `g`. Each material's own values are kept while
 * it is ghosted and restored, then forgotten, at 0, so a colour or opacity React sets while the
 * curtain is off is the one that comes back.
 */
export function applyGhost(root: THREE.Object3D, g: number): void {
  const on = g > 0.001;
  EDGE_MATERIAL.opacity = 0.5 * g;
  LINE_MATERIAL.opacity = 0.6 * g;
  const boxes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (OVERLAYS.has(o)) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial))
        continue;
      let s = SAVED.get(m);
      if (!s && !on) continue;
      if (!s) {
        s = {
          opacity: m.opacity,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
          white: m.color.getHex() === 0xffffff,
        };
        SAVED.set(m, s);
      }
      const transparent = on || s.transparent;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = THREE.MathUtils.lerp(s.opacity, s.opacity * GHOST_OPACITY, g);
      m.depthWrite = on ? false : s.depthWrite;
      if (s.white) m.color.set(0xffffff).lerp(TINT, 0.5 * g);
      if (!on) SAVED.delete(m);
    }
    if (!SHADOW.has(mesh)) SHADOW.set(mesh, mesh.castShadow);
    mesh.castShadow = !on && SHADOW.get(mesh) === true;
    if (!on) SHADOW.delete(mesh);
    mesh.renderOrder = on ? GHOST_ORDER : 0;
    if (mesh instanceof THREE.InstancedMesh) {
      // Instanced meshes get edges when they ask for them (userData.edges).
      if (on && !EDGES.has(mesh) && mesh.userData.edges === true) addEdges(mesh);
    } else if (mesh.geometry instanceof THREE.BoxGeometry) {
      boxes.push(mesh);
    }
    const edge = EDGES.get(mesh);
    if (edge) {
      edge.visible = on;
      if (edge instanceof THREE.InstancedMesh && mesh instanceof THREE.InstancedMesh)
        edge.count = mesh.count;
    }
  });
  syncLines(root, boxes, on);
}

/** Frees the edge overlays under `root` (their shared materials stay for the next twin). */
export function disposeGhost(root: THREE.Object3D): void {
  const edges: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (OVERLAYS.has(o)) edges.push(o);
  });
  for (const e of edges) {
    (e as THREE.Mesh).geometry.dispose();
    e.removeFromParent();
  }
  root.traverse((o) => {
    EDGES.delete(o);
  });
  LINES.delete(root);
}
