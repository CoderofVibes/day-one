// Kevin's morning review of Ray's mailbox for the static replay: written by npm run web:data
// from the same recorded readings the API replays (api/src/review.ts), on the ledger the run
// begins with, so a hosted page with no API still shows what Kevin read overnight, his check of
// each message and what a signature would do. Read-only: signing needs the API (npm run api).

import type { ReviewState } from "./api.ts";
import snapshot from "./data/review.json";

export const reviewSnapshot = snapshot as ReviewState;

/** The footer of the panel on a static host, where no one can sign. */
export const REVIEW_READ_ONLY =
  "Recorded preview · drafts unsigned. Ray signs them in the working app.";
