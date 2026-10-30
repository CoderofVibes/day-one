# web

Kevin's web UI. Design: `docs/VISION.md` §6 (v2, Oct 30; the Oct 29 pass in `docs/UI_DESIGN.md` set the tokens and status colours it keeps), behaviour: `docs/SPEC.md`.

One shell, every page at `?page=<id>` (`src/shell.tsx`). The sidebar holds the plant picker and the pages in three groups; a phone folds it into a top bar with a menu. **Behind the curtain** (the trust marker) opens the auditor's rail beside any page. Staff pages show dollars, POs, approvals and people; wallets, keys, hashes and gas appear only behind the curtain (`src/run.test.ts` checks every staff line). Colours and type come from `src/tokens.css` and `src/v2.css`; charts are `src/charts.tsx` (inline SVG, a table behind every chart). Light and dark follow the system.

- **Plant** (for the plant in the picker): *Your integration*, the home page (`src/pages/Integration.tsx`): eight stages from meeting Kevin to day to day, each with how it is done today beside what Kevin does and the people who sign it off, progress read from the ledger. *Overview* (`src/pages/Overview.tsx`): number cards, the plant map, whoever is up next with their buttons, the run newest first, and three charts. *Plant map* (`src/pages/MapPage.tsx`): the map full width; a click on any area opens its sheet (equipment, lots, the latest events). *5am brief*, *Batch records*, *Inventory & forecast*, *Schedule* (`src/pages/Plant.tsx`), *Purchasing*, *Invoices*, *Spreadsheets* with the import wizard (`src/pages/Buying.tsx`).
- **Across Acme**: *Three plants* (stock by plant, the moves Kevin proposes, discrepancy reviews, the mass balance and each plant's next two weeks) and *ERP connection* (what crossed to the ERP, the cutover, the trial balance, the reconciliation; `src/pages/Acme.tsx`).
- **Acme HQ**: *Spending limits* (`src/panes.tsx`), *Suppliers*, *Group purchasing*, *Sealed bids*, *Reconciliation* (`src/pages/Hq.tsx`) and the *Bookkeeper export*.
- **Behind the curtain** (`src/Curtain.tsx`): every account in the run with what it signed and who paid its gas, the contract's ledger line, one card per transaction with the explorer link and the contract's words on a refusal, and the attestation of Kevin's model folded into two chips.

The plant map is flat or 3D (`src/twin`, `src/twin3d`; docs/TWIN3D.md): each plant is a site of buildings split into the ledger's twenty areas, lit as Day One reaches them, with zoom, fit and layer switches on the 3D stage.

One UI, two sources:

- **Live** (`npm run api`, then open http://localhost:8787/): the pages run the demo behind the HTTP API (`api/`). Each button sends one staff action and the page redraws from the state that comes back; every page reads the ledger and the contract when opened and whenever the run moves. Replay by default, so each click replays the recorded testnet transaction for that step; `npm run api:live` sends real ones. The API marks the page it serves with a meta tag; that is how the UI knows to run live.
- **Replay** (any static host, `npm run web:build` → `web/dist/`): the Overview steps through the recorded run (`src/data/demo-run.json`) with Back/Next, the slider, the arrow keys and Play; the other pages show the ledger as it stands at the end of the run, from snapshots `npm run web:data` writes (`src/data/plants.json`, `series.json`, `journey.json`, `pages.json`), loaded only when a page asks. `npm run host:build` prepares `dist/` for a public host (docs/HOSTING.md).

The button logic for *Up next* is pure data in `src/live.ts` (`src/live.test.ts`). The video page, `?video=1` (`&view=3d`, `&from=<beat>`), plays the recorded run to the storyboard on a fixed clock with captions (`src/video.ts`, `src/VideoApp.tsx`; docs/RECORDING.md). In development, `npm run web` proxies `/api` to the API.

Screenshots: `npm run web:shot -- <dir>` (the Overview, static; `PAGE=<id>` another page, `VIEW=3d` the twin, `FULL=1` the whole page), `URL=http://localhost:8787/ npm run web:shot -- <dir>` (live, clicks through the run; `PLANTS=1` opens Three plants), `npm run web:shot:3d -- <dir>` (the twin at the storyboard moments). The v2 screens are in `docs/v2/after/`.
