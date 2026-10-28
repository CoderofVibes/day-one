# server

API, inventory ledger, NEAR integration and relayer client. Design: docs/ARCHITECTURE.md and docs/DATA_MODEL.md.

- `src/ledger/` — SQLite ledger (Drizzle), hash-chained lot events.
- `src/seed/` — the fictional company and its 30-day history (`npm run seed`).
- `src/chain/` — the only path to NEAR. `ChainClient` logs every change call to `chain_tx` (pending, then success, refused or failed); `LiveTransport` signs on testnet; `RecordingTransport` and `ReplayTransport` save and replay `data/replay/` fixtures.
