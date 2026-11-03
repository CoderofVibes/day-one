// The lot book's Merkle tree. Hashing is on text, so the browser's verifier (web/src/lotProof.ts,
// Web Crypto) and this file agree byte for byte: a leaf is sha256("L" + canonical JSON of the
// leaf), an inner node is sha256("N" + left hex + right hex). The prefixes keep a leaf from ever
// being read as a node. An odd node at the end of a level moves up unchanged (it is not paired
// with itself, so no two different leaf lists give the same root).

import { canonicalJson, sha256Hex } from "../canonical.ts";

export const leafHash = (leaf: unknown): string => sha256Hex(`L${canonicalJson(leaf)}`);
export const nodeHash = (left: string, right: string): string => sha256Hex(`N${left}${right}`);

/** One step of a proof: the sibling's hash and which side it sits on. */
export interface ProofStep {
  sibling: string;
  side: "left" | "right";
}

/** The level above: pairs hashed, an odd last node carried up. */
function up(level: string[]): string[] {
  const next: string[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i] as string;
    const right = level[i + 1];
    next.push(right === undefined ? left : nodeHash(left, right));
  }
  return next;
}

/** Every level of the tree, leaves first, root last (a one-element level). */
export function levels(leaves: string[]): string[][] {
  if (leaves.length === 0) throw new RangeError("a Merkle tree needs at least one leaf");
  const out = [leaves];
  let level = leaves;
  while (level.length > 1) {
    level = up(level);
    out.push(level);
  }
  return out;
}

export const merkleRoot = (leaves: string[]): string => levels(leaves).at(-1)?.[0] ?? "";

/** The path from leaf `index` to the root. */
export function proofFor(leaves: string[], index: number): ProofStep[] {
  if (index < 0 || index >= leaves.length) throw new RangeError(`no leaf ${index}`);
  const steps: ProofStep[] = [];
  let i = index;
  for (const level of levels(leaves).slice(0, -1)) {
    const sibling = level[i % 2 === 0 ? i + 1 : i - 1];
    if (sibling !== undefined) steps.push({ sibling, side: i % 2 === 0 ? "right" : "left" });
    i = Math.floor(i / 2);
  }
  return steps;
}

/** The root a leaf hash and its path lead to. */
export function rootFrom(leaf: string, proof: ProofStep[]): string {
  return proof.reduce(
    (h, s) => (s.side === "right" ? nodeHash(h, s.sibling) : nodeHash(s.sibling, h)),
    leaf,
  );
}
