# Day One v2 — Tony's vision (Oct 29)

Tony looked at the app after the UI design pass (UI_DESIGN.md) and called it the foundation: the parts work, but it does not yet look or feel like the product. This file is his direction for v2, in his words where possible, plus the constraints that still hold. It is the brief for the v2 design session; that session writes its proposal into this file (§6) for Tony to approve before anything is built.

## 1. Look and feel

Reference image: `C:\Dev\day-one-refs\ui-style-1.webp` (outside the repo; an operations dashboard mock). Take the **UI style**, not its plant picture:

- Light and airy: white cards on a pale, slightly frosted background, soft shadows, rounded corners.
- Left sidebar: plant picker on top, grouped menu sections, small alert badges, the user at the bottom.
- Page header: breadcrumb, large title, one plain sentence.
- Number cards: one big figure, a small change vs. a period ("↑ 12.4% vs last month"), a sparkline.
- Right column: a live activity feed (colored dot, what happened, how long ago) and short tables with status pills.
- Restrained color: grays and white, one accent; color only when it means something (green ok, amber attention, red problem).
- Simple charts: thin lines, donut gauges, slim bars.

**Changed from the reference:** no wallet chip. Staff never see wallets (Tony agreed Oct 29). Where the reference shows "Connected 0x…", show a calm trust marker (for example "Protected ✓") that opens the behind-the-curtain view.

## 2. The 3D plant

Direction: **a futuristic, semi-transparent digital twin** with frosted-glass surfaces, glowing status indicators, and color-coded equipment and facility zones. Tony is sending a second image of specific processing rooms to build as visuals (not received yet).

Capabilities:

1. **Clickable production areas:** blending, filling, packaging, warehouse, laboratory, utilities, and so on.
2. **Color-coded status:** green running, yellow attention required, red offline.
3. **Equipment details:** click a machine to see its operating status, maintenance history, current batch and relevant metrics.
4. **Live activity:** production events and equipment changes shown on the map.
5. **Zoom and rotate:** users explore the facility in 3D.
6. **Layer switching:** toggle equipment, personnel zones, utilities, production lines and building layout.

The purchasing run the twin shows today (TWIN3D.md) stays: the order, the money in escrow and the delivery move through this plant.

## 3. The program: pages down the left side

Today the three-plant screen is one long list with no flow. v2 splits it into tabs down the left side, each a page with history, ongoing monitoring, charts and graphs, and tabs inside to dig into the numbers.

- **5am brief:** a real page, not a printout link.
- **Batch records:** current batch records (generate several fictional ones), their status, and the scans waiting for review.
- **Inventory and forecasts:** charts and graphs, with tabs to dive into the numbers.
- **Schedule:** upcoming batches one to two weeks out, how they change the forecast, and what the budget looks like with them.
- **Purchasing:** ways to buy supplies and watch the effect move through the software (inventory, forecast, budget, books, ERP).
- **Invoices:** flagged invoices to approve, and suspicious ones held (the payment-redirect story, OPEN_QUESTIONS #41).
- **Spreadsheets:** the files the user works with often, each one processed and brought into the program.
- **ERP connection:** show the link to the ERP we built; the user picks the system and sees the breakdown (what synced, bills, payments, the reconciliation).
- **Three plants:** a separate integration page: how this plant lines up with the others and their schedules now that they are on one system.
- **HQ tabs:** the HQ / acquiring-company functions, so NEAR is seen working without the user being told they are using NEAR:
  - spending limits in plain words
  - the three-plant view with discrepancy review
  - group purchasing
  - supplier approval (issued, revoked, expired, suspended after QC rejects)
  - sealed bids
  - bookkeeper export
  - ERP reconciliation

## 4. Kevin as an assistant

Today Kevin is a name on the screen: a button is pressed and results appear, and the person never checks what was read or produced. v2 makes Kevin visibly do the work and hand it to a person to check. For example: "Hand me this spreadsheet; I'll run it and report back." Kevin then shows what he read, what he did and what he is unsure of, and the person confirms before anything posts.

## 5. Constraints that still hold

- **Invisible chain** on staff screens (AGENTS.md). HQ pages show the effect ("refused: over the director's limit"), not the mechanism. The curtain keeps the detail.
- **Fictional data only.** History, batch records, schedules and invoices come from the deterministic seed (`server/src/seed/`). Charts are computed from the same ledger the rest of the app uses, so the numbers agree across pages; no random numbers in the UI.
- **No stubs.** A page that is not working by Nov 12 is removed, not left as a placeholder.
- **Honest Kevin.** The hosted demo cannot call the model (it would expose the key), so there Kevin's answers are the recorded ones; `npm run api:live` runs him live. Say which is which.
- **Schedule.** Submission is Nov 14. The video (RECORDING.md) and the README screenshots are redone after v2, so v2 must be merged by about **Nov 10**. Cut scope rather than slip.
- **Checks stay green.** `npm run check`, `demo`, `test:attacks`, `web:data -- --check`, `web:shot`, `web:shot:3d`, `host:build`.

## 6. Proposal (v2 design session writes this; Tony approves)

**Session of Oct 29, 2026 (branch `v2-design`, Fable).** Written after reading §1–5, UI_DESIGN.md and TWIN3D.md, looking at the reference image, and clicking through every screen of the running app (`npm run api`, the ERP view, the brief, the import wizard, the flat map, the twin, the curtain). Mockups are static pages in `docs/v2/mockups/` with screenshots in `docs/v2/mockups/shots/`; they use the recorded run's real numbers and wording, nothing invented beyond layout. The rooms image for the twin (§2) has not arrived in `C:\Dev\day-one-refs\`; §6.5 says what is built without it and what waits for it.

The short version: **one plant program with pages down the left side, Kevin as a visible assistant who checks his work with a person, a glass twin at the centre, and charts fed by a longer seed history.** Eleven of Tony's pages are kept, three are folded into others, and the twin gets four of its six capabilities; the two cut would be stubs. Build Oct 30 – Nov 9, merge Nov 10.

### 6.1 What is wrong today, in one paragraph

The parts work and the wording is right, but the app reads as a demo runner: four tabs across the top, a feed of the run, and one long "Plants" list. Kevin is a label on a button ("Confirm BR-B-1045") that posts without showing what he read. There is no history and no chart, so a judge cannot tell a plant that has run for months from one loaded an hour ago. HQ is one page with four tiles. The twin is good motion on plain green boxes and nothing on it can be clicked.

### 6.2 Navigation: the left side

One shell for every page (mockup `overview.html`). A 232 px sidebar on wide screens; on a phone it collapses to a top bar with a menu button and the same list.

```
[K] Day One                       ← brand; "Kevin, AI assistant" under it
┌ Hollow Pine Tablet Co. ▾ ┐      ← plant picker: Hollow Pine (B) · Acme Riverside (A) · Acme Lakeview (C) · Acme HQ
PLANT
  Overview
  Plant map                         (the twin, full page)
  5am brief
  Batch records            2        (scans waiting for Ray)
  Inventory & forecast     6        (materials below their reorder point)
  Schedule
  Purchasing               1        (waiting on a person)
  Invoices                 1        (held)
  Spreadsheets
ACROSS ACME
  Three plants             5        (discrepancy reviews and proposed moves)
  ERP connection
HQ  (shown when the picker says Acme HQ, or always on a wide screen, under its own heading)
  Spending limits
  Suppliers
  Group purchasing
  Sealed bids
  Bookkeeper export
  Reconciliation
──────────────────────────
  Protected ✓                       ← the trust marker (opens Behind the curtain)
  Ray Delgado · Purchaser  ⇄        ← whoever the run says is up next; the switcher stays
```

Rules:

- **Badges are counts of things waiting on a person**, computed from the same API calls the pages read, never decoration.
- **The plant picker changes the plant the PLANT pages read** (`?plant=B` on `/api/brief` and `/api/inventory` already take it; the others get the same parameter). Riverside and Lakeview show their pages with less in them (no batch records to review, no scans) and say so in one line, which is itself the story: they are already on Acme's systems.
- **Page header** as in the reference: breadcrumb (`Hollow Pine Tablet Co. › Inventory & forecast`), a large title, one plain sentence, and on the right the run's clock ("Mon Nov 16, 2026, 08:05", the ledger's time, not the wall clock) and the plant's standing pill (`operating`).
- **"Up next" moves out of the Floor and into a Kevin panel** that sits at the top of the right column on Overview and docks as a slim bar on every other page (§6.4). The Floor tab goes; its three parts become Overview (the run and the map), the Kevin panel (the person's turn) and the Activity feed.
- **URL per page** (`?page=inventory&plant=B`), so the video page, `web:shot` and the README can open any screen directly. `?video=1` keeps its own layout.
- **Behind the curtain** stays one switch (the trust marker), opening the dark rail beside whatever page is open; it is the only place for accounts, hashes, gas and token names, as today.

### 6.3 Design system (v2 tokens)

Keep `web/src/tokens.css` as the base (its status colours were chosen for AA contrast and the twin reads them) and change the surfaces to the reference's look:

| Token | Light | Dark | Change from v1 |
|---|---|---|---|
| `--bg` | #eef1f4 with a fixed, blurred photographic-looking gradient wash behind the page (two soft radial gradients in CSS, no image file) | #0f1215 | v1 was flat warm grey; the reference's "frosted" feel comes from the wash under white cards |
| `--surface` | #ffffff at 96%, `backdrop-filter: blur(12px)` | #1a1e23 at 92% | cards float on the wash |
| `--surface-2` | #f4f6f8 | #232830 | insets, table heads |
| `--line` | #e3e7eb | #2b313a | 1 px, cooler than v1 |
| `--ink` / `--ink-2` / `--ink-3` | #16191d / #5b6470 / #8a93a0 | #e8eaed / #9ba3ad / #6f7884 | one more grey for captions |
| `--brand` | #1f6f5c (Kevin's green) | #4fb39a | unchanged; still the only accent |
| `--ok` / `--attention` / `--problem` | #1b6b3a / #9a6700 / #b3261e on their tints | as v1 `--paid` / `--waiting` / `--refused` | the twin's status colours, named for what they mean on equipment too |
| `--held`, `--paid`, `--waiting`, `--refused`, `--neutral` | as v1 | as v1 | the pills keep their words |
| `--chart-1..4` | brand green, #4e7fd1 (held blue), #c8912a (money gold), #8a93a0 | lighter tints | four series at most on any chart |
| radii | 10 / 14 / 18 | | rounder than v1, as the reference |
| shadow | `0 1px 2px rgb(16 24 40 / .04), 0 8px 24px rgb(16 24 40 / .06)` | none (border instead) | one soft shadow on every card, not only Up next |

Type: the system stack stays (offline, record mode), sizes 12 / 13 / 15 / 17 / 24 (number cards) / 30 (page title). Tabular numerals on every figure. Spacing on the 4-pt scale, cards padded 20 px.

Components, each one class in `web/src/styles.css` (the mockups show every one):

- **Sidebar** (brand, picker, grouped nav with badges, trust marker, person).
- **Page header** (breadcrumb, title, sentence, clock, standing pill).
- **Number card**: label, big figure, a change line with ↑/↓ and "vs last month / vs Friday", a 60-point sparkline (inline SVG, from the ledger series the page already has).
- **Chart card**: title, unit line, the chart, a legend with values. Three chart kinds only: thin line (stock over time, yield by batch), slim bars (spend by month, waste by batch), donut gauge (materials ok / low / on order; budget used). Inline SVG drawn by one small module (`web/src/charts.tsx`, ~200 lines, no dependency); every chart has a text table behind a "Numbers" toggle for screen readers and for judges who want the figures.
- **Activity feed**: coloured dot by status, what happened in Kevin's words, who, how long ago on the ledger's clock; the newest first; each row jumps to its page.
- **Status table**: sticky first column, right-aligned numbers, a status pill column; a filter row above (plant, "only what needs attention").
- **Kevin panel** (§6.4), **review sheet** (a right-side sheet, 420 px, used for a batch record, a PO draft, a delivery, an invoice, a twin area).
- **Pill**, **person chip**, **tabs inside a page** (underlined, for Inventory › Stock / Forecast / Lots and HQ's six).
- **Curtain rail**: unchanged content, restyled on the dark tokens.

### 6.4 Kevin as an assistant

Kevin gets a place on the screen and a way of working that is the same on every page: **he reads, he shows his reading, he says what he is unsure of, a person confirms, then it posts.** Nothing posts from a button he pressed himself.

The Kevin panel (top of the right column on Overview; a 56 px bar under the header on other pages, which opens to the same panel):

```
┌ K  Kevin · working on BR-B-1045 ─────────────────────────────── for Ray ┐
│ I read BR-B-1045 (VC500, 800,000 tablets): 8 materials, all within       │
│ tolerance, yield 90.8%. Nothing I'm unsure of.                           │
│ [ Check what I read ]   [ Post it ]                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

"Check what I read" opens the review sheet with the scan on the left and Kevin's table on the right: material, lot, target, what he read, the difference, and a flag where he is unsure (BR-B-1046's smudged 83.040 kg shows an input with his best reading and "I read this as 83.040; the ink is smudged"). "Post it" calls the existing confirm route; the run's steps and transcript do not change. The same sheet serves:

| Moment | What Kevin shows before anyone confirms | Existing route |
|---|---|---|
| A scan lands in the watched folder | the table above, flags, "not a batch record" for the packing slip | `GET/POST /api/batch-records`, confirm |
| The forecast and the quotes | the 10-day need per material, the three quotes with why QuickChem is out, the PO he drafted (lines, total, which limit it meets) and "Send PO-1042 for Linda's approval" | the run's own steps; the button is today's primary action |
| Linda's text | unchanged phone mock; the panel says "waiting for Linda" | `POST /api/messages` |
| Tommy's slip | the slip's fields against the PO, "matches" or "short by …" | `POST /api/deliveries` |
| Priya's lot | the lot, the supplier's lot, days in quarantine | `POST /api/qc-decisions` |
| A spreadsheet | the wizard's reading, flag by flag (already built; it moves into the sheet) | `/api/imports` |
| An invoice | the held invoice's reasons; a matched one's three-way match | `GET /api/books` `held`; the ERP's bills |
| A proposed move or a waste correction | what moves, from where, what it saves | transfer suggestions, mass-balance proposals |

Honesty line: the panel's footer says "Kevin's answers in this demo are the recorded ones" on the static host and "Kevin is reading live on NEAR AI Cloud" under `npm run api:live`, read from the run's `mode` and the attestation.

### 6.5 The plant map: a glass twin

Keep the geometry, the story camera, the transitions, the labels and the two runs (TWIN3D.md); change the material and add the clicking. Everything below reads `TwinState` and the ledger; no second model.

**A site plan, not a grid (Tony, Oct 29 evening: "not a fan of the 3D boxes").** Today each department is one equal cube in a 3×3 grid, which reads as a bar chart. v2 lays each plant out the way a plant is laid out (`docs/v2/mockups/site-plan.html`, screenshot in `shots/`): a public road and a gatehouse at the front; the **office block** (two floors, window grid, entrance canopy; purchasing and accounting live here) by the gate with staff parking; the **processing hall** in the middle, one long building under a sawtooth roof with four bays in a row (weigh & dispense with its silos through the roof, blending, compression with its dust stack, packaging); the **QC lab** beside the hall's front, low with a window band; the **warehouse** behind the hall with receiving docks and a canopy on the truck road and shipping docks on the right yard; a **utilities yard** behind the lab (tanks, chiller, stack); lawns, trees, a fence, trucks on the road. Riverside is the same kit at a different size and arrangement; Lakeview is a warehouse, packaging hall and office only. The suppliers, the escrow and Acme HQ stay beyond the gate as pads, as today, so every money and truck arc keeps its ends.

The ledger's nine departments do not change; they become **zones of five buildings**: receiving and warehouse are the warehouse's dock side and storage; weigh & dispense, blending, compression and packaging are the hall's four bays; QC lab is the lab; purchasing and accounting are the office's two floors. A zone lights, glows or stays dark exactly as a department does today, so `TwinState`, the transitions, the story camera and the tests keep working; only `layout.ts` (footprints per building and zone) and `buildings.ts` (the kit: hall, warehouse, office, lab, utilities, gatehouse, trees, trucks) change. The flat map reads the same footprints.

**Look.** Frosted glass over that plan: `MeshPhysicalMaterial` with transmission 0.6, roughness 0.35, thickness 2, a faint tint per status, and a glowing edge (an `EdgesGeometry` line per building in the status colour, emissive); the sawtooth teeth are glass faces in the bay's status colour; windows light as a zone comes online. Floors are translucent slabs over a soft grid. Status rings on the ground under each zone pulse slowly: green running, amber attention, red offline. Money, the cage and the truck keep their colours. Fog and a vignette, no bloom pass (the draw-call and offline rules stand: no post-processing dependency, no HDRI file). Lights: one hemisphere, one directional with soft shadows off. Dark theme first (glass reads best on the dark tokens); light theme uses the same materials on the pale wash.

**Tony's six capabilities, what each means here:**

1. **Clickable areas.** Every department box and pad is pickable (fiber's `onClick`); a click opens the review sheet for that area: its name, status and why ("Blending: online since BR-B-1045 was confirmed"), the lots in it now (`GET /api/inventory` by department), the current batch (the batch record whose draws touched it), and the last five ledger events there (lot events by `departmentId`). A pad click shows its side: Escrow lists the held POs with amounts; Suppliers lists quotes and standing; HQ lists the limits. **Built.**
2. **Colour-coded status.** Green running (online and a batch in progress today), amber attention (a quarantined lot, a discrepancy, a flagged batch, a scan waiting), red offline (not on Day One yet; Plant B's grey departments at the start). The colour comes from the same `TwinState` plus the page's badge counts. **Built.**
3. **Equipment details.** A small equipment list per department in the seed (`server/src/seed/equipment.ts`: the mixer, the press, the filler, the scale, the HPLC; one to three per department, fictional makes), each with a status derived from the ledger (running when its department has a batch today, idle otherwise, attention when its lot is held) and its current batch. Shown in the area's sheet as rows; the equipment itself is drawn as the existing building parts (silos, tank, stack) with their own glow. **Built without a maintenance history**; a maintenance log is a stub unless the seed invents work orders, which nothing else in the product uses, so it is cut (§6.8).
4. **Live activity on the map.** The activity feed's events ping on the map: a soft ring at the department or pad where the event happened, fading over two seconds, driven by the run's steps as they arrive (live) or play (replay). The coins, trucks and cages already carry the big moves. **Built.**
5. **Zoom and rotate.** Already there (orbit on drag, wheel to zoom; the story camera hands back on the next step). Add the reference's +/− and "fit" buttons on the stage and a "follow the story" switch. **Built.**
6. **Layers.** A layer bar on the stage: **Buildings** (always), **Equipment** (the parts and their glow), **Orders & money** (coins, arcs, cage, truck, the escrow and HQ pads), **Labels**. Each is a toggle on groups that already exist. **Personnel zones and utilities are cut**: nothing in the ledger knows where people stand or where the steam line runs, so they would be painted on, which is a stub.

**The rooms image.** Tony said he is sending an image of the processing rooms he wants built. The site plan above is built either way; when the image arrives, the hall's bays and the equipment inside them are modelled after it (an afternoon inside the Nov 6–8 twin days). If it is late, the hall keeps the sawtooth bays of the sketch.

**Plant map page.** The twin fills the page (stage 16:9 at the top, the area sheet on the right when something is clicked, the legend and layer bar in the stage's corners). The Overview shows the same twin in its centre card at a smaller size, as the reference does. The flat map stays as the no-WebGL fallback and for the phone.

### 6.6 The pages, each with the data it reads

Every page has history, a chart or two, and the things waiting on a person. Live, each reads the API; on the static host, each reads the end-of-run snapshot that `npm run web:data` already writes, extended with the series below. Every page says which it is.

| Page | Top (number cards) | Middle | Right / bottom | Reads |
|---|---|---|---|---|
| **Overview** | Batches this month (count, vs last month, sparkline of batches per week) · Stock below reorder (6 materials, ↓ 2 vs Friday) · Open purchase orders ($5,762.00: $612 held, $5,150 paid, donut by state) · Waiting on a person (5) | the twin; under it Recent batches (last 5, with yield and status) | the Kevin panel (up next), then Live activity (the run's steps newest first, then the history's events) | `/api/run`, `/api/inventory`, `/api/batch-records`, `/api/history` (new, §6.7), `/api/books` |
| **Plant map** | — | the twin, full page | the area sheet | `/api/run`, `/api/inventory` by department, `/api/history` events |
| **5am brief** | 1 waits on a person · 3 to order · 2 moves proposed | the brief's four sections as cards with the same sentences (`/api/brief`), each line linking to its page | "Print" (the existing HTML), the brief for Plant A and C from the picker | `/api/brief?plant=` |
| **Batch records** | Confirmed this month · Average yield (90.4%, ↑ 0.3 vs last month, sparkline) · Waste this month (kg, %) · Scans waiting (2) | Scans waiting for Ray (the queue, into the review sheet); then the record table: batch, product, date, tablets, yield, waste, status pill (confirmed / draft / one question / rejected) | Yield by batch (line, last 20), Waste by batch (bars) | `/api/batch-records`, `/api/history?series=batches` |
| **Inventory & forecast** | Materials below reorder (6) · Quarantined (1, MGS 10 days) · On order ($5,762) · 10-day need covered (26 of 33 materials) | tabs: **Stock** (the status table by material with plant columns, filter "only low"), **Forecast** (per material: on hand, on order, 10-day need, shortfall, Kevin's recommendation), **Lots** (every lot with state and age) | Stock over time for the selected material (line, 90 days, reorder point as a rule, the planned draws dotted ahead), Materials by state (donut) | `/api/inventory`, `/api/forecast` (new: the forecasts table), `/api/history?series=stock&material=` |
| **Schedule** | Batches next 14 days (6) · Materials short for them (1: ascorbic acid) · Projected spend for them ($, from formula × last price paid) · Next batch (BR-B-1047, Nov 17) | a two-week strip, one row per day, batches as cards with product, tablets and a pill (ready / short: ascorbic acid / waiting on PO-1042); below it, what each batch draws and what it leaves | Budget with the schedule: the plant budget, spend this month, what the planned batches would add (bars) | `/api/schedule` (new: production_plan joined to formulas, stock and the policy's limits) |
| **Purchasing** | Spend this month ($10,507 of $60,000, gauge) · Per-PO limit ($2,500; over it, Linda) · Open POs (2) · Last quotes (3, QuickChem out) | tabs: **Orders** (every PO: number, vendor, total, state pill: refused → approved → funded → shipped → received → paid; a click opens the sheet with its timeline), **Quotes** (the RFQs and quotes with standing), **Effects** (for a PO: the inventory, forecast, budget, books and ERP rows it changed, with a link to each) | Spend by month (bars, 4 months), Spend by category against caps | `/api/run`, `/api/history?series=spend`, `/api/policy`, the quotes table |
| **Invoices** | To approve (0) · Held (1) · Matched this month · Price drift (1) | the held invoice as a card with its reasons (today's Books "Held invoices"); then every invoice: number, vendor, PO, total, match pill (matched / duplicate / held / price drift), paid-by | the price-drift alert; "Export for the bookkeeper" | `/api/books` (`held`, `alerts`, `settled`), the ERP's bills when `npm run erp` is up (`/api/erp/bills`, a proxy; absent on the static host, where the page says so) |
| **Spreadsheets** | Files brought in (1) · Rows read (19) · Needing an answer (9) · Posted (0) | the two sheets the plant works with (the inventory workbook and its sales tab) as cards: what Kevin read, what he asked, what posted; the wizard itself opens in the review sheet | — | `/api/imports` |
| **Three plants** | the four tiles today has | Waiting on a person (discrepancy reviews, moves, the waste correction), the stock table across plants, the mass balance | the three plants' schedules side by side (next 14 days) | `/api/inventory`, `/api/mass-balance`, `/api/transfer-suggestions`, `/api/schedule?plant=` |
| **ERP connection** | Connected to: Acme Holdings ERP (NetSuite-shaped mock) · Synced (POs 2, receipts 1, payments 1) · Bills matched (7) · Reconciliation (7 of 7 match) | what crossed, newest first (PO, receipt, bill, payment, each with its ERP id and Day One ref); then the seven reconciliation checks as rows with MATCH pills | "Open the ERP" link to `npm run erp`'s page | `data/replay/reconcile-chain.json` and the recorded reconcile views for the static host; `/api/erp/*` proxies when the ERP is up. The "pick your system" dropdown is cut: one connector exists, a picker would be a stub |
| **HQ › Spending limits** | per-PO · this month · plant budget · Kevin active (today's tiles) | Kevin's sentence; category caps with spend; **Change a limit** in plain words (the `npm run policy` flow: a text box, Kevin's reading, "Apply" that needs Acme's key, so on the static host it shows the reading and says the change needs HQ's key) | policy changes so far (the policy view's list) | `/api/policy` |
| **HQ › Suppliers** | approved (3) · suspended (1) · lapsed (1) · revoked (1) | every supplier with its standing pill, categories, since when, and why (two relayed QC rejects for Pacific); the four refused attempts as rows | — | `/api/policy` suppliers, `data/attacks/credentials-testnet.json` |
| **HQ › Group purchasing** | today's group-buy block | the pooled PO's plants, shares, approvals; the map's group run opens from here | — | `web/src/data/group-buy.json` |
| **HQ › Sealed bids** | round RFQ-2611-02 · 3 sealed · opened at · awarded Northgate | the round's timeline (sealed, deadline, opened, awarded) and the three refused attempts in plain words | — | `data/sealed/RFQ-2611-02.round.json`, `transcript.txt` (a new small export into `web/src/data/`) |
| **HQ › Bookkeeper export** | settled POs (7) · total · alerts (1) | the settled table and the CSV button (today's Books table) | — | `/api/books` |
| **HQ › Reconciliation** | 7 of 7 | the seven checks with what each compared | — | the recorded reconcile views |

Three of Tony's pages fold into others rather than standing alone: the bookkeeper export is HQ's page and the Invoices page's button; the three-plant discrepancy review stays on Three plants (HQ links to it rather than showing it twice); "ways to buy supplies" is the Purchasing page's Effects tab, not a separate flow.

### 6.7 The seed history behind the charts

Charts show the ledger or nothing. Today the seed holds 56 days: eight summarized batches, six POs, four transfers, one QC rejection. That gives a yield line with eight points and a spend chart with two bars. The seed grows to **about 120 days (mid-July to the demo clock)** with these rules, so nothing already recorded moves:

- **Every number that the recorded run prints stays the same.** The new history ends before Oct 1 and closes to the same opening balances: each new lot is fully drawn by new batches (or wasted) before Oct 1, so stock on Oct 1, the forecast, the reorder lines, the transfer suggestions and the mass balance at the demo clock are unchanged. `npm run demo` and `demo:group` are the test (the "Load seed" line's counts change: wording only, `-- --accept`).
- **Batches:** about 28 more, Plant B two a week across its three products, Plant A one a week of P-CMD (with its §15 waste habit, so the mass-balance story has a longer tail), yields in the 86–92% band from the formula and tablets, one batch with a high-waste note like BR-B-1044.
- **Purchase orders:** about 14 more, July to September, from the qualified vendors at their list prices with one price step for magnesium stearate in August (so the price-drift chart has a history), paid by check. **Books and the ERP keep their window**: the bookkeeper pack and the ERP cutover read POs from Sep 24 (the pack's first PO) onward, which they do today by content; the seed gets one `BOOKS_FROM` date and `books.ts` and `erp:seed` read it, so the recorded exports, the ERP's seven bills and `erp:reconcile` are unchanged.
- **Transfers:** monthly packaging transfers from Plant C; one more received-short transfer in August, resolved, so Three plants has a resolved discrepancy in its history.
- **QC:** three more decisions (two releases, one rejection returned to the vendor) and one lot held longer than usual, so Inventory's "quarantined" card has a trend.
- **Production plan:** four more planned batches at Plant B on days 11–14 after the demo clock (one each of VC500, CMD, ELX, VC500) and Plant A's and C's next two weeks. Days 11–14 are outside Kevin's 10-day forecast, so the recorded forecast and reorder lines are unchanged; the Schedule page shows two weeks.
- **Equipment:** a short list per department (§6.5.3), no history of its own.
- **Series API:** one new read-only module, `server/src/ledger/series.ts` (the seed history that feeds it is `server/src/seed/history.ts`), turns the ledger into the series the charts draw: stock by day per material and plant (from lot events), batches per week with yield and waste, spend by month and category (from POs), QC decisions by month. Served at `GET /api/history` and written into the static snapshot by `npm run web:data`. Tests pin each series against hand-computed figures from the seed (as `books.test.ts` does).

### 6.8 What is cut, and why

| Cut | Why | What stands in |
|---|---|---|
| Personnel zones and utilities layers on the twin | no data behind them; a painted layer is a stub | the four layers in §6.5.6 |
| Equipment maintenance history | would need an invented work-order ledger nothing else uses | equipment rows with status and current batch |
| "Pick your ERP system" | one connector exists; a dropdown with one entry is a stub | the connection card names the system |
| A separate "ways to buy" flow | the run already buys; a second path would duplicate it | Purchasing › Effects shows what a buy changed |
| Pages for Riverside and Lakeview with their own runs | one recorded run; their pages read the same ledger with less in them | the plant picker, which says what each plant has |
| New particles, bloom, HDRI | offline rule, draw-call budget (TWIN3D.md idea 11) | glass materials, edge glow, ground rings |
| Rebuilding the video page's layout | the beats and clock are checked and the video is recorded after the merge | the video page takes the tokens and the Kevin panel only |

If the schedule slips, the order of further cuts is: Sealed bids and Group purchasing become links to the map's group run and the round file (one day back); the Schedule page keeps its strip and loses the budget chart (half a day); the twin keeps glass and clicking and loses layers (half a day); the rooms re-model waits for v3.

### 6.9 Build order

Each step ends committed with `npm run check`, `demo`, `demo:group`, `sealed`, `test:attacks`, `web:data -- --check`, `web:shot`, `web:shot:3d` and `host:build` green; the two screenshot scripts get the new page parameter and the sidebar's selectors.

| Date | Step | Done when |
|---|---|---|
| **Oct 30** | Seed history (§6.7), `history.ts` with tests, `GET /api/history`, `/api/forecast`, `/api/schedule`; the snapshot export carries them | `npm run demo` prints the same lines; `books`, `erp:reconcile` unchanged; the series tests pass |
| **Oct 31** | Tokens v2, the shell (sidebar, picker, header, trust marker), `charts.tsx`, number card, chart card, activity feed; Overview with the flat map in its centre | Overview live and static, wide and phone, 0 console errors |
| **Nov 1** | The Kevin panel and the review sheet; the batch-record check (scan beside the table, flags); the PO draft; Tommy's and Priya's sheets | the run clicks through from Overview with every confirm going through a sheet; transcript unchanged |
| **Nov 2** | Batch records, Inventory & forecast (three tabs, the stock line), 5am brief | the three pages on both sources |
| **Nov 3** | Schedule, Purchasing (three tabs), Invoices | the pages; the held invoice in its sheet |
| **Nov 4** | Spreadsheets (the wizard in the sheet), Three plants, ERP connection (with the proxy and the recorded views) | the pages; `npm run erp` beside the API shows live bills |
| **Nov 5** | HQ: the six pages, the plain-words limit change, the credentials and sealed-round exports | HQ pages on both sources; `web:data -- --check` green |
| **Nov 6** | Twin: the site plan in `layout.ts` (footprints per building and zone, three plants) and the building kit in `buildings.ts` (hall with sawtooth bays, warehouse with docks and canopy, office, lab, utilities, gatehouse, trees, trucks, roads); the flat map on the same footprints; shots refitted | `web:shot:3d` 0 label problems, under 90 draw calls, both runs; `scene.test.ts` green |
| **Nov 7** | Twin: glass materials, edge glow, lit windows, rings, the layer bar, zoom and fit buttons; click to the area sheet, equipment rows, activity pings; the Plant map page | every building and bay opens its sheet with ledger data |
| **Nov 8** | The hall's bays after the rooms image if it has arrived; the curtain rail on the tokens; the video page on the shell | `?video=1` plays every beat on the fixed clock at 1080p |
| **Nov 9** | Phone pass on every page, dark theme, README screenshot list, `host:build`, the clean-clone script, UI_DESIGN.md §10 "what v2 built" | all checks green; the branch rebased on main |
| **Nov 10** | Merge | PLAN.md's "In progress" line removed; the main session told |

Buffer: Nov 8 is a half day and Nov 9 is a check day; a slip of more than a day takes the cuts in §6.8 in order.

### 6.10 Mockups

`docs/v2/mockups/` (static HTML on the v2 tokens; screenshots in `shots/`, 1440 px light):

- `overview.html`: the sidebar, the header, four number cards with sparklines, the glass twin in the centre (drawn as an SVG sketch of the look: the real one is three.js), recent batches, the Kevin panel with BR-B-1045 and Live activity on the right, yield and spend charts below.
- `batch-record-check.html`: the review sheet open over Batch records: BR-B-1046's scan beside Kevin's table with the smudged quantity flagged and Ray's answer box.
- `inventory.html`: Inventory & forecast with the stock line for ascorbic acid (722.35 → 310.00 kg, the 500 kg reorder rule, the two planned draws dotted ahead), the materials donut and the status table.
- `site-plan.html`: the twin as a site plan (added after Tony's note on the boxes): gate, office, processing hall with four bays, QC lab, warehouse with docks, utilities yard, roads, trucks and trees, in frosted glass with status glow. The Overview mockup's centre card still shows the old grid; the site plan replaces it in the build.

### 6.11 For Tony

1. **The rooms image** for the twin is not in `C:\Dev\day-one-refs\`. Nov 8 is held for it; without it the departments keep their current shapes in glass.
2. **Approve §6 as written, or say what to change.** The build starts on the seed and the shell the moment this thread says go.

### 6.12 The bigger build (Tony, Oct 29, late evening)

Tony's second note, after the site plan: a larger plant with named areas, about ten products with their own raw materials and schedules, production trends and the plant's numbers integrated from the ERP, and above all a **realistic integration program** that walks an employee from the slow, repetitive way to the automated way, rather than a button that loads a few messages. "The current setup looks basic and doesn't display the capabilities." This section replaces §6.2–§6.9 where they differ; the design system (§6.3), Kevin's pattern (§6.4) and the glass look (§6.5) stand. Sketches: `docs/v2/mockups/plant-large.html` and `journey.html`, screenshots in `shots/`.

#### 6.12.1 The plant

One site, five buildings, twenty areas (as built Oct 30: `DEPARTMENTS` in `server/src/ledger/schema.ts`, migration 0010). Every area is a row in the ledger's `departments` table (the enum grows from nine codes to twenty, grouped by building), so lots, batches, events, status and the twin's zones all key on the same list.

| Building | Areas (ledger codes) | What happens there |
|---|---|---|
| **Warehouse** (the large one, back of the site, docks on both yards) | `receiving` (with the docks), `quarantine`, `rm_storage` (raw material racking), `pkg_storage` (bottles, caps, cartons, labels, shippers), `fg_storage` (finished goods), `shipping` | Trucks in, slips checked, lots into the quarantine cage until QC releases them, then to racking; packaging components on their own racking; finished pallets out |
| **Processing** (middle, the sawtooth roof) | `rm_staging` (the dispensary store), `weigh_cells` (four weigh-out cells, W1–W4), `formulation` (three blending suites, B1–B3), `tableting` (presses T1–T3 and the capsule filler C1), `bulk_hold` (in-process hold until QC passes the blend) | Raw material staged per batch, weighed in cells, blended, compressed or encapsulated, held in bulk |
| **Dry side** (front right, the packaging hall) | `bottling` (two lines: count, fill, cap, induction seal), `labeling`, `cartoning` (cartons, case packing), `palletizing`, `powder_fill` (the canister line for powders) | Bulk becomes bottles, canisters, cartons and pallets, then finished goods storage |
| **QC lab** | `qc_lab` | Incoming tests, in-process checks, release |
| **Office** | `purchasing`, `planning`, `accounting` | Kevin's desk, the schedule, the books |

The utilities yard is drawn on the site but is not a ledger area: nothing in the ledger knows steam or air, so it carries no status. Riverside has the same buildings at two thirds the size and no powder line; Lakeview is the warehouse, the dry side and the office only (it packages for the others). The flat map and the twin draw the same footprints (`layout.ts`); each area is a clickable zone with its own glow; the hall's cells, suites and presses are the equipment rows in the area sheet (§6.5.3), lit when a batch is in them today.

#### 6.12.2 Ten products, their materials, their rhythm

All fictional, all solid dose, generic names. Each product has a formula (per-unit quantities with overage, as today), a batch size, a plant, a cadence and a packaging bill (bottle or canister, cap, label, carton, shipper), so the schedule drives both raw materials and packaging.

| Code | Product | Form | Plant | Batch | Cadence | Distinct actives |
|---|---|---|---|---|---|---|
| P-VC500 | Vitamin C 500 mg Chewable | chewable tablet | B | 800,000 | every two weeks | ascorbic acid (kept exactly as recorded) |
| P-CMD | Cal-Mag + D3 Tablet | tablet | B, A (from Oct) | 500,000 | monthly at B, every two weeks at A | calcium carbonate, magnesium oxide, D3 |
| P-ELX | Electrolyte Effervescent | effervescent tablet | B | 300,000 | weekly to Sep, then every one to two weeks | citric acid, bicarbonate, potassium citrate |
| P-MG100 | Magnesium Glycinate 100 mg | tablet | A | 400,000 | weekly, every two weeks from Oct | magnesium bisglycinate |
| P-ZN50 | Zinc 50 mg | tablet | B | 600,000 | monthly | zinc gluconate |
| P-BCX | B-Complex | tablet | A | 500,000 | every two weeks | B-vitamin premix |
| P-MEL5 | Melatonin 5 mg | tablet | B | 1,000,000 | monthly | melatonin |
| P-D3K | Vitamin D3 2,000 IU | tablet | A | 1,000,000 | every two weeks | D3 beadlet (shared with CMD) |
| P-PRO | Probiotic 10B Capsule | capsule (C1) | B | 300,000 | every two weeks | probiotic blend, capsule shells |
| P-FBR | Fiber Powder Canister | powder (powder line) | B | 6,000 canisters of 300 g | every two weeks | psyllium husk |

Shared excipients across most of them: MCC, magnesium stearate, croscarmellose, stearic acid, silica, dicalcium phosphate (new), sorbitol and flavors for the chewable and the effervescent. Packaging shared by family: the 150 cc bottle and cap serve five products; labels are per product; cartons and shippers are shared. As built: 54 materials and 18 vendors (premix, melatonin, probiotic, capsule-shell, psyllium and carton suppliers), all qualified; the on-chain credential story (revoked, lapsed, suspended) is unchanged. The history and plan are generated by `server/src/seed/production.ts` (FICTIONAL_DATA §17).

**The invariant that keeps the recording valid.** The recorded run's chain calls are PO-1041 and PO-1042 and the record anchors; they do not depend on the catalogue. Kevin's forecast and purchasing steps are code, not recorded, so the expanded seed must leave, at the demo clock and inside the ten-day horizon at Hollow Pine, exactly the shortfalls the run has today: ascorbic acid (the 700 kg order) and the two lab chemicals (PO-1041). Every other material's opening stock and schedule are sized so it stays at or above its reorder point through the horizon; the other products' next batches sit at day 11 or later, or draw materials that are in stock. The seed's tests pin this ("only ASC, ACN and BUF short at the clock"), and `npm run demo`, `demo:group` and `test:attacks` replay unchanged. The "Load seed" counts change (wording only, `--accept`). If a later decision breaks the invariant on purpose, the cost is one re-record on testnet (the Oct 29 sequence, about half a day with Tony's keychain), which is listed, not hidden.

#### 6.12.3 The integration program: Day One as a guided cutover

This is the spine of v2 and the thing judges and buyers see first. The home screen is no longer "Floor": it is **Your integration**, a program of seven stages with a progress bar, and each stage is a real piece of the plant's work moved from the old way to the new one. The person does the work, with Kevin reading, showing and asking (§6.4); nothing loads by itself, and nothing posts until a person confirms. A stage is "done" when the ledger says so (the records are confirmed, the import is posted, the PO is paid), not when a button was pressed.

| Stage | The old way (shown, not told) | With Kevin (what the person actually does) | Done when | What exists today |
|---|---|---|---|---|
| **0 · Meet Kevin** | A one-screen picture of Hollow Pine's day: the paper batch record, the inventory workbook with its "v7 USE THIS ONE" name, the re-keying into the acquirer's ERP, the e-mailed POs, the paper invoice | Who you are (Ray, Linda, Tommy, Priya, Marcy), what the next six stages do, the trust marker explained in one line | first stage opened | new (one screen) |
| **1 · Your spreadsheets** | Ray's inventory workbook and its sales tab as they are | Drop the workbook; Kevin reads it, lists the 9 rows that need an answer; Ray answers row by row; Kevin posts the opening stock. Then the vendor list sheet and the open-POs sheet the same way | opening stock, vendors and open POs posted | the import wizard, extended with two sheet kinds (vendors, open POs: new fixtures in `data/imports/`) |
| **2 · Your paper** | A stack of batch records, the binder, Marcy's 40-minute re-key per record | Drop the scans (the watched folder, or the seven rendered records one by one); Kevin reads each, shows what he read beside the scan, asks where he is unsure (BR-B-1046); Ray confirms; the yield history builds as they land | the seven rendered records confirmed, history keyed in | the inbox and confirm routes, the review sheet |
| **3 · Your products and schedule** | The whiteboard schedule and the formula sheets | Kevin lists the ten products and their formulas as read from the records and the sheets; Linda confirms each; Kevin lays out the next four weeks from the cadences and Linda moves what is wrong; the forecast appears for the first time | the plan confirmed, the forecast computed | new: `/api/schedule` and a confirm route; formulas are in the seed |
| **4 · Your suppliers and spend rules** | The vendor binder, the "call Linda for anything over $2,500" rule in someone's head | Jordan (HQ) sees the vendor list Kevin read, approves standing per supplier (issued, conditional, not listed); Linda sets Kevin's limits in plain words and sees the contract's reading back | limits and standing read back from the contract | `npm run policy` flow, the credentials data; on the static host the changes are the recorded ones |
| **5 · Your first order** | An e-mailed PO, a phone call for approval, a cheque | The recorded run: forecast, quotes, PO-1041 funded, PO-1042 refused and approved by text, shipped, received, quarantined, released, paid; each person's step on their own screen | PO-1042 paid | the run as it is |
| **6 · Your books and the ERP** | Re-keying bills into the ERP, matching by hand | Marcy sees the settled POs matched to receipts, the held invoice with its reasons, the CSV; the ERP connection shows what crossed and the seven reconciliation checks | reconciliation 7 of 7 | Books, the held invoice, the ERP views |
| **7 · Day to day** | — | The 5am brief, the plant map, the trends: the program as it runs from here | — | the pages |

Each stage's screen has the same shape (mockup `journey.html`): the stage list on the left with progress, the stage's title and one sentence, a **"How it is done today"** panel with the real artifact (the workbook, the scan, the binder) and a short plain description, the **"With Kevin"** panel where the work happens (the review sheet opens from it), and a running tally at the bottom read from the ledger: rows read, questions asked, records confirmed, discrepancies found, orders placed, refused by the rules. No invented time savings; the counts are what the ledger holds.

The journey is also the replay for judges: on the hosted demo "Play" walks the seven stages with the recorded answers, each stage saying "recorded" in its footer. Live (`npm run api`), the person does every step; `npm run api:live` lets Kevin read live. The person's progress is in the ledger (a `journey` table: stage, status, who, when), so the API and the static snapshot serve the same shape.

#### 6.12.4 Trends and the ERP's numbers

Trends, all from the ledger series of §6.7 (`history.ts`), now per product: output per week by product (stacked bars, 16 weeks), yield by batch per product (lines), waste by product (bars), schedule adherence (planned vs completed per week), stock cover in days for the top materials, spend by month and category against the caps, QC decisions by month. The ERP's numbers come into Day One through the connector's read side (`GET /api/erp/*` proxies when `npm run erp` is up; the recorded views on the static host): inventory value by category, bills by state, payments, the trial balance's headline, cost per bottle from the ERP's standard costs. They sit on the Overview (inventory value, bills to pay), Purchasing (what the ERP has for each PO), Invoices (every bill with its match) and ERP connection (what crossed, the reconciliation). The ERP seed grows with the products (its item and vendor masters are built from Day One's seed by `erp:seed`, so the cutover stays one command).

#### 6.12.5 Schedule: the whole of §6.12, by the real pace

**Decision (Tony, Oct 30 in the v2 chat):** build all of §6.12; the first estimate (14 days) was in human-days, and the repo's own record says otherwise (164 commits on Oct 28–29, the original 14-day plan done in about a day). Products and areas as listed in §6.12.1–2. The two-option split and its cut list are withdrawn; nothing in §6.6 is cut except what §6.8 already cut for having no data behind it.

Build order, each step committed with the checks green, sized in build sessions rather than days:

| Step | What | Done when |
|---|---|---|
| 1 | **Seed**: twenty areas (schema enum and migration), ~52 materials, ten products with formulas and packaging bills, vendors, 120 days of history across three plants, four-week schedules; the invariant tests; `erp:seed` from the new masters | `npm run demo`, `demo:group`, `test:attacks`, `erp:reconcile` replay unchanged apart from the seed counts |
| 2 | **Series and reads**: `server/src/ledger/series.ts` and `GET /api/history`, `/api/history/stock`; `agents/kevin/src/schedule.ts` and `/api/forecast`, `/api/schedule`; the static snapshot carries them in `web/src/data/series.json` (done Oct 30; the journey table moved to step 4 and the ERP read proxies to step 5, where they are used) | series tests against hand-computed figures |
| 3 | **Shell and design system**: tokens v2, sidebar, picker, header, charts module, number and chart cards, activity feed, review sheet, Kevin panel | Overview live and static, wide and phone |
| 4 | **The integration program**: the seven stage screens, progress from the ledger, the two new sheet kinds, the schedule confirm, the limits stage, the replay | a person can walk stages 0–7 live; the static host plays them recorded |
| 5 | **Pages**: Batch records, Inventory & forecast, Schedule, Purchasing, Invoices, Spreadsheets, 5am brief, Three plants, ERP connection, the six HQ pages, with trends (done Oct 30: the plant tables from `server/src/ledger/views.ts` at `GET /api/plant`, the static snapshot in `web/src/data/pages.json`; the ERP's numbers come from the recorded run with the ERP attached, `npm run erp:demo -- --json`, in both modes, so the live `/api/erp/*` proxies were not needed; Books became Invoices and Bookkeeper export) | every page on both sources |
| 6 | **Twin**: the large plant in `layout.ts` and `buildings.ts`, glass, zones, click to the area sheet, equipment rows, pings, layers, the Plant map page; the flat map on the same footprints (done Oct 30, docs/TWIN3D.md "The site plan": glass transmission and pad clicks not built, said there) | `web:shot:3d` 0 label problems, both runs |
| 7 | **Finish**: video page on the shell, phone and dark passes, screenshots, README screenshot list, `host:build`, the clean clone (done Oct 30: the video page plays on the new twin unchanged, as §6.8 planned; screens in `docs/v2/after/`, list in §6.12.7) | all checks green; merge |

Target: steps 1–4 by Nov 3, 5–7 by Nov 6, merged by Nov 7. Nov 8–10 stay as buffer and for the video storyboard rewrite (main session). If a step runs long, the order above is also the order of importance.

#### 6.12.7 Screens for the README after the merge

Taken with `npm run web:shot` (`PAGE=<id>`, wide light and phone dark, curtain on) and `npm run web:shot:3d` from the static build, in `docs/v2/after/`. Worth putting in the README in place of the Floor shots (UI_DESIGN.md "For the README"):

- `integration/wide.png`: the integration program, the first thing a plant sees.
- `overview/wide.png` and `phone.png`: the Overview mid-run, with the curtain's transactions beside it.
- `map-3d/wide.png`: the site plan in 3D on the Plant map page.
- `twin/wide-07-refused.png` and `twin/wide-11-quarantine.png`: the refusal at the vault, the pallet in its cage.
- `purchasing/wide.png`, `inventory/wide.png`, `docs/v2/after/erp/wide.png`, `suppliers/wide.png`: the pages with history behind them.

Done Oct 30 (unattended run, after the merge): the README carries seven v2 screens, taken with `CURTAIN=0` where staff would see the page and live (`URL=`) where the buttons matter: `map-3d/wide-staff.png` (the site plan at the refusal, in place of the twin crop), `overview/wide-linda-live.png` and `phone-linda-live.png` (Linda's turn, in place of the Floor shots), `overview/wide-end-curtain-live.png` (the end of the run behind the curtain), `integration/wide-staff.png` (the home page), `plants/wide-live.png` (Three plants with its Approve and Dismiss buttons, in place of the Plants shot) and `purchasing/wide-staff.png`. The README's screen wording names the sidebar's pages.

#### 6.12.6 Still open

- **The rooms image** shapes the inside of the processing building when it arrives; step 6 builds the zones either way.
