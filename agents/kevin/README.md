# agents/kevin

Kevin, the AI purchasing and inventory assistant. Design: docs/ARCHITECTURE.md. The contract enforces every limit; nothing here checks one off-chain.

The purchasing loop:

- `src/extraction.ts`: reads a batch record. The vision model only transcribes (`server/src/extraction/schema.ts`); code converts units and checks each material against the formula and each lot against the ledger.
- `src/discrepancies.ts`: a transfer weighed in short while the sending plant's book still shows the difference is phantom stock; Kevin raises a discrepancy with both numbers.
- `src/forecast.ts`: the reorder forecast for one material at one plant. Need = planned batches in the horizon (default 10 days) × actual use per tablet at that plant; shortfall = need − on hand − on order; recommends a multiple of the reorder quantity when stock would fall below the reorder point. No LLM.
- `src/purchasing.ts`: `requestQuotes` (one quote per listed vendor that answers, hashed), `rankQuotes` (unqualified and late quotes excluded with a reason, the rest by landed cost; conditional vendors flagged for approval), `draftPo` and `draftPoFromRanking` (lines, freight, total, `po_hash`, one spend category per PO).
- `src/submit.ts`: `submitPo` sends a draft to `submit_po` as Kevin. The contract decides; Kevin reads the result (funded, awaiting approval with the approval request, or refused with no approval path) and never checks a limit himself.
- `src/approval.ts`: `handleApprovalReply` — "YES 1042" from the approver becomes a relayed `approve_po` with the PO's exact terms, then Kevin's identical `submit_po` retry; "NO 1042" a relayed `reject_po`; anything else asks again.
- `src/receiving.ts`: Tommy's packing slip matched against the PO and the supplier's on-chain lot; Priya's QC release or reject, relayed, which pays the supplier or refunds the escrow.
- `src/demo.ts`: sequences the modules above on the demo clock (`npm run demo`, `npm run demo:live`).

Around the loop:

- `src/groupBuy.ts`: the plants pool one material into one RFQ and one pooled PO with per-plant shares and approvals (docs/GROUP_BUY.md; `npm run demo:group`).
- `src/sealed.ts`, `src/sealedRound.ts`, `src/sealedEnv.ts`: sealed quote rounds, where no price is readable before the deadline (CONTRACTS.md §10; `npm run sealed`).
- `src/usdcOrder.ts`: PO-1047 in Circle testnet USDC on a second deployment of the same contract (`npm run usdc`).
- `src/transferSuggestions.ts`: before buying, proposes moving stock from a sister plant with surplus.
- `src/massBalance.ts`: material issued against tablets, QC samples and recorded waste; flags unaccounted material.
- `src/brief.ts`: Kevin's printable 5am brief for one plant (`npm run brief`).
- `src/policyChange.ts`: reads HQ's plain-words limit change and drafts the one owner call (`npm run policy`). Kevin never signs it.
- `src/invoices.ts`, `src/payments.ts`: supplier invoices and "please pay again" messages; neither can move money.
- `src/erp.ts`: posts Day One's records to the acquirer's ERP through the connector (docs/ERP.md).
- `src/mcp.ts`: Kevin as an MCP server: read tools, `draft_po` and `draft_policy_change`, drafts only (`npm run mcp`).
- `src/attacks.ts`, `src/credential-attacks.ts`: the attack suite (`npm run test:attacks`).
