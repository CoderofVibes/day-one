# The twelve-month world

Hollow Pine's year as data: a deterministic generator (`server/src/world/`) builds twelve months of plant history around the records the seed and the recorded run already hold, plus six simulated weeks after the run. Brief: `docs/UPGRADE_BRIEF.md` §2.1. Everything in it is fictional.

Regenerate with `npm run world` (no keys, no network). `npm run world -- --check` exits 1 when `data/world/hollow-pine.json` is stale. A test (`scripts/lib/world-run.test.ts`) regenerates it and compares the hash with the committed file.

## 1. Timeline

| Era | Dates | Source |
|---|---|---|
| `legacy` | 2025-12-01 to 2026-07-05 | generated: paper POs (`HP-PO-…`), Ray's Monday reviews, bills paid by mock ACH |
| `anchor` | 2026-07-06 to 2026-11-16 | the seed's own history (`server/src/seed/`) and the recorded run, unchanged |
| `simulated` | 2026-11-17 to 2026-12-28 | generated: Kevin's daily review, RFQs, the spend policy, escrow releases labeled "Simulated · would anchor" |

T0, Kevin's first day, is 2026-11-09 (the demo clock starts at 13:00Z). The recorded run's last event is ASC-261116-01's QC release on 2026-11-16 at 16:05, so the anchor window runs to that day.

## 2. Anchors

`data/world/hollow-pine.anchors.json` is the frozen copy of every Plant B record after a replay of the recorded run: lots, lot events, balances, POs and lines, receipts, batches and their draws, QC decisions, transfers, the production plan, RFQ-2611-01 and its quotes, Linda's approval and all 13 recorded transactions with their hashes and explorer links. `npm run world` reads them again from a replay and refuses to write when they differ from the frozen copy; `--freeze` rewrites the copy, only when an anchor changed on purpose.

The generator never writes into the anchor window and never reuses an anchor's id. Two seams join the eras:

- **Cutover count (Jul 5, 20:00, `HP-ADJ-0001`).** In its last six weeks the legacy era buys toward the stock the seed opens with on Jul 6. The count then closes every legacy lot; `counted` lists, per material, what the books held and what the anchored opening lots hold.
- **Kevin's start (Nov 17).** The simulated era opens with the ledger's balances at the end of the recorded run, releases the lot still in quarantine (MGS-261106-01), receives PO-1041 (funded in the run) and runs the anchored plan (BR-B-1047, BR-B-1048 and the rest to Dec 7) before its own batches.

## 3. The file

`data/world/hollow-pine.json`, about 1.8 MB. Quantities are base units (mg or each) and money is USDC base units (6 decimals), as in the ledger. Each record carries its `era`.

- `pos`, `receipts`, `lots`, `qc`, `batches`, `bills`, `payments`, `adjustments`, `rfqs`: ERP-shaped records (`server/src/world/types.ts`).
- `movements`: `[at, lot, kind, qtyBase, ref]`, every signed change to a lot. The sum per lot is its balance.
- `fgLots`, `shipments`, `invoices`, `fgMovements`, `customers`: finished goods and sales (`ar.ts`). The seed has no sales records, so these are generated for the whole year (legacy before T0, simulated from T0).
  Customers order their share of each week's demand; the dock ships what QC has released and records the rest as `shortUnits`. Most of the year's shortfall falls in October and November, where the anchored production runs under the winter demand curve.
- `escrow`: funded (+) and released (−) per PO; the anchor entries come from the recorded `submit_po` and `qc_release` transactions.
- `simulatedChain`: what the simulated era would anchor. Never a hash.
- `snapshots`: one value per day for `onHand` (per material), `openPoCount`, `openPoUsdc`, `apOpenUsdc`, `escrowUsdc`, `spendMtdUsdc`, `batchesMtd`.
- `monthly`: batches, units, demand, spend by category, freight, shipments and revenue per month.
- `indexes`: lot → batches, batch → finished-goods lot, finished-goods lot → shipments, material → lots, supplier → POs, PO → receipts and bills.
- `incidents`, `lookBack`: the named incidents with the records they touched, and what Kevin's look-back finds in the legacy months ("Before cutover · found by Kevin").

## 4. Incidents in the generated months

| Id | Date | What happens |
|---|---|---|
| INC-01 | 2026-01-15 | Northgate's truck runs ten days late; BR-B-0966 finds ascorbic acid short and waits two working days for a rush order from Ridgeway with $1,180 of freight |
| INC-03 | from 2026-04-13 | a Pacific Excipient invoice is keyed twice and paid twice; the ERP's duplicate rule (`erp/src/match.ts` `duplicateAmong`) finds it |
| INC-09 | 2026-05-01 to 07-31 | an $85 freight surcharge on every packaging delivery |
| INC-10 | Dec 24–25, 2025 and 2026 | the holiday shutdown: no batches, trucks or payments |

The ascorbic acid price hike and QuickChem's suspension sit inside the anchor window; the Riverside and Lakeview incidents and the mock recall notice are not built.

## 5. Changing the world

Every number comes from `server/src/world/config.ts`: the seed, the calendar, the demand profiles, the products' batch rates, the suppliers' lead times, on-time and QC rates, prices, the policy, the customers and the incidents. Randomness comes from `rng.ts`, one stream per stage and entity, so changing one parameter does not reshuffle another stage. `server/src/world/world.test.ts` holds the invariants for the committed seed and for another seed: mass balance per lot and per month, payments equal paid bills, PO totals, escrow never negative, three-way match on every simulated payment, Kevin's per-PO and monthly limits, no unqualified winner, the splice, seasonality and each incident.

Only Hollow Pine is generated. The engine takes a `PlantParams`; Riverside and Lakeview need their own parameters and anchors.
