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
- **Series API:** one new read-only module, `server/src/ledger/history.ts`, turns the ledger into the series the charts draw: stock by day per material and plant (from lot events), batches per week with yield and waste, spend by month and category (from POs), QC decisions by month. Served at `GET /api/history` and written into the static snapshot by `npm run web:data`. Tests pin each series against hand-computed figures from the seed (as `books.test.ts` does).

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
