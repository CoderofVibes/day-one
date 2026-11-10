import scan from "../../data/batch-records/BR-B-1045.jpg?url";
import type { InboxItem } from "./api.ts";
import journey from "./data/journey.json";

const item = (journey.scans as InboxItem[]).find((s) => s.batchNo === "BR-B-1045");
export const recordedBatchReview = item?.reading
  ? { scan, reading: item.reading, posted: item.postedReading, confirmedBy: item.confirmedBy }
  : null;
