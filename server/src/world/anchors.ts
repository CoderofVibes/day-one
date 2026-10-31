// The anchors (docs/UPGRADE_BRIEF.md §2.1.8): every record the seed and the recorded run leave
// at one plant, read from a ledger after the run, in a plain JSON form. The world never changes
// them; the frozen copy in data/world/ is what the anchor-integrity test compares against.
// Event hashes and recorded-at times are left out (they belong to the ledger's own chain);
// the record hashes that were anchored on testnet (batch records, POs) and every recorded
// transaction are kept.

import { sql } from "drizzle-orm";
import type { Ledger } from "../ledger/db.ts";

export interface AnchorEvent {
  seq: number;
  lot: string;
  kind: string;
  qtyBase: number;
  at: string;
  /** "po:PO-1042", "batch:BR-B-1045", "transfer:TR-A-B-261102", "qc:ASC-261116-01" or "". */
  ref: string;
  reason: string | null;
}

export interface Anchors {
  facility: string;
  lots: { lot: string; material: string; vendor: string; vendorLot: string; state: string }[];
  events: AnchorEvent[];
  balances: { lot: string; onHandBase: number }[];
  pos: {
    poNo: string;
    vendor: string;
    category: string;
    totalUsdc: number;
    freightUsdc: number;
    status: string;
    createdBy: string;
    poHash: string | null;
    lines: { material: string; qtyBase: number; unitPriceUsdc: number; extendedUsdc: number }[];
  }[];
  receipts: { poNo: string; receivedAt: string; matchStatus: string }[];
  batches: {
    batchNo: string;
    product: string;
    startedAt: string;
    completedAt: string | null;
    theoreticalTablets: number;
    actualTablets: number | null;
    yieldBp: number | null;
    wasteBase: number | null;
    status: string;
    recordHash: string | null;
    inputs: { lot: string; material: string; actualBase: number }[];
  }[];
  qc: { lot: string; decision: string; decidedAt: string }[];
  transfers: {
    transferNo: string;
    lot: string;
    from: string;
    to: string;
    shippedBase: number;
    receivedBase: number | null;
    state: string;
  }[];
  plan: { batchNo: string; product: string; plannedFor: string; batchTablets: number }[];
  rfqs: {
    rfqNo: string;
    material: string;
    qtyBase: number;
    quotes: {
      vendor: string;
      unitPriceUsdc: number;
      freightUsdc: number;
      leadDays: number;
      status: string;
      reason: string | null;
      quoteHash: string | null;
    }[];
  }[];
  approvals: {
    poNo: string;
    approver: string;
    requestText: string;
    responseText: string | null;
    state: string;
    requestedAt: string;
    respondedAt: string | null;
  }[];
  chain: {
    txHash: string | null;
    method: string;
    signer: string;
    receiver: string;
    status: string;
    error: string | null;
    explorerUrl: string | null;
    at: string;
    /** The PO a transaction acted on, when it acted on one. */
    poNo: string | null;
  }[];
}

/** Reads one facility's anchors from a ledger. */
export function readAnchors(db: Ledger, facility: string): Anchors {
  const all = <T>(query: string) => db.all<T>(sql.raw(query));
  const f = all<{ id: number }>(`select id from facilities where code = '${facility}'`)[0];
  if (!f) throw new Error(`anchors: no facility ${facility}`);
  const fid = f.id;

  const lotIds = `(select distinct lot_id from lot_events where facility_id = ${fid})`;
  const lots = all<{
    lot: string;
    material: string;
    vendor: string;
    vendorLot: string;
    state: string;
  }>(
    `select l.lot_code lot, m.code material, v.code vendor, l.vendor_lot_code vendorLot, l.state
     from lots l join materials m on m.id = l.material_id join vendors v on v.id = l.vendor_id
     where l.id in ${lotIds} order by l.lot_code`,
  );
  const events = all<AnchorEvent>(
    `select e.seq, l.lot_code lot, e.kind, e.qty_delta_base qtyBase, e.occurred_at at,
       coalesce(case e.ref_type
         when 'po' then 'po:' || (select po_no from purchase_orders where id = e.ref_id)
         when 'batch' then 'batch:' || (select batch_no from batch_records where id = e.ref_id)
         when 'transfer' then 'transfer:' || (select transfer_no from transfers where id = e.ref_id)
         when 'qc' then 'qc:' || l.lot_code
         else '' end, '') ref,
       e.reason
     from lot_events e join lots l on l.id = e.lot_id
     where e.facility_id = ${fid} order by e.seq`,
  );
  const balances = all<{ lot: string; onHandBase: number }>(
    `select l.lot_code lot, b.on_hand_base onHandBase from lot_balances b join lots l on l.id = b.lot_id
     where b.facility_id = ${fid} order by l.lot_code`,
  );
  const poRows = all<Omit<Anchors["pos"][number], "lines"> & { id: number }>(
    `select p.id, p.po_no poNo, v.code vendor, p.category, p.total_usdc totalUsdc,
       p.freight_usdc freightUsdc, p.status, p.created_by createdBy, p.po_hash poHash
     from purchase_orders p join vendors v on v.id = p.vendor_id
     where p.ship_to_facility_id = ${fid} order by p.po_no`,
  );
  const pos = poRows.map(({ id, ...po }) => ({
    ...po,
    lines: all<Anchors["pos"][number]["lines"][number]>(
      `select m.code material, l.qty_base qtyBase, l.unit_price_usdc unitPriceUsdc,
         l.extended_usdc extendedUsdc
       from po_lines l join materials m on m.id = l.material_id where l.po_id = ${id} order by l.line_no`,
    ),
  }));
  const receipts = all<Anchors["receipts"][number]>(
    `select p.po_no poNo, r.received_at receivedAt, r.match_status matchStatus
     from receipts r join purchase_orders p on p.id = r.po_id
     where r.facility_id = ${fid} order by r.received_at, p.po_no`,
  );
  const batchRows = all<Omit<Anchors["batches"][number], "inputs"> & { id: number }>(
    `select b.id, b.batch_no batchNo, p.code product, b.started_at startedAt,
       b.completed_at completedAt, b.theoretical_tablets theoreticalTablets,
       b.actual_tablets actualTablets, b.yield_bp yieldBp, b.waste_base wasteBase, b.status,
       b.record_hash recordHash
     from batch_records b join products p on p.id = b.product_id
     where b.facility_id = ${fid} order by b.started_at, b.batch_no`,
  );
  const batches = batchRows.map(({ id, ...b }) => ({
    ...b,
    inputs: all<Anchors["batches"][number]["inputs"][number]>(
      `select l.lot_code lot, m.code material, i.actual_base actualBase
       from batch_inputs i join lots l on l.id = i.lot_id join materials m on m.id = i.material_id
       where i.batch_id = ${id} order by i.id`,
    ),
  }));
  const qc = all<Anchors["qc"][number]>(
    `select l.lot_code lot, q.decision, q.decided_at decidedAt
     from qc_decisions q join lots l on l.id = q.lot_id
     where q.lot_id in ${lotIds} order by q.decided_at, l.lot_code`,
  );
  const transfers = all<Anchors["transfers"][number]>(
    `select t.transfer_no transferNo, l.lot_code lot, a.code "from", b.code "to",
       t.qty_shipped_base shippedBase, t.qty_received_base receivedBase, t.state
     from transfers t join lots l on l.id = t.lot_id
       join facilities a on a.id = t.from_facility_id join facilities b on b.id = t.to_facility_id
     where t.from_facility_id = ${fid} or t.to_facility_id = ${fid} order by t.transfer_no`,
  );
  const plan = all<Anchors["plan"][number]>(
    `select pp.batch_no batchNo, p.code product, pp.planned_for plannedFor, pp.batch_tablets batchTablets
     from production_plan pp join products p on p.id = pp.product_id
     where pp.facility_id = ${fid} and pp.status = 'planned' order by pp.planned_for, pp.batch_no`,
  );
  const rfqRows = all<{ id: number; rfqNo: string; material: string; qtyBase: number }>(
    `select r.id, r.rfq_no rfqNo, m.code material, r.qty_base qtyBase
     from rfqs r join materials m on m.id = r.material_id where r.facility_id = ${fid} order by r.rfq_no`,
  );
  const rfqs = rfqRows.map(({ id, ...r }) => ({
    ...r,
    quotes: all<Anchors["rfqs"][number]["quotes"][number]>(
      `select v.code vendor, q.unit_price_usdc unitPriceUsdc, q.freight_usdc freightUsdc,
         q.lead_time_days leadDays, q.status, q.exclusion_reason reason, q.quote_hash quoteHash
       from quotes q join vendors v on v.id = q.vendor_id where q.rfq_id = ${id} order by v.code`,
    ),
  }));
  const approvals = all<Anchors["approvals"][number]>(
    `select p.po_no poNo, s.name approver, a.request_text requestText, a.response_text responseText,
       a.state, a.requested_at requestedAt, a.responded_at respondedAt
     from approvals a join purchase_orders p on p.id = a.po_id join staff s on s.id = a.approver_staff_id
     where p.ship_to_facility_id = ${fid} order by a.requested_at`,
  );
  const chain = all<Anchors["chain"][number]>(
    `select c.tx_hash txHash, c.method, c.signer_id signer, c.receiver_id receiver, c.status,
       c.error_message error, c.explorer_url explorerUrl, c.created_at at,
       case c.related_type when 'purchase_order'
         then (select po_no from purchase_orders where id = c.related_id) end poNo
     from chain_tx c order by c.id`,
  );
  return {
    facility,
    lots,
    events,
    balances,
    pos,
    receipts,
    batches,
    qc,
    transfers,
    plan,
    rfqs,
    approvals,
    chain,
  };
}
