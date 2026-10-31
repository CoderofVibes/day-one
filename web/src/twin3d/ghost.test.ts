import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyGhost, disposeGhost, edgeTriangles, GHOST_OPACITY, stepGhost } from "./ghost.ts";

describe("the ghost pass", () => {
  it("crossfades over its time, both ways", () => {
    expect(stepGhost(0, true, 600, 1200)).toBe(0.5);
    expect(stepGhost(0.9, true, 600, 1200)).toBe(1);
    expect(stepGhost(0.5, false, 600, 1200)).toBe(0);
  });

  it("draws a box's twelve edges and nothing across its faces", () => {
    const g = edgeTriangles(new THREE.BoxGeometry());
    expect(g.getAttribute("position").count).toBe(24);
    expect(g.getIndex()?.count).toBe(36);
  });

  it("turns a mesh to glass and back to exactly what it was", () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: "#ffffff" });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    mesh.castShadow = true;
    root.add(mesh);
    applyGhost(root, 1);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBeCloseTo(GHOST_OPACITY);
    expect(material.color.getHex()).not.toBe(0xffffff);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.children).toHaveLength(1);
    applyGhost(root, 0);
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.opacity).toBe(1);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.children[0]?.visible).toBe(false);
    disposeGhost(root);
    expect(mesh.children).toHaveLength(0);
  });
});
