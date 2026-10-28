// Test support: Kevin reads and Ray confirms BR-B-1045 (DEMO_SCRIPT steps 1 and 2), so
// forecast and purchasing tests start from the demo state at step 4. The transcription is
// GLM 5.3 Flash's reading of the rendered record from the vision bake-off.

import { readFileSync } from "node:fs";
import type { BatchRecordExtraction } from "@day-one/server/extraction/schema";
import type { Ledger } from "@day-one/server/ledger/db";
import { staff } from "@day-one/server/ledger/schema";
import { eq } from "drizzle-orm";
import { confirmBatchRecord, saveBatchDraft } from "../extraction.ts";

const AT = "2026-11-09T13:05:00.000Z";

export const idOf = <T extends { id: number }>(row: T | undefined) => {
  if (!row) throw new Error("missing row");
  return row.id;
};

export const BR_1045_EXTRACTION: BatchRecordExtraction = JSON.parse(
  readFileSync(
    new URL("../../../../data/bakeoff/z-ai_glm-5.3-flash/BR-B-1045.json", import.meta.url),
    "utf8",
  ),
).answer;

export function confirmBr1045(db: Ledger) {
  const { batchId } = saveBatchDraft(db, structuredClone(BR_1045_EXTRACTION), {
    file: "data/batch-records/BR-B-1045.jpg",
    sha256: "0".repeat(64),
    model: "nearai:z-ai/glm-5.3-flash",
  });
  const ray = idOf(db.select().from(staff).where(eq(staff.name, "Ray Delgado")).get());
  return confirmBatchRecord(db, batchId, { staffId: ray, now: AT, salt: "0".repeat(32) });
}
