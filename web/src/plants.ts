// The three-plant view at the end of the recorded run, for the static replay: written by
// npm run web:data from the same replay npm run demo plays, so a hosted page with no API still
// shows stock by plant, the discrepancy, the mass balance, the books and Kevin's proposed moves.
// Read-only: applying, dismissing and approving need the API (npm run api).

import type { Books, MassBalance, PlantInventory, TransferSuggestions } from "./api.ts";
import snapshot from "./data/plants.json";

export interface PlantsSnapshot {
  /** The run's clock when the snapshot was taken. */
  at: string;
  inventory: PlantInventory;
  massBalance: MassBalance;
  books: Books;
  transfers: TransferSuggestions;
}

export const plantsSnapshot = snapshot as PlantsSnapshot;

/** Kevin's 5am brief and the bookkeeper CSV, served beside the static page (web/public). */
export const STATIC_BRIEF_URL = "brief.html";
export const STATIC_BOOKS_URL = "books.csv";
