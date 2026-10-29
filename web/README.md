# web

Kevin's web UI. Design: `docs/SPEC.md`.

One UI, two sources:

- **Live** (`npm run api`, then open http://localhost:8787/): the screens run the demo behind the HTTP API (`api/`). An action bar shows whoever is up next with their buttons: Ray uploads a batch record (the one on file, or a photo from disk) and confirms it; Linda's phone shows Kevin's text with YES/NO; Tommy photographs the packing slip (picks a slip number: reading the slip photo is not built); Priya releases or rejects the lot; Start over reseeds. Kevin's own steps appear as cards as they happen. Replay by default, so each click replays the recorded testnet transaction for that step; `npm run api:live` sends real ones. The API marks the page it serves with a meta tag; that is how the UI knows to run live.
- **Replay** (any static host, `npm run web:build` → `web/dist/`): steps through the recorded run (`src/data/demo-run.json`, written by `npm run web:data`) with Back/Next, the slider, the arrow keys and Play (2.6 s a step).

Live mode also has a "Three plants" switch: stock on hand per plant and material from the ledger, low stock against the reorder point, and the transfer discrepancies Kevin raised with Apply/Dismiss for the reviewer (`GET /api/inventory`, `POST /api/discrepancies/:id/review`). Under the table, the mass balance (`GET /api/mass-balance`): issued against tablets, QC samples and recorded waste per plant and product, with Kevin's line on the plant whose waste looks under-recorded. It refreshes as the run moves.

In both, the plant-floor pane shows each step as the person who sees it, and the "Behind the curtain" switch opens the transaction log with signer, who paid the gas, refusal messages, events and explorer links. Staff cards never show chain words (`src/run.test.ts`). The button logic for the live bar is pure data in `src/live.ts` (`src/live.test.ts`). In development, `npm run web` proxies `/api` to the API.

Screenshots: `npm run web:shot -- <dir>` (static), `URL=http://localhost:8787/ npm run web:shot -- <dir>` (live, clicks through the run; `PLANTS=1` opens the three-plant view, `FULL=1` captures the whole page).

The static replay also has "Three plants", read-only: the ledger as it stands at the end of the recorded run (`src/data/plants.json`), with Kevin's 5am brief and the bookkeeper CSV beside the page (`public/`), all written by `npm run web:data`; HQ's live read of the contract needs the API. A short guide on first visit says what the page is; `npm run host:build` prepares `dist/` for a public host (docs/HOSTING.md).

The video page, `?video=1` (`&view=3d`, `&from=<beat>`), plays the recorded run to the storyboard on a fixed clock with captions (`src/video.ts`, `src/VideoApp.tsx`; docs/RECORDING.md).
