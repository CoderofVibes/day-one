> **Received from Muse's Plan v2 package on 2026-10-25.** This file uses Muse's fictional names and demo numbers, which differ from the ones in this repo (see `docs/OPEN_QUESTIONS.md` #17). The repo's `FICTIONAL_DATA.md` and `DATA_MODEL.md` win until Tony decides otherwise.

# FEATURES V2 — promoted features (approved by Tony, Oct 23, 2026)

Plan v2 promotes three features from stretch into the tiered plan, each behind a build
gate in `PLAN.md`. They exist for one reason: a truly high-functioning Day One has to
meet an old-school plant where it actually lives — in spreadsheets, in the bookkeeper's
month-end, and in phone calls between plants. All data is fictional
(`FICTIONAL_DATA.md`); all language is plant language, zero crypto terms on staff screens.

## 1. Spreadsheet import wizard

**Gate:** ledger core + seed/opening-inventory path green (Nov 2–3). **Slot:** Nov 8
[IF] pipeline, Nov 9 [IF] UI polish only if the twin checkpoint passes.

**User story.** Sam Whitaker has just been told Juniper Ridge is now part of Acme
Holdings. Nobody is going to re-key twelve years of inventory into a new system — the
plant's entire stock history is one terrifying spreadsheet
(`FICTIONAL_DATA.md` §8) that Sam has maintained by hand. Sam uploads it, Kevin reads
it the way a careful new hire would, and twenty minutes of clicking "yes, that's the
same thing" replaces weeks of manual re-entry.

**Flow.**
1. Sam uploads the CSV/XLSX on the inventory screen ("Bring in a spreadsheet").
2. Kevin proposes a column mapping (material, quantity, unit, lot, expiry, location)
   from header names and cell patterns; Sam can correct any mapping.
3. Kevin normalizes every row to the master material list and grams, and flags —
   never silently fixes — each problem row: duplicate SKUs under different names,
   mixed units, a totals row sitting in the data, missing lot numbers, expired lots,
   and any material that isn't on the master list.
4. Sam works the flag queue: merge duplicates, confirm unit conversions, send the
   unknown material to `needs_review`. Nothing unflagged-and-unconfirmed posts.
5. On Sam's final confirm, the cleaned rows post through the **same
   opening-inventory path the seed script uses**, so the imported state and the
   seeded state are one code path, not two.

**Inputs / fixtures needed.** The §8 fixture spreadsheet (defined mess patterns only),
the master material list (§2), the unit conversion table (kg/g/lb), and the expected
clean output: importing the fixture must reproduce a known opening-inventory state
that a test can diff against.

**Acceptance criteria.**
- (a) Importing the §8 fixture produces exactly the expected opening inventory —
  every material's gram total matches the hand-computed truth in the fixture spec.
- (b) Every defined mess pattern produces its flag; no flagged row posts without
  Sam's explicit resolution.
- (c) A row Kevin cannot map or convert routes to `needs_review` — it is never
  guessed, dropped, or merged silently.
- (d) Re-importing the same file does not double-post (import is idempotent per
  file hash + plant).
- (e) The whole import runs offline from the LLM: deterministic parsing/mapping
  only, so it works on demo day regardless of model availability.

**The 20-second demo moment.** Sam drops in the file named
`INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx`; Kevin answers: "Found 214 rows. 8 need
your eyes: 3 are the same Vitamin C under different names, 2 are in pounds, 1 is a
totals row, 1 lot expired in March, and 1 thing called 'Xanthan Gum' isn't on your
material list." Sam clicks through; inventory lights up.

**Out of scope.** Arbitrary spreadsheet formats beyond the defined fixture patterns;
formulas evaluation (values only); multi-sheet workbooks beyond the first data sheet;
importing purchasing/financial history (inventory quantities only); any LLM-based
guessing of ambiguous rows.

## 2. Bookkeeper pack

**Gate:** settlement working end-to-end on testnet (Nov 6–7). **Slot:** Nov 10 [IF].

**User story.** Ruth Alvarez does Juniper Ridge's books the way she has for a decade
and closes the month in QuickBooks. She does not care what a blockchain is; she
cares that every dollar Kevin spent can be matched to a PO, an invoice, and a
delivery — and that nobody pays the same invoice twice. Kevin hands her exactly
that, in the file format she already imports.

**Flow.**
1. Ruth opens the accounting view (read-only, already in the Nov 8 UI slot).
2. "Export for QuickBooks" downloads a CSV of settled POs: PO number, vendor, date,
   material, quantity, unit price, total, delivery/QC confirmation dates, and the
   record-anchor reference for the audit trail.
3. Two alert queries run over the same data and surface as flags in the view:
   **duplicate invoice** (same vendor + invoice number, or same vendor + amount +
   date window already settled) and **price drift** (a PO's unit price differs from
   that vendor's trailing average for the material by more than a set percentage).
4. Ruth can dismiss an alert with a note; dismissals are kept in the record trail,
   not deleted.

**Inputs / fixtures needed.** Settled PO data from the core loop (PO #1042 is the
hero row); seeded history with one deliberate duplicate invoice and one deliberate
price-drift case planted in the fixture POs, so both alerts have something true to
find on demo day.

**Acceptance criteria.**
- (a) The CSV imports into a QuickBooks-shaped consumer without manual cleanup:
  stable column order, plain dates, no crypto terms, totals reconcile to the sum
  of settled POs in the ledger — to the cent.
- (b) The seeded duplicate invoice is flagged before it can be exported as a
  second payment; the seeded price drift is flagged with both prices shown.
- (c) Unsettled (escrowed, unreleased, cancelled, refunded) POs never appear in
  the export as paid; their state is a separate clearly labeled section or absent.
- (d) Export + alerts are pure queries over existing ledger/settlement data —
  no new writes, no new chain calls.

**The 20-second demo moment.** Optional insert shot, not a storyboard dependency:
Ruth clicks export, and Kevin's note at the top reads: "One invoice looks like a
duplicate of one you already paid — I held it out of this export."

**Out of scope.** A live QuickBooks API integration or OAuth; tax handling; paying
anything outside the existing escrow flow; general accounts-payable automation
(bills that never went through Kevin stay in Ruth's old process).

## 3. Cross-plant transfer suggestions

**Gate:** forecast job working (Nov 7). **Slots:** Nov 10 [IF] forecast-side
proposals, Nov 11 [IF] UI card.

**User story.** Sam is about to reorder Microcrystalline Cellulose for Juniper
Ridge. Twenty miles of paperwork away, Copper Canyon is sitting on more MCC than
it will use before it expires, and Summit Ridge has surplus too. Today, nobody
knows — each plant sees only its own shelves, so the company buys what it already
owns. Kevin sees all three plants, so he proposes the transfer first and the
purchase second.

**Flow.**
1. Kevin's forecast run computes, per material and plant: projected need (usage +
   waste factor, as in the core loop) and projected surplus (on hand above safety
   stock, expiry-aware).
2. Where one plant's surplus covers another's shortfall, Kevin emits a transfer
   proposal: material, quantity, from → to, the purchase it avoids (quantity ×
   best qualified quote), and the lot it would move (earliest-expiring surplus
   lot first).
3. Proposals appear as cards next to the 5am brief / on Sam's inventory screen.
   Sam (or Lena, per plant policy) approves or dismisses. Dismissed proposals
   don't reappear for the same shortfall.
4. An approved proposal writes a normal transfer movement pair through the
   existing ledger API (out of the surplus plant, into the short plant on
   receipt) — the same machinery, and the same discrepancy checks, as a manual
   transfer. Only then does the forecast re-run and shrink (or drop) the draft PO.

**Inputs / fixtures needed.** The three-plant seed (§1, §6) extended so at least
one clean surplus/shortfall pair exists at seed time, distinct from the seeded
MCC transfer discrepancy (§5, record 7) — the discrepancy is a bookkeeping
error Kevin flags; a transfer suggestion is a deliberate move Kevin proposes.

**Acceptance criteria.**
- (a) At seed state, Kevin produces at least one correct transfer proposal with
  the avoided-purchase math shown, and produces none for materials where the
  "surplus" is actually safety stock or an expired/quarantined lot.
- (b) Approving a proposal creates exactly the transfer movement pair and the
  receiving plant's projected shortfall drops accordingly; no PO is drafted for
  the covered quantity.
- (c) A proposal never suggests moving a lot in `quarantine`, an expired lot, or
  more grams than the surplus above safety stock.
- (d) The existing discrepancy detector stays silent about an approved transfer
  once both sides post, and still fires on the seeded §5 discrepancy.

**The 20-second demo moment.** Forecast screen, under the Vitamin C draft PO:
"Before you buy: Copper Canyon has MCC above its safety stock, expiring in
5 months. Moving it covers Juniper's MCC need and saves a purchase." Sam
clicks Approve; the twin shows the flow between plants.

**Out of scope.** Automatic transfers without human approval; transfers that
settle money between plants (internal moves are ledger-only, no escrow);
multi-hop routing; optimizing freight/shipping (no carrier data exists in the
fictional world); group purchasing — that stays stretch item 4 in `PLAN.md`.

## Stretch after the promoted three (one-line each, full order in `PLAN.md`)

- **Kevin's 5am brief** — one printable page from Kevin's own data: overnight
  inventory changes, lots stuck in quarantine, POs awaiting approval, draft
  supplier replies. Spec already written in `SPEC.md` §4; it is stretch #1.
- **Receiving dock mode + printable lot labels** — a big-button, glove-friendly
  receiving screen for Tom Becker (packing-slip photo, lot, quantity, "received"
  — nothing else on screen), and lot labels that print from the lot record with
  material, lot number, quantity, and state. It closes the "paper in, paper out"
  loop at the dock door, where the plant's real system has always been a
  clipboard. No barcode-scanning hardware dependency: the label carries a
  human-readable lot code first.
- **Vendor onboarding checklist** — per-vendor qualification tracker: which
  documents HQ requires (insurance certificate, W-9, quality agreement), what's
  on file, what's missing, and who is chasing it. It turns "Discount Chem Direct
  is unqualified" from a hard-coded fact into a visible reason — Kevin refuses
  them *because* their quality agreement was never signed — and gives GlobalSource
  Trading a path from "pending" to qualified that Sam can actually work.
