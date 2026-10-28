# web

Kevin's web UI. Design: `docs/SPEC.md`.

Built so far: a replay of the recorded testnet run (`src/data/demo-run.json`, written by `npm run web:data` from `npm run demo`). The plant-floor pane shows each step as the person who sees it (Ray's screen, Linda's phone, Tommy, Priya, Marcy); the "Behind the curtain" switch opens the transaction log with signer, who paid the gas, refusal messages, events and explorer links. Staff cards never show chain words (`src/run.test.ts`). Back/Next, the slider and the arrow keys step through; Play advances every 2.6 s.

`npm run web:build` writes a static site to `web/dist/` with relative paths, so it can be hosted from any static host.

The HTTP API for the live screens exists (`npm run api`, `api/`): it serves this built folder at `/` and the run at `/api/run`; in development `npm run web` proxies `/api` to it. Not built yet: the live purchaser, receiving, QC and accounting screens on that API, the plant map and the HQ policy view.
