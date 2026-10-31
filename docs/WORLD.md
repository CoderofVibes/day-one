# The twelve-month world

The three plants' year as data: a deterministic generator (`server/src/world/`) builds twelve months of plant history around the records the seed and the recorded run already hold, plus six simulated weeks after the run, for Hollow Pine (B), Acme Riverside (A) and Acme Lakeview (C). Brief: `docs/UPGRADE_BRIEF.md` §2.1. Everything in it is fictional.

Regenerate with `npm run world` (no keys, no network). `npm run world -- --check` exits 1 when any of `data/world/hollow-pine.json`, `riverside.json` or `lakeview.json` is stale. A test (`scripts/lib/world-run.test.ts`) regenerates them and compares the hashes with the committed files.

## 1. Timeline

| Era | Dates | Source |
|---|---|---|
| `legacy` | 2025-12-01 to 2026-07-05 | generated: paper POs (`HP-PO-…`), Ray's Monday reviews, bills paid by mock ACH |
| `anchor` | 2026-07-06 to 2026-11-16 | the seed's own history (`server/src/seed/`) and the recorded run, unchanged |
| `simulated` | 2026-11-17 to 2026-12-28 | generated: Kevin's daily review, RFQs, the spend policy, escrow releases labeled "Simulated · would anchor" |

T0, Kevin's first day, is 2026-11-09 (the demo clock starts at 13:00Z). The recorded run's last event is ASC-261116-01's QC release on 2026-11-16 at 16:05, so the anchor window runs to that day.

Riverside's anchor window opens on Jul 6 too (the seed's `production.ts` history). Lakeview's opens on Sep 5, the day its packaging stock appears in the seed (`seed/lots.ts`), so its legacy era runs to Sep 4. Riverside and Lakeview were on Acme's systems before Day One, so their legacy POs are "Acme ERP approval" rather than Ray's paper book.

## 2. Anchors

`data/world/hollow-pine.anchors.json` is the frozen copy of every Plant B record after a replay of the recorded run: lots, lot events, balances, POs and lines, receipts, batches and their draws, QC decisions, transfers, the production plan, RFQ-2611-01 and its quotes, Linda's approval and all 13 recorded transactions with their hashes and explorer links. `riverside.anchors.json` and `lakeview.anchors.json` hold the same for Plants A and C (Riverside's 33 batches, BR-A-2201 and BR-A-2204 among them; Lakeview's ten packaging lots, PO-1037 and its four transfers). `npm run world` reads them again from a replay and refuses to write when any differs from its frozen copy; `--freeze` rewrites the copies, only when an anchor changed on purpose.

The generator never writes into the anchor window and never reuses an anchor's id. Two seams join the eras:

- **Cutover count (Jul 5, 20:00, `HP-ADJ-0001`).** In its last six weeks the legacy era buys toward the stock the seed opens with on Jul 6. The count then closes every legacy lot; `counted` lists, per material, what the books held and what the anchored opening lots hold.
- **Kevin's start (Nov 17).** The simulated era opens with the ledger's balances at the end of the recorded run, releases the lot still in quarantine (MGS-261106-01), receives PO-1041 (funded in the run) and runs the anchored plan (BR-B-1047, BR-B-1048 and the rest to Dec 7) before its own batches.

## 3. The file

`data/world/hollow-pine.json` (about 1.8 MB), `riverside.json` (1.2 MB) and `lakeview.json` (0.3 MB). Quantities are base units (mg or each) and money is USDC base units (6 decimals), as in the ledger. Each record carries its `era`.

- `pos`, `receipts`, `lots`, `qc`, `batches`, `bills`, `payments`, `adjustments`, `rfqs`: ERP-shaped records (`server/src/world/types.ts`).
- `movements`: `[at, lot, kind, qtyBase, ref]`, every signed change to a lot. The sum per lot is its balance.
- `fgLots`, `shipments`, `invoices`, `fgMovements`, `customers`: finished goods and sales (`ar.ts`). The seed has no sales records, so these are generated for the whole year (legacy before T0, simulated from T0).
  Customers order their share of each week's demand; the dock ships what QC has released and records the rest as `shortUnits`. Most of the year's shortfall falls in October and November, where the anchored production runs under the winter demand curve.
- `escrow`: funded (+) and released (−) per PO; the anchor entries come from the recorded `submit_po` and `qc_release` transactions.
- `transfers`: stock sent to a sister plant, one line per lot (`TR-C-B-260112`, `TR-B-A-260223`); `pullShort`: packaging Lakeview could not stage in full (empty today). A lot that arrives on a transfer is listed at the receiving plant too, with its `transferNo`.
- `simulatedChain`: what the simulated era would anchor. Never a hash.
- `snapshots`: one value per day for `onHand` (per material), `openPoCount`, `openPoUsdc`, `apOpenUsdc`, `escrowUsdc`, `spendMtdUsdc`, `batchesMtd`.
- `monthly`: batches, units, demand, spend by category, freight, shipments and revenue per month.
- `indexes`: lot → batches, batch → finished-goods lot, finished-goods lot → shipments, material → lots, supplier → POs, PO → receipts and bills.
- `incidents`, `lookBack`: the named incidents with the records they touched, and what Kevin's look-back finds in the legacy months ("Before cutover · found by Kevin").

## 4. Incidents in the generated months

| Id | Date | What happens |
|---|---|---|
| INC-01 | 2026-01-15 | Northgate's truck runs ten days late; a Vitamin C batch at Hollow Pine finds ascorbic acid short and waits two working days for a rush order from Ridgeway with $1,180 of freight |
| INC-02 | ordered Feb 16 to Mar 20 | Sierra Mineral Supply's calcium carbonate PO arrives nine days past its promised day, in March; the batches that waited for anything on it are listed |
| INC-03 | from 2026-04-13 | a Pacific Excipient invoice is keyed twice and paid twice; the ERP's duplicate rule (`erp/src/match.ts` `duplicateAmong`) finds it |
| INC-04 | from 2026-06-01 | the first Fennimore Polyols sorbitol lot received fails moisture, goes back and is replaced |
| INC-05 | Jun 8 and Jun 22 | Hollow Pine trials QuickChem Direct at $5.90/kg; both lots fail assay (two QC rejects in a row), nothing is billed and the POs are cancelled. This is why QuickChem holds no credential and RFQ-2611-01 excludes it as "vendor not qualified". The brief dated it Aug–Sep, inside the anchor window, where the generator writes nothing |
| INC-06 | 2026-08-24 | ascorbic acid moves from $6.40 to $7.10/kg at Northgate and Ridgeway; anchored, so the incident names PO-1042 and RFQ-2611-01 and changes nothing |
| INC-07 | Oct 13–27 (Riverside) | the seed's 115.199 kg mass-balance gap on BR-A-2201 and BR-A-2204, anchored as it is |
| INC-08 | Feb 2, transfer Feb 23 | Hollow Pine buys 2,500 kg of ascorbic acid from Ridgeway in one order and sends 1,000 kg of the lot to Riverside (`TR-B-A-260223`); the lot goes into Vitamin C batches at both plants, the most batches of any bought-in ascorbic acid lot, so the recall drill picks it (never ASC-261116-01) |
| INC-09 | 2026-05-01 to 07-31 | an $85 freight surcharge on every packaging delivery, at all three plants |
| INC-10 | Dec 24–25, 2025 and 2026 | the holiday shutdown: no batches, trucks or payments |

## 5. Changing the world

Every number comes from `server/src/world/config.ts`: the seed, the calendar, the demand profiles, the products' batch rates, the suppliers' lead times, on-time and QC rates, prices, the policy, the customers and the incidents. Randomness comes from `rng.ts`, one stream per stage and entity, so changing one parameter does not reshuffle another stage. `server/src/world/world.test.ts` holds the invariants for the committed seed and for another seed: mass balance per lot and per month, payments equal paid bills, PO totals, escrow never negative, three-way match on every simulated payment, Kevin's per-PO and monthly limits, no unqualified winner, the splice, seasonality and each incident.

## 6. The three plants

| Plant | Parameters (`config.ts`) | What it does in the world |
|---|---|---|
| Hollow Pine (B) | `HOLLOW_PINE` | seven products on the tablet line, capsule room and powder room; paper POs `HP-PO-…`; Kevin from T0 (`PO-1048`+) |
| Acme Riverside (A) | `RIVERSIDE` | magnesium weekly, D3 and B-complex every two weeks, Cal-Mag from Oct 1 (`startsOn`), Vitamin C only in the late-winter peak on Hollow Pine's Ridgeway lot; Acme ERP POs `RV-PO-…`; Kevin from Nov 17 (`PO-R-1001`+, Dana Whitfield approves) |
| Acme Lakeview (C) | `LAKEVIEW` | makes nothing: buys bottles, caps, desiccants, tubes, labels and shippers and stages them for every Vitamin C, Cal-Mag and electrolyte batch at A and B two working days ahead (`packs`), as transfers; Acme ERP POs `LV-PO-…`; Kevin from Nov 17 (`PO-L-1001`+, packaging only, Omar Haddad approves) |

`generateWorlds` runs them in that order: lot codes and supplier invoice numbers are shared, so none repeats across plants; Riverside receives what Hollow Pine sent it; Lakeview's transfers are computed from the other two worlds' batches. Those products' packaging is not drawn at A or B (`ROUTES` gives them no `pack`), so the stock is counted once.

## 7. Where the worlds show

`npm run web:data` reads the committed worlds (`server/src/world/files.ts`) and writes three things beside the recorded run's snapshot:

- **The clock's events** (`server/src/world/events.ts` → `web/src/data/world/`): batches, receipts, QC results, payments, shipments to customers, Lakeview's packaging transfers and the named incidents of all three plants, one file a month (about 41 KB gzipped for the year) and a 3 KB index. The anchor eras and the recorded run's window (Nov 9–16) are left out: the clock already carries the seed's history and the run's steps there, so the run replays exactly. `web/src/worldEvents.ts` widens the clock to the year from the index and loads the month on screen first, then the rest (`Clock.addEvents`); a seek folds at most one day from the daily snapshots. The activity feed has lines for the new kinds (`web/src/activity.ts`).
- **The lot genealogy** (`server/src/world/genealogy.ts`): the worlds' lots, batches, draws, finished-goods lots and shipments, merged with the ledger's rows (the ledger's win) and cut at the snapshot's clock, so the recall drill traces INC-08's lot through Vitamin C batches at both plants to customers. `GET /api/genealogy` does the same at the API's clock.
- **Supplier scorecards** (`server/src/world/scorecard.ts` → `web/src/data/suppliers.json`, and `GET /api/suppliers/scorecards`): per supplier and per supplier and material, over the trailing 90 days and the year to the end of the recorded run (Nov 16): on-time rate, average days late (over the late receipts), QC pass rate, QC rejects in a row, price competitiveness (best qualified supplier's average unit price / this one's), invoice accuracy (matched bills / bills), responsiveness (quotes returned / RFQs invited), and a 0–100 score, `100 × Σ weight·component / Σ weights scored` with the weights in `config.ts` `SCORECARD` (35 QC, 30 on-time, 15 invoices, 10 price, 10 responsiveness); a component with no records drops out. Two QC rejects in a row override the score: a qualified supplier shows suspended; QuickChem, never qualified, stays unqualified with the override named. `priceHistory` is the average PO unit price per supplier, material and month. Every invited supplier on file quotes in the generated RFQs, so responsiveness is 1 wherever it is scored. The Suppliers page reads `view` in the same file (`server/src/world/supplierView.ts`): the cards on a weekly grid through Nov 16, so the leaderboard scores at the clock's date (the last grid date on or before it; two QC rejects in a row blank the score), and each supplier's receipts, POs, lots, RFQs with landed costs, monthly prices and incidents, which the page cuts at the clock; `recorded` adds RFQ-2611-01 from the recorded run and the credential transactions from `data/attacks/credentials-testnet.json` and `data/quotes/`.
