# agents/kevin

Kevin, the AI purchasing and inventory assistant: tool-use loop, prompts, tools. Design: docs/ARCHITECTURE.md.

- `src/forecast.ts`: the reorder forecast for one material at one plant. Need = planned batches in the horizon (default 10 days) × actual use per tablet at that plant; shortfall = need − on hand − on order; recommends a multiple of the reorder quantity when stock would fall below the reorder point. No LLM.
- `src/purchasing.ts`: `requestQuotes` (one quote per listed vendor that answers, hashed), `rankQuotes` (unqualified and late quotes excluded with a reason, the rest by landed cost; conditional vendors flagged for approval), `draftPo` and `draftPoFromRanking` (lines, freight, total, `po_hash`, one spend category per PO).
