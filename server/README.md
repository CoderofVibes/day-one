# server

Inventory ledger, NEAR integration, relayer client and the shared libraries the API, Kevin and the scripts use. Design: docs/ARCHITECTURE.md and docs/DATA_MODEL.md.

- `src/ledger/` — SQLite ledger (Drizzle), hash-chained lot events; the three-plant inventory read and the bookkeeper export (`books.ts`); and the pure reads behind the v2 pages (docs/VISION.md §6.6): `areas.ts` (what each of a plant's twenty areas holds and did, the sheet the plant map opens), `series.ts` (the charts' series: output and yield per batch, stock over time, spend and QC per month), `views.ts` (every PO, request for quotes, lot and batch record with its state) and `catalog.ts` (products with their formulas and plants, suppliers with what they are approved to supply).
- `src/seed/` — the fictional company (`npm run seed`): three plants split into twenty areas with their equipment (`equipment.ts`), ten products, the hand-written history behind the demo (`history.ts`, `lots.ts`) and about 120 days of deterministic batches, purchases and packaging runs with a four-week plan (`production.ts`; docs/VISION.md §6.12.2).
- `src/llm/` — `LlmClient`: routes each task (`reasoning`, `vision`) to NEAR AI Cloud or Anthropic from `LLM_ROUTE_*`, and records or replays answers (replay unless `DAYONE_MODE=live`).
- `src/extraction/` — the batch-record transcription schema and the bake-off scorer.
- `src/attestation/` — fetches and verifies NEAR AI Cloud's attestation report and the signature of each recorded answer (`npm run attest`, `npm run verify:attestation`).
- `src/records/` — record anchoring: salted fingerprints, lot event ranges, `anchor_batch`, and the keyless check behind `npm run verify`.
- `src/relayer/` — the in-process NEP-366 relayer: staff calls signed with the staff member's function-call key, paid by `dayone-relayer.testnet`, limited to each staff account's own spend-policy methods.
- `src/chain/` — the only path to NEAR. `ChainClient` logs every change call to `chain_tx` (pending, then success, refused or failed); `LiveTransport` signs on testnet; `RecordingTransport` and `ReplayTransport` save and replay `data/replay/` fixtures; `policy.ts` reads the policy with view calls; `summary.ts` counts a run's transactions one way everywhere.
- `src/import/` — the spreadsheet import wizard's engine: a small XLSX/CSV reader, the inventory sheet's flags and opening stock, the sales tab.
- `src/erp-connector/` — the connector interface to an acquirer's ERP, its adapter for the NetSuite-shaped mock in `erp/`, the sync, and the three-way reconciliation (`npm run erp:reconcile`).
- `src/canonical.ts`, `src/money.ts`, `src/quotes.ts`, `src/sealed.ts` — canonical JSON hashing, money in base units, quote fingerprints, and the sealed-round check behind `npm run verify:round`.
