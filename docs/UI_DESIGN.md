# UI design pass — proposal

> **Superseded for layout by v2 (docs/VISION.md §6, branch `v2-design`, Oct 30).** The Floor and its four tabs became the sidebar's pages (Your integration, Overview, Plant map, the plant, Acme and HQ pages); the tokens, the status colours and the curtain from this pass stay. The rest of this file is the Oct 29 record.

**Session of Oct 29, 2026 (branch `ui-design`, Fable).** Step 1 of the UI design pass (PLAN.md "In progress"): what each screen is for, what is wrong with it today, and the design to build in step 2 once Tony says go. Screenshots of today's UI are in `docs/ui-design/before/` (taken with `npm run web:shot`, `npm run web:shot:3d` and a survey script against `npm run api` and `npm run erp`); the mockups are static pages in `docs/ui-design/mockups/` with their screenshots in `docs/ui-design/after-mockups/`. The mockups use the recorded run's real wording and numbers; nothing in them is invented beyond layout.

Nothing in this pass changes what Kevin says (the transcripts), the contract, the agents, the fixtures or the README. It changes how the screens are arranged, styled and navigated.

## 1. Who uses each screen

| Person | Device | Screen | What they must see or do in under ten seconds |
|---|---|---|---|
| **Ray Delgado**, purchaser | PC at his desk, often a phone on the floor | Floor (his turn), Plants, Books | What Kevin read from the scan folder and whether anything needs an answer; confirm a batch record; see stock that is low and what Kevin proposes to buy or move. |
| **Linda Park**, ops director | Phone | Floor (her turn): the text thread | One request, two buttons: what, how much, to whom, why it needs her. YES or NO. |
| **Tommy Reyes**, receiving | Phone or dock tablet | Floor (his turn) | Which PO the truck is for, photograph the slip, see "matches" or "short". |
| **Priya Natarajan**, QC | PC in the lab | Floor (her turn) | Which lot waits in quarantine; release or reject. |
| **Marcy Allen**, accounting | PC | Books | Which POs settled, each matched to a receipt; the CSV; the price-drift alert. |
| **Jordan Pike**, Acme HQ | Wide screen | HQ, the ERP view, Plants | Kevin's limits as the contract enforces them now, spend this month, supplier standing, the group purchase; the acquirer's books. |
| **A judge** | Laptop, the hosted replay | Floor with Play, the map (flat or 3D), Behind the curtain | The loop in two minutes: refused, approved by text, paid on QC release; then every transaction with its explorer link, one click away. |
| **Tony recording the video** | 1920×1080 | `?video=1` | Unchanged beats on the fixed clock; captions readable at 1080p. |

Kevin is on every screen as the one who speaks (a green "K"), and is labelled an AI assistant in the shell. Staff never see a wallet, key, hash, gas or token name; those live behind the curtain, which is one switch on the bar.

## 2. What is confusing or noisy today

Screenshots: `docs/ui-design/before/pages/` (live screens), `before/static/` (the hosted replay), `before/3d/` (the twin).

1. **No navigation, only checkboxes.** Four checkboxes in the header (Plant map, Three plants, Spreadsheet, Behind the curtain) stack panes on one page. "Three plants" alone is a 6,000-pixel-tall pane (`wide-plants.png`) with the policy, discrepancies, four move cards, a 33-row stock table, the mass balance, the books and the group purchase in one column. A plant worker cannot tell where their screen starts; a judge cannot tell what is live and what is a snapshot.
2. **Whose screen is this?** Everything is "Kevin · Purchasing assistant · Hollow Pine". The action bar names the person up next, but the rest of the page does not change for Linda, Tommy or Priya. On a phone, Linda's two buttons sit between a sticky bar and a feed of Ray's cards.
3. **The sticky action bar overprints the feed.** `wide-linda-phone-viewport.png`: the sticky bar's background is the page colour but the phone mock is not, so Ray's "Discrepancy" card shows through behind Linda's text. `phone-live-start-viewport.png`: the "Waiting for you" pane sits above the map and pushes the run off the first screen.
4. **One red for everything.** Every one of Kevin's notes has a red left border, whether it is good news ("Inventory updated") or an alert. Low stock, refusals, disputed transfers and Kevin's ordinary sentences share the same red. There is no colour for "waiting on a person", "funded and held", or "paid", which are the states the whole product is about.
5. **Label soup.** Every section heading is 0.8 rem uppercase grey; cards, tiles, tables and notes all have the same weight. The feed repeats "Ray Delgado · Purchaser" eight times; the step tag ("Big PO", "Kevin retries") is the demo runner's internal title, not what happened.
6. **The map's notes list** (every plant, lot, flow and quote as bullets under the map) repeats what the map and the feed already say, in a longer form, on every step (`video-refusal.png`, bottom left). On the video page it is the lowest-value area of the frame.
7. **Three-plant tables on a phone** scroll sideways inside their box with no sticky first column, so a row's material name scrolls away (`phone-plants.png`). The ERP view scrolls the whole page sideways at 390 px (`phone-erp.png`; it is outside `web/`, see §8).
8. **Buttons and controls differ by pane.** `.controls button` (replay) and `.actions button` (live) have different padding and radii; the import wizard's "Hold for review" is a bare text button with no edge; the map bar's switches are 0.75 rem; focus is the browser default and invisible on the green primary button.
9. **The static replay's first screen is the guide text and a map**, with Play below the fold on a phone (`static/phone.png`). The replay controls (Back / Play / Next / slider) live in a bar above the panes and are the only thing that moves the run; the map also offers "This run | Group buy" with its own ‹ › Play, two transports for two runs.
10. **After "Start over", "Waiting for you" says nothing is waiting** although the scans are still in the folder (the API's reset clears the queue until the folder changes). Noted for the builder, not a UI issue.
11. **Bundle today:** the default page's JavaScript is 340.19 KB (103.34 KB gzipped), its CSS 15.82 KB; the 3D chunk 975 KB, loaded only on demand.

What already works and stays: the plain wording in Kevin's voice; the phone mock for Linda; the curtain as a dark pane in both themes with refusals in red; the flat map and the 3D twin and their motion; the video page's beats and clock; the import wizard's flag-by-flag flow; the one-click curtain.

## 3. Navigation and information architecture

One shell, four screens, one switch.

```
[K] Day One  ·  Kevin · Hollow Pine Tablet Co. (Plant B)      Floor(3)  Plants  Books  HQ        (o) Behind the curtain
```

| Screen | What it holds | Source |
|---|---|---|
| **Floor** (default) | **Up next**: the person whose turn it is, Kevin's one-line ask and their buttons (Linda's phone, Tommy's slip, Priya's lot). At Ray's turn the "Waiting for you" queue is *inside* Up next, one row per scan with a status pill and Open. **The run so far**: the feed, newest first, each card with a status pill. **Plant map**: flat or 3D, this run or the group buy, with a one-line caption and a legend. | Live API or the recorded run. In the replay, Up next becomes the transport (Back · Play · Next · slider · "9 / 15 · Linda texts"). |
| **Plants** | Four tiles (needs a person, low stock, mass balance, open POs), then **Waiting on a person** (discrepancy reviews, moves to approve, the waste correction), then **Stock on hand** with a plant filter and an "Only low stock and reviews" switch (default on: 5 rows instead of 33), then the mass balance. | Live API, or the end-of-run snapshot on the static host (read-only, said so). |
| **Books** | Marcy's view: Kevin's line, the price-drift alert, the settled POs, Export CSV and the printable brief; below it **Bring in a spreadsheet** (the import wizard), since both are "the plant's books coming over". | Live API; the static host shows the snapshot and the brief, no wizard. |
| **HQ** | Jordan's view: tiles for the per-PO limit, this month, the plant budget and Kevin's state; Kevin's sentence; category caps with supplier standing; the group purchase; links to the ERP view and the reconciliation. | Live API reads the contract; the static host says what `npm run escrow` shows. |
| **Behind the curtain** (switch) | A third column on wide screens (a dark rail), a full-width dark panel after the run on a phone. Accounts in the run and who paid their gas; the spend-policy ledger line; one card per transaction, newest first, refusals in red with the contract's words; the attestation in two chips with the detail folded. On the map the flows carry their hashes, as today. | Same data as today. |

Rules kept from today: `GET /api/run` decides live vs replay; the accessible names `Next action`, `Three plants`, `Behind the curtain` and `button[data-action="primary"]` stay so `npm run web:shot` keeps working (the Three plants region moves behind the Plants tab; the script clicks the tab, same text). The Floor tab shows a badge with the number of scans waiting for the viewer.

Phone first: on a phone the Floor is Up next, then the run, then the map (collapsed to its caption and a "Show map" button on the smallest screens); the Plants, Books and HQ tables keep a sticky first column and scroll inside their panel; buttons are 48 px tall and the two reply buttons fill the width.

## 4. Design system

`docs/ui-design/mockups/tokens.css` becomes `web/src/tokens.css`. The system font stack stays (no download; the page must work offline and in record mode).

**Type scale (px):** 12 xs (section labels, table heads, captions) · 13 sm (table cells, chips, meta) · 15 md body (16 on phones) · 17 lg (Kevin's ask in Up next) · 22 xl (tile values) · 28 2xl (video cards only). Monospace for accounts, methods and hashes behind the curtain. Tabular numerals on every money and quantity column.

**Spacing:** 4-pt scale, 4 / 8 / 12 / 16 / 24 / 32. Radii 6 / 10 / 14. One shadow, used only on the Up next card.

**Colour tokens** (light / dark), all text pairs at or above WCAG AA 4.5:1:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` / `--surface` / `--surface-2` | #f4f3ee / #fff / #ecebe5 | #111417 / #1a1e23 / #232830 | page, panels, insets |
| `--ink` / `--ink-2` | #1b1d20 / #5c6370 | #e8eaed / #9ba3ad | text, secondary text |
| `--line` | #dcdad2 | #2d333c | borders |
| `--brand` | #1f6f5c | #4fb39a | Kevin, the current card, the one primary button |
| **`--refused`** | #a9261d on #fbe9e7 | #ff9a92 on #3a1b19 | refused by the contract, disputed transfer, low stock, NO |
| **`--waiting`** | #8a5a00 on #fff3d6 | #f2c35c on #3a2d12 | waiting on a person, a question, quarantine, review |
| **`--held`** | #1e5aa8 on #e4eefb | #8fb8f0 on #16263d | funded and held in escrow, on its way, a move proposed |
| **`--paid`** | #1b6b3a on #e2f3e8 | #74c69d on #15301f | paid, released, confirmed, balances |
| `--neutral` | #5c6370 on #eeede8 | #9ba3ad on #232830 | quotes, forecast, set aside |
| `--curtain*` | #14171c, ink #d9dde3 | #0b0d10 | the curtain in both themes; refusals #ff9a92, ok #74c69d |
| `--money`, `--quarantine` | #9a6d00, #b8731a | #e0b23a, #f0a93b | the map's coins and cages (darkened in light mode for contrast on the floor) |

Colour is never the only signal: every pill carries a word (refused, waiting on Ray, funded, paid), refused transactions also carry ✗ and the contract's sentence, low stock also says "below 500".

**Components** (each is one class in `web/src/styles.css`; the mockups show them):

- **Bar**: brand, tabs with a badge, the curtain switch (a real switch, not a checkbox).
- **Panel** with an uppercase 12 px label and a right-hand slot.
- **Person chip** (initials, name, role) and **status pill**.
- **Up next card**: brand border, the person, Kevin's ask at 17 px, the buttons; or the phone mock; or the scan queue.
- **Feed card**: person, status pill, the staff line with the PO number bold; the current one tinted. The pill replaces the runner's step title: Big PO → `refused`, Small PO → `funded`, Kevin retries → `funded`, Delivery → `quarantine`, QC release → `released`, Paid → `paid`, Discrepancy → `for Plant A to review`, Upload → `batch record`, Ray confirms → `confirmed`, Quotes/Forecast → neutral. (A lookup from step title to pill in `run.ts`, tested like `audienceOf`.)
- **Phone**: unchanged shape; the two replies are full-width 48 px pills on a phone, NO in the refused colour.
- **Queue row**: a page icon, the batch number with its pill, Kevin's summary, Open.
- **Review card**: amber left border, pill, sentence, Approve / Dismiss; green and dimmed once decided.
- **Stat tile**: label, value, pill.
- **Table**: sticky first column, right-aligned tabular numbers, a status column with pills instead of coloured cells.
- **Kevin note**: grey inset with the green K (no more red border); `alert` variant in amber for a real alert.
- **Curtain rail**: accounts grid, ledger line, tx cards, attestation chips.
- **Map frame**: segmented switches in the panel head, the stage, one caption line, a legend. The notes list goes; its sentences stay available as the SVG's `aria-label` and the 3D caption.

## 5. Each screen, redesigned

Mockup screenshots in `docs/ui-design/after-mockups/` (wide = 1280 px light, phone = 390 px dark).

- **Floor, Ray's turn** (`floor-ray-*.png`): Up next holds the queue; BR-B-1045 ready (green), BR-B-1046 with one question (amber), the packing slip set aside (grey). "or upload a photo…" and "Start over" are quiet. The run so far starts with Kevin's setup line. The map is beside it on wide screens, below on a phone.
- **Floor, Linda's turn** (`floor-linda-*.png`): the pill says "refused · needs Linda"; the phone mock is the whole card; NO is outlined red, YES solid green, both 48 px on a phone. The feed below shows PO-1042 `refused` and PO-1041 `funded` in their colours, so the story is readable without the map.
- **Floor at the end, curtain on** (`floor-curtain-*.png`): three columns on wide: map, the run, the curtain rail. Marcy's card `paid`, Priya `released`, Tommy `quarantine`, Linda `approved` with her thread; the rail lists who signed what and who paid the gas, then the transactions newest first, the two refusals in red.
- **Plants** (`plants-*.png`): tiles, Waiting on a person, the filtered stock table with a Status column, the mass balance with `balances` / `waste under-recorded?` pills. 5 rows by default instead of 33.
- **Books** (`books-*.png`): Marcy's header with the two actions; Kevin's line; the price-drift alert in amber; the settled table; the import wizard with answered flags dimmed and the running "2 of 9" pill.
- **HQ** (`hq-*.png`): four tiles, Kevin's sentence, category caps with supplier pills (QuickChem `not listed, refused`), the group purchase `paid`, links to the ERP view and the reconciliation.
- **Behind the curtain on a phone**: the dark panel after the run, same cards.
- **Map and twin**: no new geometry. The flat map takes the tokens (its `--map-*` variables already exist); the twin's `THEME` object in `Twin3D.tsx` reads the same hex values; its DOM labels (`twin3d.css`) move to the pill shapes and the status colours above (quarantine amber, refused red, paid green, money gold). The notes list under both maps becomes a one-line caption and a legend.
- **Video page**: layout unchanged (map left, panel right, caption under). It inherits the tokens, the feed cards and the curtain rail; the map's notes list goes, which gives the stage 20% more height at 1080p. Beats, clock and captions untouched.
- **Static replay** (hosted demo): the guide becomes a one-line banner under the bar with a close button; Up next becomes the transport with the current step's title; everything else as above, with Plants/Books/HQ marked "as the ledger stands at the end of the recorded run".
- **The brief** (`/api/brief.html`): already plain and good; it gets the tokens (same greens, the `waiting` amber for "waiting on a person") and the bar's brand line. It is rendered in `agents/kevin/` (see §8).

## 6. What stays, what changes, trade-offs

**Stays:** every staff sentence; the data each screen shows; the curtain's content; the map and twin geometry and motion; the video beats; the API; the fixtures; the README.

**Changes:** one shell with tabs instead of checkboxes; a status colour system; the feed's step tags become status pills; the scan queue moves into Up next; the Plants screen is filtered by default; the map's notes list becomes a caption; the curtain is a rail; consistent buttons, focus rings and type.

**Trade-offs for Tony:**

1. **Tabs hide the other screens.** A judge no longer sees stock and books beside the run; they are one click away (and the end-of-run card says so). In exchange each person gets a screen that is theirs, which is what the brief promises.
2. **The map's bullet list goes.** It is the one place every twin state is written out in words. The sentences stay as the map's accessible label and in the 3D caption; the feed already says the same in Kevin's words.
3. **Step titles become status words.** "Big PO" → `refused`, which is clearer for staff and judges, but the storyboard and RECORDING.md refer to steps by the runner's titles; the transport in the replay keeps the title ("9 / 15 · Linda texts"), so recording instructions still match.
4. **`npm run web:shot` changes slightly**: "Three plants" is a tab, not a checkbox, and PLANTS=1 clicks it; everything else keeps its accessible name.
5. **The brief and the ERP view are outside `web/`.** The brief's stylesheet is in `agents/kevin/`, the ERP's in `erp/`. I propose to touch the brief's stylesheet only (tokens, ~40 lines) and to leave the ERP as it is apart from one line that stops its page scrolling sideways on a phone, both listed in the report for the merge. Say no and both stay untouched.

## 7. Build plan (step 2, after Tony's go)

Small commits, each leaving `npm run check`, `npm run demo`, `demo:group`, `sealed`, `test:attacks`, `web:data -- --check`, `web:shot`, `web:shot:3d` and `host:build` green.

1. `web/src/tokens.css` + the shell (bar, tabs, switch) and the Floor layout; the step-to-pill lookup in `run.ts` with tests.
2. Up next (action card, phone, queue) and the feed cards; the replay transport.
3. Plants, Books (with the import wizard), HQ as tabs; tables with sticky first column and status pills.
4. The curtain rail; the attestation folded into chips.
5. Map frame, legend, caption; the flat map's and the twin's colours and labels on the tokens; `web:shot` / `web:shot:3d` selectors.
6. Video page on the tokens; a full `?video=1` play-through check at 1920×1080.
7. The static replay's guide banner; `host:build`; before/after bundle sizes and screenshots for the report; README screenshot needs listed for the builder.

## 8. What was built (Oct 29, after Tony's go)

Everything in §3 to §5, with these decisions made on the way (screenshots in `docs/ui-design/after/`: `pages/` live, `static/` and `static-viewport/` the hosted replay, `3d/` the twin):

- **The run reads newest first** on the Floor, so what just happened sits right under "Up next" and a phone shows the person's turn and the latest card on one screen. The replay's cards still jump to their step when clicked; the video page keeps its own three-card feed.
- **Live, the page returns to "Up next"** when the turn moves to the next person; the old sticky bar is gone, so nothing overprints the feed.
- **The scan queue folds to one line** ("Waiting for you · 2 scans for Ray") on anyone else's turn and opens inside "Up next" at Ray's.
- **The curtain log stays in order** (oldest first) with the newest card marked, as a ledger reads and as the video's curtain beat scrolls it; the mockup had it newest first.
- **The map takes the wider column** on a wide screen (the hero for judges); with the curtain on, three columns up to 1480 px.
- **Tiles and pills wrap** on a phone; the stock and mass-balance tables scroll inside their panel with the material column pinned. No screen scrolls sideways at 390 px.
- **Bundle:** the default page's JavaScript is 353.2 KB (106.3 KB gzipped) against 340.2 KB (103.3 KB) before, the CSS 24.5 KB against 15.8 KB; the 3D chunk is unchanged (975 KB, loaded only on demand). The 13 KB of JavaScript is the Plants filters, the tiles and the status pills; no dependency was added.
- **Checks:** `npm run check` (492 tests, incl. new ones for `statusOf`), `npm run demo`, `demo:group` and `sealed` ("Transcript matches"), `npm run test:attacks` (14 of 14), `npm run web:data -- --check`, `npm run web:shot` (static and live, 0 console errors, no sideways scroll at 390 px), `npm run web:shot:3d` (0 label problems, both runs), the video page played end to end on its fixed clock, `npm run host:build`.
- **Outside `web/`:** `tools/render/src/shot.ts` (the Plants tab), the brief page's stylesheet in `agents/kevin/src/brief.ts` (tokens; `web/public/brief.html` regenerated by `npm run web:data`), one line in `erp/src/http/views.ts` so the ERP view scrolls its tables instead of the page on a phone, `AGENTS.md` (the `web:shot` row), `docs/TWIN3D.md` (the caption), `web/README.md`.
- **The held invoice (OPEN_QUESTIONS #41, PLAN "Payment-redirect story", added after the main session's request):** Books shows "Held invoices" once PO-1042 exists: the attack suite's hidden-text invoice NG-INV-24190, held for Marcy, with the reasons in plain words ("This invoice asks for payment to a different account. PO-1042 can only pay Northgate Ingredients, on QC release."; "It also carries a note written for an assistant, which Kevin ignored."; "Nobody has a wire to send…"). With the curtain on, a dark inset shows the account it asked for, the account the order pays with the funding transaction, and the quoted line. The data comes from `api/src/heldInvoice.ts`: the recorded model reading (`data/replay/attacks-llm.json`) through Kevin's own invoice check, served on `GET /api/books` as `held` and exported into the static snapshot by `npm run web:data`. The video page gained the "New bank details" beat (`from=bank-details`, 8.5 s, between Delivery and QC release) on the same card with the inset; the take is 2:05, nothing trimmed. Wording rule kept: the screen says what the order can pay, never "stops phishing".
- **For the README (builder):** screenshots worth replacing after the merge: the Floor at Linda's turn (wide, light) and on a phone (dark), the Floor at the end with the curtain on, the Plants screen, and the twin at the refusal (`docs/ui-design/after/pages/wide-linda-viewport.png`, `phone-linda-viewport.png`, `wide-end-curtain-viewport.png`, `wide-plants.png`, `3d/wide-07-refused.png`).

## 9. Files outside `web/` this pass would touch

- `tools/render/src/shot.ts`: click the Plants tab when `PLANTS=1` (one selector).
- `agents/kevin/src/brief` (`briefHtml`, the brief page's inline stylesheet): tokens only, if Tony agrees (§6.5).
- `erp/src/http/views.ts`: `main { overflow-x: auto }` for phones, if Tony agrees (§6.5).
- `docs/UI_DESIGN.md`, `docs/ui-design/**`: this proposal and its screenshots.
- `docs/PLAN.md` "In progress" line when the branch is ready to merge; README screenshot needs are listed in the final report, not applied.
