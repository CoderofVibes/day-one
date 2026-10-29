> **Origin.** Received from Muse's Plan v2 package on 2026-10-25 and folded into `PLAN.md` the same day (decision #24). Muse's package used its own fictional names and demo numbers; this repo's `FICTIONAL_DATA.md` and `DATA_MODEL.md` are canonical (`docs/OPEN_QUESTIONS.md` #17, answered Oct 25), so the stories below were rewritten with the repo's names on Oct 29. All three features are built; the code cites the section numbers here (`server/src/import/`, `server/src/ledger/books.ts`, `agents/kevin/src/transferSuggestions.ts`), and `PLAN.md` (Nov 8–11) records what landed.

# FEATURES V2 — promoted features (approved by Tony, Oct 23, 2026)

Plan v2 promotes three features from stretch into the tiered plan, each behind a build
gate in `PLAN.md`. They exist for one reason: a truly high-functioning Day One has to
meet an old-school plant where it actually lives — in spreadsheets, in the bookkeeper's
month-end, and in phone calls between plants. All data is fictional
(`FICTIONAL_DATA.md`); all language is plant language, zero crypto terms on staff screens.

## 1. Spreadsheet import wizard

**Gate:** ledger core + seed/opening-inventory path green (Nov 2–3). **Slot:** Nov 8
[IF] pipeline, Nov 9 [IF] UI polish only if the twin checkpoint passes.

**User story.** Ray Delgado has just been told Hollow Pine Tablet Co. is now part of
Acme Holdings. Nobody is going to re-key twelve years of inventory into a new system —
the plant's entire stock is one terrifying spreadsheet (`FICTIONAL_DATA.md` §12) that
Ray has maintained by hand. Ray uploads it, Kevin reads it the way a careful new hire
would, and twenty minutes of clicking "yes, that's the same thing" replaces weeks of
manual re-entry.

**Flow.**
1. Ray uploads the CSV/XLSX on the inventory screen ("Bring in a spreadsheet").
2. Kevin proposes a column mapping (material, quantity, unit, lot, expiry, location)
   from header names and cell patterns; Ray can correct any mapping.
3. Kevin normalizes every row to the master material list (§4) and milligrams, and
   flags — never silently fixes — each problem row: the same lot under two names,
   a short name for a material, mixed units, a totals row sitting in the data,
   missing lot numbers, expired lots, a quantity typed as text, and any material
   that isn't on the master list.
4. Ray works the flag queue: merge duplicates, confirm unit conversions, type the
   weighed quantity, send the unknown material to review. Nothing
   unflagged-and-unconfirmed posts.
5. On Ray's final confirm, the cleaned rows post through the **same
   opening-inventory path the seed script uses**, so the imported state and the
   seeded state are one code path, not two.

**Inputs / fixtures needed.** The §12 fixture workbook (defined mess patterns only),
the master material list (§4), the unit conversion table (kg/g/lb), and the expected
clean output: importing the fixture must reproduce the opening inventory §12 lists,
which a test diffs against to the milligram. The second tab, "Sales by customer"
(§14, OPEN_QUESTIONS #28), turns customer SKUs into tablets and kilograms and flags the
retyped Summary figure.

**Acceptance criteria.**
- (a) Importing the §12 fixture produces exactly the expected opening inventory —
  every material's milligram total matches the hand-computed truth in §12.
- (b) Every defined mess pattern (F1–F9) produces its flag; no flagged row posts
  without Ray's explicit resolution.
- (c) A row Kevin cannot map or convert stays in review — it is never guessed,
  dropped, or merged silently.
- (d) Re-importing the same file does not double-post (import is idempotent per
  file hash + plant).
- (e) The whole import runs offline from the LLM: deterministic parsing/mapping
  only, so it works on demo day regardless of model availability.

**The 20-second demo moment.** Ray drops in the file named
`INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx`; Kevin answers: "Found 19 rows. 9 need
your eyes: 1 looks like the same ascorbic acid lot entered twice, 1 uses a short name
for ascorbic acid, 2 are in pounds, 1 lot expired in March, 1 quantity isn't a number,
1 has no lot number, 1 material (Xanthan Gum) isn't on your material list, and the
last row is a total." Ray clicks through; inventory lights up.

**Out of scope.** Arbitrary spreadsheet formats beyond the defined fixture patterns;
formula evaluation (values only); importing purchasing/financial history (inventory
quantities and the sales tab only); any LLM-based guessing of ambiguous rows;
feeding the sales history into the forecast.

## 2. Bookkeeper pack

**Gate:** settlement working end-to-end on testnet (Nov 6–7). **Slot:** Nov 10 [IF].

**User story.** Marcy Allen does Hollow Pine's books the way she has for a decade
and closes the month in QuickBooks. She does not care what a blockchain is; she
cares that every dollar Kevin spent can be matched to a PO, an invoice, and a
delivery — and that nobody pays the same invoice twice. Kevin hands her exactly
that, in the file format she already imports.

**Flow.**
1. Marcy opens the accounting view (read-only, already in the Nov 8 UI slot).
2. "Export for QuickBooks" downloads a CSV of settled POs: PO number, vendor, date,
   material, quantity, unit price, total, delivery/QC confirmation dates, and the
   record-anchor reference for the audit trail.
3. Two alert queries run over the same data and surface as flags in the view:
   **duplicate invoice** (same vendor + invoice number, or same vendor + amount +
   date window already settled) and **price drift** (a PO's unit price differs from
   that vendor's trailing average for the material by more than a set percentage).
4. Marcy can dismiss an alert with a note; dismissals are kept in the record trail,
   not deleted.

**Inputs / fixtures needed.** Settled PO data from the core loop (PO-1042 is the
hero row); seeded history with one deliberate duplicate invoice (OFH-3317-R, §13)
and one deliberate price-drift case (PO-1040's magnesium stearate at $9.35/kg
against $8.20/kg on PO-1035) planted in the fixture POs, so both alerts have
something true to find on demo day.

**Where each half lives (OPEN_QUESTIONS #32, #33).** The export and the price-drift
alert are pure reads over Day One's own POs, receipts and anchors (`npm run books`,
`GET /api/books`). Invoices are the acquirer's ERP's records, so the duplicate-invoice
alert is the ERP's three-way match and dismissals are kept on the ERP's bills
(`docs/ERP.md` §3.4); Day One never holds a second copy of an invoice.

**Acceptance criteria.**
- (a) The CSV imports into a QuickBooks-shaped consumer without manual cleanup:
  stable column order, plain dates, no crypto terms, totals reconcile to the sum
  of settled POs in the ledger — to the cent.
- (b) The seeded duplicate invoice is flagged before it can be paid a second time;
  the seeded price drift is flagged with both prices shown.
- (c) Unsettled (escrowed, unreleased, cancelled, refunded) POs never appear in
  the export as paid; their state is a separate clearly labeled section or absent.
- (d) Export + alerts are pure queries over existing ledger/settlement data —
  no new writes, no new chain calls.

**The 20-second demo moment.** Optional insert shot, not a storyboard dependency:
Marcy clicks export, and Kevin's note at the top reads: "Pacific Excipient Co. billed
magnesium stearate at $9.35/kg on PO-1040, up 14.0% on its $8.20/kg trailing price
(PO-1035). It was a real, received order, so it is in the export with both prices;
worth a call before the next one."

**Out of scope.** A live QuickBooks API integration or OAuth; tax handling; paying
anything outside the existing escrow flow; general accounts-payable automation
(bills that never went through Kevin stay in Marcy's old process).

## 3. Cross-plant transfer suggestions

**Gate:** forecast job working (Nov 7). **Slots:** Nov 10 [IF] forecast-side
proposals, Nov 11 [IF] UI card.

**User story.** Ray is about to reorder 150 cc bottles for Hollow Pine. Twenty miles
of paperwork away, Acme Lakeview is sitting on more bottles than it will use, and
Acme Riverside has spare stock of other materials too. Today, nobody knows — each
plant sees only its own shelves, so the company buys what it already owns. Kevin
sees all three plants, so he proposes the transfer first and the purchase second.

**Flow.**
1. Kevin's forecast run computes, per material and plant: projected need (usage +
   waste factor, as in the core loop) and projected surplus (usable stock above the
   plant's own need and reorder point, expiry-aware).
2. Where one plant's surplus covers another's shortfall, Kevin emits a transfer
   proposal: material, quantity, from → to, the purchase it avoids, and the lot it
   would move (earliest-expiring surplus lot first), valued at the last price paid.
3. Proposals appear in the 5am brief and as cards on the three-plant view ("Before
   you buy"). Ray (or Linda, per plant policy) approves or dismisses. Dismissed
   proposals don't reappear for the same shortfall.
4. An approved proposal writes a normal transfer movement pair through the
   existing ledger API (out of the surplus plant, into the short plant on
   receipt) — the same machinery, and the same discrepancy checks, as a manual
   transfer. Only then does the forecast re-run and shrink (or drop) the draft PO.

**Inputs / fixtures needed.** The three-plant seed (§1, §6) extended so at least
one clean surplus/shortfall pair exists at seed time, distinct from the seeded
ASC-261009-01 transfer discrepancy (§8) — the discrepancy is a bookkeeping
error Kevin flags; a transfer suggestion is a deliberate move Kevin proposes.

**Acceptance criteria.**
- (a) At seed state, Kevin produces at least one correct transfer proposal with
  the avoided-purchase math shown, and produces none for materials where the
  "surplus" is actually the plant's own reorder point or an expired/quarantined lot.
- (b) Approving a proposal creates exactly the transfer movement pair and the
  receiving plant's projected shortfall drops accordingly; no PO is drafted for
  the covered quantity.
- (c) A proposal never suggests moving a lot in `quarantine`, an expired lot, or
  more than the surplus above the sending plant's reorder point.
- (d) The existing discrepancy detector stays silent about an approved transfer
  once both sides post, and still fires on the seeded ASC-261009-01 discrepancy.

**The 20-second demo moment.** The brief, under the bottles Hollow Pine needs:
"Before you buy: Acme Lakeview has 96,000 of 150 cc HDPE bottle (BTL) above its own
need and reorder point. Moving 16,000 (BTL-260905-01) to Hollow Pine Tablet Co.
keeps it at its reorder point instead of ordering 100,000. That is about $336.00
of stock at the last price paid." Ray clicks Approve the move.

**Out of scope.** Automatic transfers without human approval; transfers that
settle money between plants (internal moves are ledger-only, no escrow);
multi-hop routing; optimizing freight/shipping (no carrier data exists in the
fictional world); the move drawn on the plant map (the map draws the recorded run);
group purchasing, which is its own feature (`docs/GROUP_BUY.md`).

## Stretch after the promoted three (one-line each; status in `PLAN.md`)

- **Kevin's 5am brief** — one printable page from Kevin's own data: lot movements
  since the last working day, lots waiting in quarantine, POs awaiting approval,
  what to buy or move first. Listed in `PROJECT_BRIEF.md` §5; built Oct 29 (`npm run brief`).
  Draft supplier replies are not built: Kevin has no outbound messages.
- **Receiving dock mode + printable lot labels** — a big-button, glove-friendly
  receiving screen for Tommy Reyes (packing-slip photo, lot, quantity, "received"
  — nothing else on screen), and lot labels that print from the lot record with
  material, lot number, quantity, and state. It closes the "paper in, paper out"
  loop at the dock door, where the plant's real system has always been a
  clipboard. No barcode-scanning hardware dependency: the label carries a
  human-readable lot code first. Not built.
- **Vendor onboarding checklist** — per-vendor qualification tracker: which
  documents HQ requires (insurance certificate, W-9, quality agreement), what's
  on file, what's missing, and who is chasing it. It turns "QuickChem Direct is
  not qualified" from a hard-coded fact into a visible reason — Kevin refuses
  them *because* their quality agreement was never signed — and gives Delta D
  Nutrition (conditional, audit open) a path to qualified that Ray can actually
  work. Partly covered by the on-chain supplier credentials HQ issues, revokes and
  lets lapse (`docs/CONTRACTS.md` §3.1); the document checklist itself is not built.
