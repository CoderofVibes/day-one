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

function addEdges(mesh: THREE.Mesh): void {
  let edge: THREE.Object3D;
  if (mesh instanceof THREE.InstancedMesh) {
    const im = new THREE.InstancedMesh(edgeTriangles(mesh.geometry), EDGE_MATERIAL, mesh.count);
    im.instanceMatrix = mesh.instanceMatrix;
    im.frustumCulled = false;
    edge = im;
  } else {
    edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 35), LINE_MATERIAL);
  }
  edge.raycast = NO_RAYCAST;
  edge.renderOrder = GHOST_ORDER;
  edge.userData.ghostEdge = true;
  mesh.userData.ghostEdges = edge;
  mesh.add(edge);
}

/** Instanced meshes get edges when they ask (userData.edges); plain boxes always. */
function wantsEdges(mesh: THREE.Mesh): boolean {
  if (mesh instanceof THREE.InstancedMesh) return mesh.userData.edges === true;
  return mesh.geometry instanceof THREE.BoxGeometry;
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
  root.traverse((o) => {
    if (o.userData.ghostEdge) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial))
        continue;
      let s = m.userData.ghost as Saved | undefined;
      if (!s && !on) continue;
      if (!s) {
        s = {
          opacity: m.opacity,
          transparent: m.transparent,
          depthWrite: m.depthWrite,
          white: m.color.getHex() === 0xffffff,
        };
        m.userData.ghost = s;
      }
      const transparent = on || s.transparent;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = THREE.MathUtils.lerp(s.opacity, s.opacity * GHOST_OPACITY, g);
      m.depthWrite = on ? false : s.depthWrite;
      if (s.white) m.color.set(0xffffff).lerp(TINT, 0.5 * g);
      if (!on) delete m.userData.ghost;
    }
    if (mesh.userData.castShadow === undefined) mesh.userData.castShadow = mesh.castShadow;
    mesh.castShadow = !on && mesh.userData.castShadow === true;
    mesh.renderOrder = on ? GHOST_ORDER : 0;
    if (on && !mesh.userData.ghostEdges && wantsEdges(mesh)) addEdges(mesh);
    const edge = mesh.userData.ghostEdges as THREE.Object3D | undefined;
    if (edge) {
      edge.visible = on;
      if (edge instanceof THREE.InstancedMesh && mesh instanceof THREE.InstancedMesh)
        edge.count = mesh.count;
    }
  });
}

/** Frees the edge overlays under `root` (their shared materials stay for the next twin). */
export function disposeGhost(root: THREE.Object3D): void {
  const edges: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.ghostEdge) edges.push(o);
  });
  for (const e of edges) {
    (e as THREE.Mesh).geometry.dispose();
    e.removeFromParent();
  }
  root.traverse((o) => {
    delete o.userData.ghostEdges;
  });
}
