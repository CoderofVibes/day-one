# Money

The Money page (`?page=money`) and the header's "$X saved · N×" counter. Brief: `docs/UPGRADE_BRIEF.md` §2.4. Every company, person and number is fictional.

## Where each figure comes from

All formulas are in `server/src/finance/money.ts`, pure and per plant, with hand-computed tests in `money.test.ts`. The browser imports the same file, so the page and the tests compute the same way. Each function takes one plant's book (or several, summed, for "All") and a date or window from the sim clock: the trailing twelve months ending at the clock, never before the world's first day.

| Figure | Formula |
|---|---|
| Cash flow | out = vendor payments by paid date + modeled overhead (prorated for part months); in = customer receipts by paid date; net and running total |
| Cash on hand | modeled opening cash + every receipt − every payment − overhead to the clock |
| AP aging | bills dated by the clock and unpaid, by days past due (Current, 1–30, 31–60, 61–90, 90+); a held duplicate is not payable and sits outside AP |
| Inventory value | Σ on-hand qty × lot cost (the PO line price plus the PO's freight by line value; lots without a PO at the last price paid); WIP at draw cost; finished goods at their batch's cost per unit |
| Turns | material COGS over the window (draw cost of the batches made in it, waste included) ÷ the average materials value over weekly samples, annualized |
| Days on hand | materials value ÷ (90-day material COGS ÷ 90) |
| Dead stock | stock received more than 120 days ago of a material with no draw in 120 days |
| Escrow | funded − released per PO; recorded up to Nov 16 (the testnet contract's figures: $612.00 before PO-1042, $5,762.00 at the end of Nov 9), simulated after |
| Spend vs budget | PO line value by material category (freight its own row) and order month, ÷ the monthly budget |
| Headroom | Kevin's POs this month against his $60,000.00 monthly limit; the PO-size histogram marks the $2,500.00 per-PO limit |

## The books

`server/src/finance/book.ts` turns each world in `data/world/` (`docs/WORLD.md`) into a book. The world carries no bills for the anchor window (Jul 6 – Nov 16), so the book adds them by the ERP's own rules: the bookkeeper pack's bills and checks as written (`erp/src/seed/history.ts`, with OFH-3317-R held as a duplicate), the earlier bills one day after receipt paid by check thirty days later (as `server/src/erp-connector/rebuild.ts` builds them), and NG-INV-24190 for PO-1042, paid by the recorded escrow release. A plant without a world shows its savings and says its history is missing.

## Savings ledger

`server/src/finance/savings.ts`. Each entry has a type, amount, status (identified or realized), dates, evidence ids, the formula and the arithmetic. A test proves no evidence id backs two entries.

- **Group buy:** (best standalone quote, landed, for the plant's quantity) − the plant's share of PO-G-2001. Hollow Pine: RFQ-2611-01's $5,150.00 − $4,745.00 = $405.00, realized when the pooled delivery is released. Riverside has no standalone quote on record, so its share is left out and listed as not counted.
- **Inter-plant transfer:** Kevin's proposed moves, (qty × last price paid) − an assumed $25.00 of freight; identified until a move is approved.
- **Sealed bid:** (median of the other qualified quotes − the winner), each landed; RFQ-2611-02: $5,310.00 − $5,150.00 = $160.00, identified because no PO was placed from the round.
- **Duplicate invoice:** OFH-3317-R, held at cutover, realized ($1,150.00); the legacy PEC duplicate paid twice is identified · recoverable.
- **Price drift:** (billed − trailing price) × qty; PEC-55388 ($57.50) and the look-back's legacy drift, identified.
- **Over-consumption:** excess over the formula × weighted lot cost, from the look-back, identified.
- **Rush freight avoided:** not counted: the simulated continuation has its own rush order (PO-1089).
- **Payments protected:** what each refused attack tried to move, shown apart; never a saving.

## Kevin's cost and the counter

Cost = an assumed $450.00 a month per plant Kevin runs at (fictional), by the day from T0 (Nov 9) + each recorded answer's tokens at an assumed rate (NEAR AI Cloud's price is not recorded in the repo) + testnet gas ≈ $0. Value = realized savings since T0; identified only with "Including identified". The assumptions live in `server/src/finance/config.ts`.

## Data

`npm run web:data` writes `web/src/data/money.json` (the books, loaded by the page alone) and `web/src/data/savings.json` (the ledger, payments protected, the answers' token counts and the assumptions, read by the header everywhere). The live UI reads `GET /api/money`.
