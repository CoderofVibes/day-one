# agents/kevin

Kevin, the AI purchasing and inventory assistant: tool-use loop, prompts, tools. Design: docs/ARCHITECTURE.md.

- `src/forecast.ts`: the reorder forecast for one material at one plant. Need = planned batches in the horizon (default 10 days) × actual use per tablet at that plant; shortfall = need − on hand − on order; recommends a multiple of the reorder quantity when stock would fall below the reorder point. No LLM.
- `src/purchasing.ts`: `requestQuotes` (one quote per listed vendor that answers, hashed), `rankQuotes` (unqualified and late quotes excluded with a reason, the rest by landed cost; conditional vendors flagged for approval), `draftPo` and `draftPoFromRanking` (lines, freight, total, `po_hash`, one spend category per PO).
- `src/submit.ts`: `submitPo` sends a draft to `submit_po` as Kevin. The contract decides; Kevin reads the result (funded, awaiting approval with the approval request, or refused with no approval path) and never checks a limit himself.
- `src/approval.ts`: `handleApprovalReply` — "YES 1042" from the approver becomes a relayed `approve_po` with the PO's exact terms, then Kevin's identical `submit_po` retry; "NO 1042" a relayed `reject_po`; anything else asks again.
