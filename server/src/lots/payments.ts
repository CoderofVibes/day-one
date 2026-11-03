// The payments the contract made, read from the chain recordings: every successful `qc_release`
// with the PO's supplier, amount and po_hash from the same recording's successful submission.
// The lot book puts each one beside the lot it paid for (server/src/lots/lotBook.ts).

import type { RecordedPayment } from "./lotBook.ts";

interface Entry {
  type: string;
  request?: { method: string; receiverId: string; args: Record<string, unknown> };
  outcome?: { status: string; txHash?: string | null };
}

export function paymentsFrom(recordings: { entries: Entry[] }[]): RecordedPayment[] {
  const out: RecordedPayment[] = [];
  for (const rec of recordings) {
    const submitted = new Map<string, Record<string, unknown>>();
    for (const e of rec.entries) {
      if (e.type !== "call" || !e.request || e.outcome?.status !== "success") continue;
      const { method, args, receiverId } = e.request;
      const po = typeof args.po_id === "string" ? args.po_id : null;
      if (!po) continue;
      if (method === "submit_po" || method === "submit_pooled_po") submitted.set(po, args);
      if (method === "qc_release" && e.outcome.txHash) {
        const s = submitted.get(po);
        if (!s) continue;
        out.push({
          po,
          supplier: String(s.supplier),
          amountUnits: String(s.amount),
          poHash: typeof s.po_hash === "string" ? s.po_hash : null,
          txHash: e.outcome.txHash,
          contract: receiverId,
        });
      }
    }
  }
  return out;
}
