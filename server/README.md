# server

API, inventory ledger, NEAR integration and relayer client. Design: docs/ARCHITECTURE.md and docs/DATA_MODEL.md.

- `src/ledger/` — SQLite ledger (Drizzle), hash-chained lot events.
- `src/seed/` — the fictional company and its 30-day history (`npm run seed`).
- `src/llm/` — `LlmClient`: routes each task (`reasoning`, `vision`) to NEAR AI Cloud or Anthropic from `LLM_ROUTE_*`, and records or replays answers (replay unless `DAYONE_MODE=live`).
- `src/relayer/` — the in-process NEP-366 relayer: staff calls signed with the staff member's function-call key, paid by `dayone-relayer.testnet`, limited to each staff account's own spend-policy methods.
- `src/chain/` — the only path to NEAR. `ChainClient` logs every change call to `chain_tx` (pending, then success, refused or failed); `LiveTransport` signs on testnet; `RecordingTransport` and `ReplayTransport` save and replay `data/replay/` fixtures.
