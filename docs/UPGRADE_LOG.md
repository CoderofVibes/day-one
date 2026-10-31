# Upgrade log

The running log of the "make it feel alive" upgrade (`docs/UPGRADE_BRIEF.md`). Newest milestone at the bottom; the recon (brief §6.2 M0, Oct 31) comes first because every later run builds on it.

## Cut (Tony, Oct 31, in Claude's chat)

Not built in this upgrade: the what-if planner (§3.4), the supplier disruption drill (§3.3), the dawn scene (§1.3; the 5am brief page stays as it is), and the receiving dock's mobile mode (§5.9 item 2). Linda's phone approval (§5.9 item 1) and Talk to Kevin (§3.2) stay in scope.

## M0 — recon (Oct 31, branch `upgrade/recon`)

### Repo map for the upgrade

**"Now" and the step player.** There is no simulation clock. "Now" is a step index into one recorded run.

| Piece | Where | What it does |
|---|---|---|
| Run shape | `web/src/run.ts` | `RunData` (steps, staff lines, chain lines, transactions), `transactionsThrough(data, step)`, who sees each step. Two sources: `web/src/data/demo-run.json` (static replay) or `GET /api/run` (`web/src/api.ts`) |
| Live buttons | `web/src/live.ts` | From the API's `next`: the buttons for whoever is up next and the request each sends. Pure data |
| Video clock | `web/src/video.ts`, `web/src/VideoApp.tsx`, `/?video=1` | 14 storyboard beats (`before` … `close`), each with recorded steps, seconds on screen, captions and `curtain`; a fixed 1000/60 ms per frame, so every take is identical |
| Program shell | `web/src/App.tsx` (1,151 lines) | Pages, plant picker, step state (`at`), the curtain rail (`<Curtain data upTo={at}>`), `PlantView` per page |
| API run machine | `api/src/session.ts` | One run behind the HTTP API: the phase machine from `agents/kevin`, advanced one staff action at a time; replay by default, `--live` on testnet. `api/src/server.ts` routes, `api/src/journey.ts` the seven integration stages, `api/src/review.ts` the morning review |
| Kevin's logic | `agents/kevin/src/` | Phase machine, forecast, extraction, attacks (`attacks.ts`, `credential-attacks.ts`). The brief never mentions this package |

**Data layer.**

- Seed: `server/src/seed/` (`reference.ts` plants, departments, staff, materials, vendors; `history.ts` the hand-written POs PO-1035…; `lots.ts`; `production.ts` about 120 days of batches for Hollow Pine and Riverside plus the plan to Dec 7; `batchRecords.ts`; `mailbox.ts` the review's ten messages; `quotes.ts`; `inventorySheet.ts`). `npm run seed` writes `data/dayone.db` (gitignored, not in a fresh worktree).
- Ledger: `server/src/ledger/schema.ts` (Drizzle, SQLite STRICT; 36 tables incl. `lots`, `lot_events`, `batch_inputs`/`batch_outputs`, `purchase_orders`, `chain_tx`, `anchors`, `attestations`), reads in `views.ts`, `series.ts`, `inventory.ts`, `books.ts`, `areas.ts`, `catalog.ts`; migrations in `server/src/ledger/migrations/`. Money is integer 6-decimal units (`server/src/money.ts`).
- Replay fixtures: `data/replay/` (`demo-chain.json`, `demo-llm.json`, `demo-salts.json`, `transcript.txt`; `group-chain.json`, `group-salts.json`, `group-transcript.txt`; `attacks-chain.json`, `attacks-llm.json`; `review-llm.json`; `inbox-llm.json`; `reconcile-chain.json`; `attestation.json`). Also `data/attacks/`, `data/sealed/`, `data/usdc/`, `data/quotes/`.
- Web data: `npm run web:data` (`scripts/web-data.ts`) replays the recorded run with no keys and writes `web/src/data/demo-run.json`, `plants.json`, `series.json`, `journey.json`, `pages.json`, `review.json` and `web/public/books.csv`; `npm run demo:group -- --web` writes `group-buy.json`. The pages read them through `web/src/reads.ts` and `web/src/series.ts` (live from the API when it runs).

**3D stack.** `web/src/twin3d/` (`Twin3D.tsx` 1,610 lines, `PlantView.tsx`, `buildings.ts`, `scene.ts`, `twin3d.css`): react-three-fiber 9.8.2, drei 10.7.9, three 0.186.1, React 19.3.1 (`web/package.json`). Camera framing per step (`StoryCamera`), record mode `?record=1`. The flat map `web/src/twin/PlantMap.tsx` (SVG, same `layout.ts`/`model.ts`) is now only the fallback when WebGL is missing (`PlantView.tsx`, since commit 2253edc).

**Styling.** `web/src/tokens.css` (about 110 custom properties, light and dark with `data-theme`), `web/src/v2.css` (v2 pages, frosted glass), `web/src/styles.css`, `web/src/video.css`; `web/src/shell.tsx` holds the sidebar nav (sections PLANT, ACROSS ACME, ACME HQ) and shared shell pieces.

**Tests.** Vitest 5 via `npm run check` (Biome, `tsc -b`, Vitest; `vitest.config.ts`, two workers). 577 tests in 74 files at the start of the upgrade; 579 in 75 files after this run. Cross-cutting tests live in `scripts/lib/*.test.ts`.

**Curtain panel.** `web/src/Curtain.tsx`. Fed by the `RunData` it is given (`transactions` through step `upTo`) and the attestation (`server/src/attestation/verify.ts` result: enclave checks plus one signed answer per recorded reply). It shows "0 transactions" on pages whose rail gets a run at a step before any transaction; the page decides `upTo`, the panel does not read the chain itself.

### Where every proof point lives

All six are frozen in `data/proof-points.json`, built by `scripts/lib/proofPoints.ts` and checked by `scripts/lib/proofPoints.test.ts`.

| Proof point | Source files | Ids |
|---|---|---|
| Attack suite, 15 of 15 | `scripts/attacks.ts` → `agents/kevin/src/attacks.ts` (1–7), `agents/kevin/src/credential-attacks.ts` with `data/attacks/credential-attacks.json` and `credentials-testnet.json` (8–11), `data/sealed/RFQ-2611-02.*` (12–14), `data/replay/review-llm.json` message M-03 from `server/src/seed/mailbox.ts` (15); chain in `data/replay/attacks-chain.json` | Lookalike vendor (PO-T9001), Inflated invoice, Fake payment-failed message, Hidden instructions in an invoice, Duplicate invoice (NG-INV-24190-R), Split purchase (PO-T9103/PO-T9104), Ghost vendor (PO-T9201), Revoked supplier (PO-T9301), Expired credential, Outside its categories (PO-T9303), Suspended for QC rejects, three sealed-bid attacks on RFQ-2611-02, New bank details by email |
| PO-1042 | `data/replay/demo-chain.json` (13 calls), `web/src/data/demo-run.json` (15 steps), `data/replay/transcript.txt` | refused tx `FQepeewB…`, approval `EW5A8qi3…` by `director.plant-b.acme-holdings.testnet` (Linda Park, `server/src/seed/reference.ts` STAFF), QC release `2zwgaHgW…`, lot ASC-261116-01 |
| PO-G-2001 | `data/replay/group-chain.json` (13 calls), `web/src/data/group-buy.json`, `data/replay/group-transcript.txt` | pool RFQ-G-2611, $9,490.00, two shares of $4,745.00 (Hollow Pine, Linda Park; Acme Riverside, Dana Whitfield), Lakeview declined; release `9XDEo3Dp…` |
| Reconciliation, 7 of 7 | `scripts/erp-reconcile.ts` → `server/src/erp-connector/reconcile.ts`, views in `data/replay/reconcile-chain.json`, ERP rebuilt by `scripts/lib/erp-demo-run.ts` | Inventory, Purchase orders, Payments, Escrow, Contract POs not in Day One, General ledger, Supplier standing — all MATCH |
| PO-1047 in USDC | `data/usdc/PO-1047-chain.json`, `data/usdc/transcript.txt` | 19.00 USDC on `spend-policy-usdc.acme-holdings.testnet` to `bayfront-labsupply.testnet`, five calls |
| Attestation | `data/replay/attestation.json`, receipts from `data/replay/*-llm.json`, `server/src/attestation/` | model `z-ai/glm-5.3-flash`, 15 enclave checks, 24 signed answers, all verified |

### The brief checked against the repo

**§0.1**

- Spend-policy contract, escrow released on QC, anchored hashes, sealed bids, group buys, TEE attestation: confirmed (`contracts/spend-policy/src/`, `data/replay/`).
- "NEP-393 soulbound supplier credentials": confirmed. `contracts/spend-policy/src/credentials.rs` says the contract is its own NEP-393 registry (`sbt_*` views, `nep393` events). The TypeScript and the UI never say "NEP-393"; they say "supplier credential".
- "Anthropic fallback": present in the bake-off and LLM layer (`server/src/llm/`); not part of any recorded proof point.
- Mock ERP "Acme Holdings ERP": confirmed (`web/src/pages/Acme.tsx`, `server/src/erp-connector/`).
- PO-1042 $5,150.00, 700 kg at $7.10 + freight, Northgate, $2,500 limit, Linda Park, "Reply YES 1042 or NO 1042", lot ASC-261116-01: confirmed (`web/src/data/demo-run.json` approvals and step 11; `data/replay/demo-chain.json`).
- Group buy PO-G-2001 $9,490 "paid across plants": confirmed, but two plants pay; Lakeview declined (`web/src/data/group-buy.json` `pool.declined: ["C"]`).
- Reconciliation 7 of 7, PO-1047 $19.00 USDC: confirmed (above).
- 577 tests: confirmed at the start of this run.

**§0.5**

| Brief | Repo |
|---|---|
| Hollow Pine Tablet Co., "Plant B · joining Acme" | confirmed: facility code `B`, account `plant-b.acme-holdings.testnet` (`server/src/seed/reference.ts`) |
| "4 of 9 departments online" | confirmed as a computed line (`web/src/twin3d/Twin3D.tsx`, `twin/PlantMap.tsx`: `online of departments.length`), not a stored string |
| Acme Riverside, "115.199 kg unaccounted" | confirmed: facility `A`; `unaccountedBase: 115199028` mg in `web/src/data/plants.json`, rendered by `web/src/panes.tsx` |
| Acme Lakeview | confirmed: facility `C` (`reference.ts`). The seed has no batch history for Lakeview; `production.ts` covers Hollow Pine and Riverside |
| Acme HQ ("budget"), Escrow "$612.00 held" | confirmed: $612.00 is PO-1041, funded and not yet delivered (reconciliation "Purchase orders" line) |
| Ray Delgado Purchaser, Linda Park Ops director, Marcy Allen Accounting, Priya Natarajan QC | confirmed (`reference.ts` STAFF). Also Tommy Reyes (receiving), Jordan Pike (HQ integration) and Dana Whitfield (Riverside director, in `group-buy.json`) |
| BR-B-1045 Vitamin C 500 mg Chewable, 726,400 units, 90.8% | confirmed (`server/src/seed/batchRecords.ts`, `demo-run.json`); 92 kg waste not checked by grep |
| BP-B-0509, BC-B-0309, BR-B-1046 | confirmed (`web/src/data/pages.json`, `series.json`; BR-B-1046 in the inbox scans) |
| Lots ASC-261116-01, BTL-260905-01, CAC-261014-01, CAP-260905-01, LCM-260907-01; pattern `MAT-YYMMDD-NN` | confirmed (`pages.json`, `plants.json`; pattern in `server/src/seed/lots.ts`) |
| Material codes ASC, CAC, BTL, CAP, LCM | confirmed (`reference.ts`) |
| POs PO-1035 … PO-1047, PO-G-2001 | confirmed (`server/src/seed/history.ts` from PO-1035; PO-1047 on the USDC deployment). Rehearsal and attack POs (PO-T…, PO-9043…) also exist on the contract |
| RFQ-2611-01, ADJ-515, IR-35, NG-INV-24190, "matrix rule 4" | confirmed (`pages.json`; ERP ids come from `server/src/erp-connector/`) |
| Testnet accounts | confirmed (`config/testnet-accounts.json`, `demo-run.json`). Also `qc.plant-b…` (QC release signer), `kevin.plant-a…`, `director.plant-a…`, `bayfront-labsupply.testnet` and `spend-policy-usdc…` |
| Budget 25,000.00 DTUSD | confirmed as the budget at the start of the recorded run (`demo-chain.json` `get_budget`). The contract holds $9,748.00 now (reconciliation "Escrow") |
| "Kevin may commit $60,000.00 a month", $2,500 per PO | confirmed (`demo-chain.json` `get_agent_policy`) |
| ERP stats: 34 POs and 34 receipts at cutover, 35 of 36 bills matched, 7 of 7 | 34/34 confirmed (`pages.json` `purchaseOrders: 34, receipts: 34`); "35 of 36" is computed in `web/src/pages/Acme.tsx` from the bills list; 7 of 7 confirmed |
| Nav items and sections | confirmed exactly (`web/src/shell.tsx`) |
| "Protected · Behind the curtain" toggle, persona "Ray Delgado · Purchaser · up next" | confirmed (`web/src/App.tsx`) |

**§5.6 "Today:"**

- Overview: "Batches, last 4 weeks", "Tablet yield, last 4 weeks" (the brief drops "last 4 weeks" from the second), "Below reorder point", "Spend this month": confirmed (`web/src/pages/Overview.tsx`). The Flat/3D toggle in the brief is gone: since 2253edc the 3D twin is the only map.
- Purchasing: "Received this month", per-PO limit, open POs, last quotes: confirmed (`web/src/pages/Buying.tsx`).
- ERP connection: "Brought over at cutover", "Bills matched", reconciliation: confirmed (`web/src/pages/Acme.tsx`).
- Three plants: "Three plants · one truth" (upper-cased by CSS), mass balance: confirmed (`web/src/panes.tsx`); the "Before you buy" moves come from the ledger through `web/src/data/plants.json`.
- Plant map: refused arc and "tx FQepeewB…": confirmed (refused `submit_po` in `demo-chain.json`). The page is `web/src/pages/MapPage.tsx`.
- Your integration: seven stages 0–7: confirmed (`api/src/journey.ts`, `web/src/pages/Integration.tsx`).
- Curtain "15 enclave checks ✓ 2 signed answers": the 15 is confirmed; the answer count is per run shown (the fixture holds 24 signed answers across the demo, inbox, review and attack recordings).

**Other checks.**

- History depth: more than four weeks. `server/src/seed/production.ts` holds about 120 days (from Jul 6) of batches for Hollow Pine and Riverside and a plan to Dec 7; `history.ts` adds the hand-written POs from Sep 14. The Overview cards show the last four weeks of it.
- Plant names: seed facility codes `A` Acme Riverside, `B` Hollow Pine Tablet Co., `C` Acme Lakeview; accounts `plant-a/-b/-c.acme-holdings.testnet`; the UI uses the names and "Plant B" for Hollow Pine.
- The twin is react-three-fiber: yes.
- Is `/?video=1` the brief's §4.10 tour? Partly. It is deterministic, recorded-only, captioned, beat-based and plays in 3D (`&view=3d`) on a fixed clock, with `&from=<beat>` to retake one beat. It has no explicit camera keyframes per beat (the twin frames each step itself), no sim-clock seek, no highlight list, no "T" key or skip control, and no e2e test at 10×. Extend `video.ts` rather than start a `tour.ts`.

### Already built

| Brief section | State |
|---|---|
| §1.1 Simulation clock | not started (step index plus the video's fixed frame clock) |
| §1.2 Activity feed | partly there: step cards in `web/src/feed.tsx`, not a persistent rail |
| §1.3 Dawn scene | partly there: the 5am brief page and `npm run brief`; no dawn lighting |
| §2.1 12-month generator | partly there: deterministic 120-day `production.ts`, hash-based yields; not 12 months, no Lakeview, no incidents |
| §2.2 Suppliers and scorecard | partly there: three ascorbic suppliers with quotes, on-chain credentials and standing (Suppliers page, `web/src/pages/Hq.tsx`); no scorecard |
| §2.3 Lot genealogy and recall | partly there: `lot_events`, `batch_inputs`, `batch_outputs` in the ledger; no recall view |
| §2.4 Money depth | partly there: bookkeeper export, books, price-drift alert (`server/src/ledger/books.ts`); no savings ledger or Money page |
| §3.1 Attack arena | partly there: 15 recorded attacks (`npm run test:attacks`), credential attacks listed on Suppliers; no judge-playable arena |
| §3.2 Talk to Kevin | partly there: Kevin as an MCP server (`npm run mcp`); no chat in the UI |
| §3.3 Disruption drill | not started |
| §3.4 What-if planner | not started |
| §4.1–4.9 3D twin | partly there: r3f twin with three sites, areas lit by department, flows, refused arc, curtain mode, story camera; no inspector, layers or full-screen page |
| §4.10 Scripted tour | partly there: `/?video=1` (above) |
| §4.11–4.16 Performance, a11y | partly there: `npm run web:shot:3d` reports draw calls (<60), fps and label overlaps |
| §5.2 Tokens | already there in substance (`tokens.css`, light/dark); the brief's token names differ |
| §5.3 Global header | not started (sidebar shell only) |
| §5.4 Left nav | already there (`shell.tsx`) |
| §5.5 Component kit | partly there: `NumberCard`, charts in `web/src/charts.tsx`, pills in `feed.tsx` |
| §5.6 Page redesigns | not started against the brief's "Becomes" |
| §5.7 Curtain never empty | not started (shows "No transactions yet") |
| §5.8 Inspector drawer | not started |
| §5.9 Mobile | partly there: phone layouts checked by `web:shot` at 390 px; Linda's phone mock in `feed.tsx` |
| §5.10–5.11 Motion, states | partly there (`Loading` in `pages/common.tsx`) |
| §5.12 Judge mode | not started |
| §6.3 Golden run | partly there: the recorded run itself, `npm run demo` transcript check, `/api/run/reset`; no Playwright e2e (screenshots use `tools/render`) |

### Which of §6.1 fits before the Nov 11 freeze

Pace: 208 commits from Oct 28 to the start of this run (100 on Oct 28, 86 on Oct 29, 21 on Oct 30). Most of `docs/PLAN.md`'s two-week spine landed in two days. Eleven days remain to Nov 11, with several runs in parallel. Fair sizing, in the brief's order:

1. **Foundation — fits.** The sim clock that absorbs the step player (M1) is the riskiest piece because every page reads `at`; keep the recorded run as the clock's golden window. The generator (M2–M3) is 2–3 days: extend `production.ts`, do not replace it, and keep `proofPoints.test.ts` green. Feed, header, curtain fix: a day together.
2. **Attack arena and recall — fits.** The arena replays the 15 recorded cases (recorded mode only); recall rides on the existing genealogy tables.
3. **3D hero — mostly fits.** Full-screen page, inspector, layers and the 3D curtain build on `Twin3D.tsx`. Cut the people layer and the Riverside/Lakeview interiors.
4. **Judge mode and tour — fits if built on `/?video=1`.** Cut "clean capture" to a query flag.
5. **Money and suppliers — Money fits (Tony wants it), scorecards fit in a small form; full page redesigns do not.** Redesign Overview, Purchasing and the twin page; leave the rest on the new tokens and header.
6. **Rest — cut.** What-if, Talk to Kevin in the UI, disruption drill, dawn scene, dock mode. Kevin's MCP server already answers questions; say so in the README instead.

The golden-run e2e test (§6.3) needs a browser runner; `tools/render` already drives Edge headless, so use it rather than adding Playwright.
