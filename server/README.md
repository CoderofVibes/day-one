# server

Inventory ledger, NEAR integration, relayer client and the shared libraries the API, Kevin and the scripts use. Design: docs/ARCHITECTURE.md and docs/DATA_MODEL.md.

- `src/ledger/` — SQLite ledger (Drizzle), hash-chained lot events; also the three-plant inventory read and the bookkeeper export (`books.ts`).
- `src/seed/` — the fictional company and its 30-day history (`npm run seed`).
- `src/llm/` — `LlmClient`: routes each task (`reasoning`, `vision`) to NEAR AI Cloud or Anthropic from `LLM_ROUTE_*`, and records or replays answers (replay unless `DAYONE_MODE=live`).
- `src/extraction/` — the batch-record transcription schema and the bake-off scorer.
- `src/attestation/` — fetches and verifies NEAR AI Cloud's attestation report and the signature of each recorded answer (`npm run attest`, `npm run verify:attestation`).
- `src/records/` — record anchoring: salted fingerprints, lot event ranges, `anchor_batch`, and the keyless check behind `npm run verify`.
- `src/relayer/` — the in-process NEP-366 relayer: staff calls signed with the staff member's function-call key, paid by `dayone-relayer.testnet`, limited to each staff account's own spend-policy methods.
- `src/chain/` — the only path to NEAR. `ChainClient` logs every change call to `chain_tx` (pending, then success, refused or failed); `LiveTransport` signs on testnet; `RecordingTransport` and `ReplayTransport` save and replay `data/replay/` fixtures; `policy.ts` reads the policy with view calls; `summary.ts` counts a run's transactions one way everywhere.
- `src/import/` — the spreadsheet import wizard's engine: a small XLSX/CSV reader, the inventory sheet's flags and opening stock, the sales tab.
- `src/erp-connector/` — the connector interface to an acquirer's ERP, its adapter for the NetSuite-shaped mock in `erp/`, the sync, and the three-way reconciliation (`npm run erp:reconcile`).
- `src/canonical.ts`, `src/money.ts`, `src/quotes.ts`, `src/sealed.ts` — canonical JSON hashing, money in base units, quote fingerprints, and the sealed-round check behind `npm run verify:round`.
