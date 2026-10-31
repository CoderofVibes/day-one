// The genealogy index (server/src/ledger/genealogy.ts) and the walk the Lots & recall page runs
// over it (web/src/genealogy.ts), checked against a brute-force walk of the same ledger tables in
// SQL: every lot forward to its batches and what they made, every batch back to its raw lots, and
// every raw lot back to its supplier lot, PO and receipt.

import { beforeAll, describe, expect, it } from "vitest";
import { type Ledger, openLedger } from "../../server/src/ledger/db.ts";
import { genealogy } from "../../server/src/ledger/genealogy.ts";
import { seedLedger } from "../../server/src/seed/index.ts";
import {
  drillLot,
  type Genealogy,
  GOLDEN_LOT,
  runDrill,
  trace,
  traceReport,
} from "../../web/src/genealogy.ts";

let db: Ledger;
let g: Genealogy;

beforeAll(() => {
  db = openLedger();
  seedLedger(db);
  g = genealogy(db);
});

const all = <T>(sql: string, ...args: unknown[]) => db.$client.prepare(sql).all(...args) as T[];
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

function batchesUsing(lot: string) {
  return all<{ b: string }>(
    `select br.batch_no b from batch_inputs bi join batch_records br on br.id = bi.batch_id
     join lots l on l.id = bi.lot_id where l.lot_code = ?`,
    lot,
  ).map((r) => r.b);
}
function lotsMadeBy(batch: string) {
  return all<{ l: string }>(
    `select l.lot_code l from batch_outputs bo join lots l on l.id = bo.output_lot_id
     join batch_records br on br.id = bo.batch_id where br.batch_no = ?
     union select l.lot_code from lots l join batch_records br on br.id = l.produced_by_batch_id
     where br.batch_no = ?`,
    batch,
    batch,
  ).map((r) => r.l);
}
function lotsInto(batch: string) {
  return all<{ l: string }>(
    `select l.lot_code l from batch_inputs bi join lots l on l.id = bi.lot_id
     join batch_records br on br.id = bi.batch_id where br.batch_no = ?`,
    batch,
  ).map((r) => r.l);
}
function producer(lot: string) {
  return (
    all<{ b: string }>(
      `select br.batch_no b from lots l join batch_records br on br.id = l.produced_by_batch_id
       where l.lot_code = ? union select br.batch_no from batch_outputs bo
       join batch_records br on br.id = bo.batch_id join lots l on l.id = bo.output_lot_id
       where l.lot_code = ?`,
      lot,
      lot,
    )[0]?.b ?? null
  );
}

/** Everything downstream of a lot, by repeated queries until nothing new turns up. */
function bruteForward(lot: string) {
  const lots = new Set([lot]);
  const batches = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const l of [...lots]) {
      for (const b of batchesUsing(l)) {
        if (!batches.has(b)) {
          batches.add(b);
          grew = true;
        }
      }
    }
    for (const b of [...batches]) {
      for (const l of lotsMadeBy(b)) {
        if (!lots.has(l)) {
          lots.add(l);
          grew = true;
        }
      }
    }
  }
  lots.delete(lot);
  return { batches: sorted(batches), lots: sorted(lots) };
}
/** The raw lots behind a batch, through any lots that batches made. */
function bruteRawLots(batch: string): string[] {
  const out: string[] = [];
  for (const l of lotsInto(batch)) {
    const by = producer(l);
    if (by) out.push(...bruteRawLots(by));
    else out.push(l);
  }
  return sorted(out);
}

describe("genealogy index against a brute-force walk of the ledger", () => {
  it("indexes every lot and batch in the ledger", () => {
    expect(Object.keys(g.lots).length).toBe(all("select id from lots").length);
    expect(Object.keys(g.batches).length).toBe(all("select id from batch_records").length);
    expect(Object.values(g.batches).flatMap((b) => b.inputs).length).toBeGreaterThan(0);
  });

  it("traces every lot forward to the same batches and lots", () => {
    for (const code of Object.keys(g.lots)) {
      const t = trace(g, { kind: "lot", id: code });
      const brute = bruteForward(code);
      expect({ code, batches: sorted(t.batches) }).toEqual({ code, batches: brute.batches });
      const fg = t.fgLots.filter((l) => l !== code);
      expect(sorted(fg)).toEqual(brute.lots);
    }
  });

  it("traces every batch back to the same raw lots", () => {
    for (const no of Object.keys(g.batches)) {
      const t = trace(g, { kind: "batch", id: no });
      expect({ no, raw: sorted(t.rawLots) }).toEqual({ no, raw: bruteRawLots(no) });
    }
  });

  it("carries each lot's supplier lot, PO and receipt as the tables hold them", () => {
    for (const l of Object.values(g.lots)) {
      const row = all<{ vendorLot: string | null; state: string | null }>(
        "select vendor_lot_code vendorLot, state from lots where lot_code = ?",
        l.code,
      )[0];
      expect(l.vendorLot).toBe(row?.vendorLot);
      expect(l.state).toBe(row?.state);
      const po =
        all<{ po: string }>(
          `select po.po_no po from lot_events e join lots l on l.id = e.lot_id
           join purchase_orders po on po.id = e.ref_id
           where l.lot_code = ? and e.kind = 'received' and e.ref_type = 'po' order by e.seq`,
          l.code,
        )[0]?.po ?? null;
      expect({ lot: l.code, po: l.po }).toEqual({ lot: l.code, po });
      const receipt =
        po === null
          ? null
          : (all<{ at: string }>(
              `select r.received_at at from receipts r join purchase_orders po on po.id = r.po_id
               where po.po_no = ? order by r.received_at`,
              po,
            )[0]?.at ?? null);
      expect(l.receipt?.receivedAt ?? null).toBe(receipt);
    }
  });

  it("says the ledger has no finished-goods lots or shipments, so traces stop at the batch", () => {
    expect(all("select id from batch_outputs").length).toBe(0);
    expect(g.has).toEqual({ fgLots: false, shipments: false });
  });
});

describe("recall drill on the seeded ledger", () => {
  const plantName = (code: string) => `Plant ${code}`;

  it("picks the ascorbic acid lot used in the most batches, never the recorded run's lot", () => {
    const lot = drillLot(g);
    expect(lot).not.toBeNull();
    expect(lot?.code).not.toBe(GOLDEN_LOT);
    expect(lot?.material).toBe("ASC");
    const most = Math.max(
      ...Object.values(g.lots)
        .filter((l) => l.material === "ASC" && l.code !== GOLDEN_LOT)
        .map((l) => batchesUsing(l.code).length),
    );
    expect(lot?.usedIn.length).toBe(most);
  });

  it("never targets the recorded run's lot even when it is used the most", () => {
    // The seed ends before the recorded run receives the lot; the run's ledger has it.
    const like = drillLot(g);
    if (!like) throw new Error("no drill lot");
    const golden = g.lots[GOLDEN_LOT] ?? { ...like, code: GOLDEN_LOT, vendorLot: "NGI-26111601" };
    const boosted: Genealogy = {
      ...g,
      lots: { ...g.lots, [GOLDEN_LOT]: { ...golden, usedIn: Object.keys(g.batches) } },
    };
    expect(drillLot(boosted)?.code).not.toBe(GOLDEN_LOT);
  });

  it("matches the supplier's lot, counts the batches and units, and leaves the index as it was", () => {
    const before = JSON.stringify(g);
    const ledgerBefore = all("select count(*) n, max(seq) s from lot_events");
    const lot = drillLot(g);
    if (!lot?.vendorLot) throw new Error("no drill lot");
    let tick = 0;
    const r = runDrill(g, lot.vendorLot, plantName, () => tick++);
    expect(r?.lot).toBe(lot.code);
    expect(sorted(r?.trace.batches ?? [])).toEqual(bruteForward(lot.code).batches);
    const units = all<{ u: number }>(
      `select coalesce(sum(br.actual_tablets), 0) u from batch_records br where br.id in
       (select bi.batch_id from batch_inputs bi join lots l on l.id = bi.lot_id where l.lot_code = ?)`,
      lot.code,
    )[0]?.u;
    expect(r?.unitsAffected).toBe(units);
    expect(r?.valueAtRiskUsdc).toBeGreaterThan(0);
    expect(r?.steps.map((s) => s.ms)).toEqual(
      [...(r?.steps ?? [])].map((s) => s.ms).sort((a, b) => a - b),
    );
    // The same drill gives the same report, and nothing it read changed.
    const again = runDrill(g, lot.vendorLot, plantName, () => 0);
    expect(traceReport(again ?? (r as never))).toBe(traceReport(r as never));
    expect(JSON.stringify(g)).toBe(before);
    expect(all("select count(*) n, max(seq) s from lot_events")).toEqual(ledgerBefore);
  });
});
