// The lot book: every plant's lot records, one Merkle root per plant per day, anchored on chain
// (docs/REFERENCE_IDEAS_PLAN.md, C). A day's leaves are the records of what happened that day:
// a lot received (with its PO, supplier lot and quantity), a QC decision, a batch completed
// (with the lots it drew and made), a shipment, and a payment the contract made for a PO. Each
// day's root names the previous day's root, so the roots form a chain per plant.
//
// A lot passport is the subset of leaves that tells one lot's story upstream and downstream,
// each with its path to its day's root. It discloses those records only: every other record in
// the book stays behind its hash, because each leaf carries its own random salt.
//
// Pure functions over the genealogy index (server/src/ledger/genealogy.ts) and the recorded
// payments; the frozen book with its salts lives in data/lots/lot-book.json.

import { randomBytes } from "node:crypto";
import type { Genealogy } from "../ledger/genealogy.ts";
import { leafHash, merkleRoot, type ProofStep, proofFor, rootFrom } from "./merkle.ts";

export const LOT_BOOK_FILE = "data/lots/lot-book.json";
export const LOT_BOOK_KIND = "lot_book";

export type LeafKind = "receipt" | "qc" | "batch" | "shipment" | "payment";

/** A record as it is hashed: what happened, where, when, and its salt. */
export interface Leaf {
  kind: LeafKind;
  id: string;
  plant: string;
  at: string;
  salt: string;
  record: Record<string, unknown>;
}

export interface BookDay {
  plant: string;
  date: string;
  /** The anchor's ref_id on chain: LOTBOOK-<plant>-<date>. */
  refId: string;
  root: string;
  /** The previous day's root for the same plant, or null for the first day. */
  prev: string | null;
  leaves: Leaf[];
}

export interface LotBook {
  version: 1;
  /** The genealogy clock the book was built at. */
  at: string;
  days: BookDay[];
  /** refId → the transaction that anchored it, once anchored. */
  anchors: Record<string, string>;
  /** The contract that holds the anchors, once anchored. */
  contract: string | null;
}

/** A payment the contract made for a PO, from a chain recording. */
export interface RecordedPayment {
  po: string;
  supplier: string;
  amountUnits: string;
  poHash: string | null;
  txHash: string;
  contract: string;
}

export const refIdOf = (plant: string, date: string) => `LOTBOOK-${plant}-${date}`;
const dayOf = (iso: string) => iso.slice(0, 10);

/** Every leaf the genealogy and the recorded payments give, before salts. */
export function leavesOf(g: Genealogy, payments: RecordedPayment[]): Omit<Leaf, "salt">[] {
  const out: Omit<Leaf, "salt">[] = [];
  const paidByPo = new Map(payments.map((p) => [p.po, p]));
  for (const lot of Object.values(g.lots)) {
    if (!lot.facility) continue;
    if (lot.receipt && lot.receivedAt) {
      out.push({
        kind: "receipt",
        id: lot.code,
        plant: lot.facility,
        at: lot.receipt.receivedAt,
        record: {
          lot: lot.code,
          material: lot.material,
          supplier: lot.vendor,
          supplierLot: lot.vendorLot,
          po: lot.po,
          receivedBase: lot.receivedBase,
          receivedBy: lot.receipt.by,
        },
      });
    }
    if (lot.qc) {
      out.push({
        kind: "qc",
        id: lot.code,
        plant: lot.facility,
        at: lot.qc.decidedAt,
        record: { lot: lot.code, decision: lot.qc.decision, decidedBy: lot.qc.by },
      });
    }
    const paid = lot.po ? paidByPo.get(lot.po) : undefined;
    if (paid && lot.qc && lot.qc.decision === "released") {
      // The contract pays in the QC release call, so the payment belongs to the release's day.
      paidByPo.delete(paid.po);
      out.push({
        kind: "payment",
        id: paid.po,
        plant: lot.facility,
        at: lot.qc.decidedAt,
        record: {
          po: paid.po,
          supplier: paid.supplier,
          amountUnits: paid.amountUnits,
          poHash: paid.poHash,
          contract: paid.contract,
          txHash: paid.txHash,
        },
      });
    }
  }
  for (const b of Object.values(g.batches)) {
    if (!b.completedAt) continue;
    out.push({
      kind: "batch",
      id: b.batchNo,
      plant: b.facility,
      at: b.completedAt,
      record: {
        batch: b.batchNo,
        product: b.product,
        units: b.units,
        inputs: b.inputs,
        outputs: b.outputs,
      },
    });
  }
  for (const s of Object.values(g.shipments)) {
    out.push({
      kind: "shipment",
      id: s.shipmentNo,
      plant: s.facility,
      at: s.shippedAt,
      record: { shipment: s.shipmentNo, customer: s.customer, lots: s.lots },
    });
  }
  return out;
}

const leafKey = (l: { kind: string; id: string }) => `${l.kind}:${l.id}`;
const byKey = (a: { kind: string; id: string }, b: { kind: string; id: string }) =>
  leafKey(a) < leafKey(b) ? -1 : leafKey(a) > leafKey(b) ? 1 : 0;

/** Groups salted leaves into days, sorted, with each day's root and the chain of roots. */
export function daysOf(leaves: Leaf[]): BookDay[] {
  const groups = new Map<string, { plant: string; date: string; leaves: Leaf[] }>();
  for (const l of leaves) {
    const k = `${l.plant} ${dayOf(l.at)}`;
    const g = groups.get(k) ?? { plant: l.plant, date: dayOf(l.at), leaves: [] };
    g.leaves.push(l);
    groups.set(k, g);
  }
  const days: BookDay[] = [];
  const lastRoot = new Map<string, string>();
  for (const k of [...groups.keys()].sort()) {
    const {
      plant,
      date,
      leaves: group,
    } = groups.get(k) as {
      plant: string;
      date: string;
      leaves: Leaf[];
    };
    const sorted = group.sort(byKey);
    const root = merkleRoot(sorted.map(leafHash));
    days.push({
      plant,
      date,
      refId: refIdOf(plant, date),
      root,
      prev: lastRoot.get(plant) ?? null,
      leaves: sorted,
    });
    lastRoot.set(plant, root);
  }
  return days;
}

/** A new book: fresh random salts on every leaf. */
export function buildLotBook(
  g: Genealogy,
  at: string,
  payments: RecordedPayment[],
  salt: () => string = () => randomBytes(16).toString("hex"),
): LotBook {
  const leaves = leavesOf(g, payments).map((l) => ({ ...l, salt: salt() }));
  return { version: 1, at, days: daysOf(leaves), anchors: {}, contract: null };
}

/**
 * What changed between a frozen book and what the genealogy gives now: leaves added, removed
 * or with a different record (salts aside). Empty when the book still describes the ledger.
 */
export function bookDrift(book: LotBook, g: Genealogy, payments: RecordedPayment[]): string[] {
  const frozen = new Map(book.days.flatMap((d) => d.leaves.map((l) => [leafKey(l), l] as const)));
  const drift: string[] = [];
  for (const l of leavesOf(g, payments)) {
    const f = frozen.get(leafKey(l));
    frozen.delete(leafKey(l));
    if (!f) drift.push(`new ${leafKey(l)}`);
    else if (JSON.stringify({ ...f, salt: "" }) !== JSON.stringify({ ...l, salt: "" }))
      drift.push(`changed ${leafKey(l)}`);
  }
  for (const k of frozen.keys()) drift.push(`gone ${k}`);
  return drift;
}

/** Checks a book's own arithmetic: each day's root from its leaves, and the chain of roots. */
export function bookProblems(book: LotBook): string[] {
  const problems: string[] = [];
  const lastRoot = new Map<string, string>();
  for (const d of book.days) {
    const root = merkleRoot(d.leaves.map(leafHash));
    if (root !== d.root) problems.push(`${d.refId}: root does not match its leaves`);
    if ((lastRoot.get(d.plant) ?? null) !== d.prev)
      problems.push(`${d.refId}: prev is not the previous day's root`);
    lastRoot.set(d.plant, d.root);
  }
  return problems;
}

// ------------------------------------------------------------------------------ passports

/** One disclosed record with the path from its leaf to its day's anchored root. */
export interface PassportEntry {
  leaf: Leaf;
  refId: string;
  root: string;
  proof: ProofStep[];
  anchoredTx: string | null;
}

export interface Passport {
  version: 1;
  lot: string;
  contract: string | null;
  entries: PassportEntry[];
}

/** The leaves that tell one lot's story: where it came from and everything it went into. */
export function storyOf(g: Genealogy, lotCode: string): { kind: LeafKind; id: string }[] {
  const want: { kind: LeafKind; id: string }[] = [];
  const seen = new Set<string>();
  const add = (kind: LeafKind, id: string) => {
    const k = `${kind}:${id}`;
    if (!seen.has(k)) {
      seen.add(k);
      want.push({ kind, id });
    }
  };
  const lotRecords = (code: string) => {
    const lot = g.lots[code];
    if (!lot) return;
    add("receipt", code);
    add("qc", code);
    if (lot.po) add("payment", lot.po);
  };
  // Upstream: the batch that made this lot and the lots that batch drew from, to the bought-in lots.
  const up = (code: string, depth: number) => {
    lotRecords(code);
    const made = g.lots[code]?.producedBy;
    if (made && depth < 6) {
      add("batch", made);
      for (const i of g.batches[made]?.inputs ?? []) up(i.lot, depth + 1);
    }
  };
  // Downstream: every batch that drew from it, what those batches made, and the shipments.
  const down = (code: string, depth: number) => {
    lotRecords(code);
    for (const s of g.lots[code]?.shippedIn ?? []) add("shipment", s);
    if (depth >= 6) return;
    for (const b of g.lots[code]?.usedIn ?? []) {
      add("batch", b);
      for (const out of g.batches[b]?.outputs ?? []) down(out, depth + 1);
    }
  };
  up(lotCode, 0);
  down(lotCode, 0);
  return want;
}

/** The passport for one lot from a frozen book: only the records in its story, each proved. */
export function passportFor(book: LotBook, g: Genealogy, lotCode: string): Passport {
  const index = new Map<string, { day: BookDay; i: number; leaf: Leaf }>();
  for (const day of book.days) {
    for (const [i, leaf] of day.leaves.entries()) index.set(leafKey(leaf), { day, i, leaf });
  }
  const hashCache = new Map<string, string[]>();
  const entries: PassportEntry[] = [];
  for (const w of storyOf(g, lotCode)) {
    const at = index.get(leafKey(w));
    if (!at) continue;
    let hashes = hashCache.get(at.day.refId);
    if (!hashes) {
      hashes = at.day.leaves.map(leafHash);
      hashCache.set(at.day.refId, hashes);
    }
    entries.push({
      leaf: at.leaf,
      refId: at.day.refId,
      root: at.day.root,
      proof: proofFor(hashes, at.i),
      anchoredTx: book.anchors[at.day.refId] ?? null,
    });
  }
  return { version: 1, lot: lotCode, contract: book.contract, entries };
}

/** Checks every entry of a passport against the roots it names; the roots' anchors are separate. */
export function passportProblems(p: Passport): string[] {
  return p.entries.flatMap((e) =>
    rootFrom(leafHash(e.leaf), e.proof) === e.root
      ? []
      : [`${e.leaf.kind}:${e.leaf.id} does not lead to ${e.refId}'s root`],
  );
}
