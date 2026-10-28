// The audit trail: who did what, when, to which record. Every service write adds a row.

import type { ErpDb } from "../db.ts";
import { auditTrail } from "../schema.ts";

export interface AuditInput {
  at: string;
  userId: number;
  action: (typeof auditTrail.$inferInsert)["action"];
  recordType: string;
  recordId?: number | null;
  tranId?: string | null;
  detail: string;
}

export function audit(db: ErpDb, input: AuditInput) {
  db.insert(auditTrail)
    .values({
      at: input.at,
      userId: input.userId,
      action: input.action,
      recordType: input.recordType,
      recordId: input.recordId ?? null,
      tranId: input.tranId ?? null,
      detail: input.detail,
    })
    .run();
}
