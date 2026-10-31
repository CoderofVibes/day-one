# Day One: the "make it feel alive" upgrade

**Handoff brief for Claude, from Anthony (team DadMod). Paste this whole document as your instructions. No images are needed: every visual direction is written out in words.**

---

## 0. Read this first

### 0.1 What you're working on

You built Day One. It's Kevin, an AI purchasing and inventory assistant that an acquirer deploys on day one of owning a small manufacturing plant. The tagline is **"He does the paperwork. You run the plant."** Money moves on NEAR rails:

- a spend-policy contract
- escrow released on QC
- anchored record hashes
- NEP-393 soulbound supplier credentials
- sealed bids and group buys
- NEAR AI Cloud TEE-attested answers, with a labeled Anthropic fallback

A mock NetSuite-shaped ERP ("Acme Holdings ERP") owns the vendor master, bills, the approval matrix and the GL. Plant staff never see a wallet, token or gas. Judges and auditors see every chain event behind the curtain.

The v2 interface merged on Oct 30, 2026. The proof points work and are recorded on NEAR testnet:

| Proof point | What must stay true |
|---|---|
| Attack suite | **15 of 15** attempted abuses refused by the contract, including the "new bank details" payment-redirect email |
| PO-1042 | **$5,150.00** (700 kg ascorbic acid at $7.10/kg + $180 freight) from Northgate Ingredients. The contract refuses it for exceeding the **$2,500 per-PO limit**, ops director **Linda Park** approves by text ("Reply YES 1042 or NO 1042"), and it's paid on QC release of lot **ASC-261116-01** |
| Group buy | **PO-G-2001, $9,490**, paid across plants |
| Reconciliation | **7 of 7** checks agree between Day One and the ERP |
| Real stablecoin | **PO-1047, $19.00**, paid in real Circle testnet USDC |
| Tests | **577** automated tests green. The TEE attestation was re-verified after recording |

### 0.2 Why this upgrade

Anthony's honest read, which I agree with: **Day One shows that Kevin works, but it doesn't yet feel like a living plant.**

- Most screens are white cards with one number and one sentence.
- The data covers about four weeks at one plant.
- The "Behind the curtain · NEAR testnet" panel says **"0 transactions / No transactions yet."** on most pages, including ERP connection, Purchasing and Your integration.
- The 3D plant map is a small, mostly static card.

The bones are excellent. The job now is to make Day One **alive** (time and motion), **deep** (a believable 12-month, three-plant world with real money depth) and **hands-on** (judges can poke it).

You have until **Nov 14, 2026, 3:59 PM PST**. The repo goes public on Nov 13. Do all of this in **one run**, working through the milestones in §6.2 in order.

### 0.3 How to read this document

- **I haven't seen your repo.** This brief comes from Anthony's executive summary and his screenshots of the current app. Every time I name a component, page, store or function, read it as **"find the existing X and extend it"**, never "create a file at this path."
  - Use the architecture, naming, state management, styling approach and test framework the repo already has.
  - Where I say "probably react-three-fiber" or "probably a fixtures module," check first and follow what's actually there.
  - If something I describe already exists, extend it. Don't duplicate it.
- **There are no reference images.** Every visual direction is written out in this brief (mood, hierarchy, composition, tone). Treat those descriptions as direction, not pixel specs, and design within the existing brand anchors (§5). Any example figures in a visual description are illustrative; all real numbers come from the data (§2).
- **Section order = build order**, except where §6.1 says otherwise. §4 (3D twin) and §5 (UI) are the longest because they need the most guidance.
- The **"Don't break"** lists in each section are hard constraints.

### 0.4 Hard guardrails (apply everywhere)

1. **Testnet only. Fictional data only.** All companies, people, lots and numbers are fictional: Hollow Pine Tablet Co., Acme Riverside, Acme Lakeview, Acme HQ / Acme Holdings, Northgate Ingredients, QuickChem Direct, Ridgeway Ascorbics, BLS Bayfront Lab Supply, Pacific Excipient Co., Sierra Mineral Supply, Orchard Flavor House, Fennimore Polyols, plus Ray Delgado, Linda Park, Marcy Allen, Priya Natarajan and Kevin. Any new names (customers, carriers) must be obviously fictional and generic. Don't use real company or person data.
2. **No compliance claims.** Don't say "GMP compliant," "FDA compliant," "21 CFR Part 11," "SOX," "audit-ready" or anything similar. The approved phrase is **"audit-friendly records."** Recall features are a **"mock supplier recall notice"** and a **"trace,"** not a regulatory recall process.
3. **Don't break the proof points.** Every record, ID, amount, date, signer, tx hash and explorer link behind the six proof points must stay byte-for-byte identical. Add a test that proves this (§2.1.11).
4. **Don't redeploy or change the contracts** unless it's truly unavoidable. Everything here can be built on top of the existing contract methods (`submit_po`, `approve_po`, `accept_po`, `mark_shipped`, `confirm_receipt`, `anchor`, `anchor_batch`, and whatever else exists). If you think a contract change is needed, stop, write it up in the final report and build the UI against the recorded data instead.
5. **The chain stays invisible to staff and visible to judges.** Staff-facing screens show no wallets, tokens, gas, hashes or crypto terms, only plants, inventory, orders and dollars. Chain detail lives behind the curtain toggle, in the 3D curtain layer, in judge mode and in the attack arena.
6. **Keep all 577 tests green** throughout. Add tests as you go (targets in §2.1.11 and §6.6).
7. **Determinism.** Everything generated or simulated is seeded and reproducible. The same seed gives the same world every time, on every machine.
8. **The golden run always works.** The recorded run from 2026-10-29 that drives the proof points is sacred. Lock it as a deterministic demo path (§6.3) and keep it working through every milestone.
9. **No agent-to-agent negotiation.** Anthony explicitly dropped it. Don't build haggling between Kevin and supplier agents, negotiation transcripts or counter-offer loops. The existing quotes from simulated supplier agents and the sealed-bid flow stay as they are. Kevin compares quotes and picks; he doesn't haggle.
10. **Secrets never reach the browser.** Any live testnet call (attack arena "live" mode, Talk to Kevin attestation) goes through the existing server-side relayer path (`dayone-relayer.testnet` pays gas today). Never ship a private key to the client.

### 0.5 Names and IDs already visible in the app (reuse them exactly)

- **Plants**
  - Hollow Pine Tablet Co. ("Plant B · joining Acme," 4 of 9 departments online)
  - Acme Riverside, which has the "115.199 kg unaccounted" mass-balance flag
  - Acme Lakeview
  - Acme HQ ("budget")
  - The Escrow, shown as "$612.00 held"
- **People**
  - Ray Delgado, Purchaser
  - Linda Park, Ops director
  - Marcy Allen, Accounting
  - Priya Natarajan, QC
- **Batches**
  - BR-B-1045, Vitamin C 500 mg Chewable (726,400 units, 90.8% yield, 92 kg waste)
  - BP-B-0509, Fiber Powder Canister
  - BC-B-0309, Probiotic 10B Capsule
  - BR-B-1046
- **Lots:** ASC-261116-01, BTL-260905-01, CAC-261014-01, CAP-260905-01, LCM-260907-01. The pattern is `MAT-YYMMDD-NN`.
- **Material codes:** ASC (ascorbic acid), CAC (calcium carbonate), BTL (150 cc HDPE bottle), CAP (38 mm CR cap with induction liner), LCM (label, CMD)
- **POs:** PO-1035 … PO-1047, PO-G-2001
- **ERP records:** RFQ-2611-01, ADJ-515, IR-35, NG-INV-24190, "matrix rule 4"
- **Testnet accounts:** kevin.plant-b.acme-holdings.testnet, director.plant-b.acme…, receiving.plant-b.acme…, dayone-relayer.testnet, northgate-ingredients.testnet, quickchem-direct.testnet, ridgeway-ascorbics.testnet
- **Budgets and limits**
  - Spend-policy budget: 25,000.00 DTUSD
  - "Kevin may commit $60,000.00 a month"
  - Per-PO limit: $2,500
- **ERP connection stats**
  - 34 POs and 34 receipts brought over at cutover
  - 35 of 36 bills matched
  - 7 of 7 reconciliation checks
- **Current nav**
  - PLANT: Your integration, Overview, Plant map, 5am brief, Batch records, Inventory & forecast, Schedule, Purchasing, Invoices, Spreadsheets
  - ACROSS ACME: Three plants, ERP connection
  - ACME HQ: Spending limits, Suppliers, Group purchasing, Sealed bids, Bookkeeper export, Reconciliation
  - The sidebar footer has the "Protected · Behind the curtain" toggle and a persona card ("Ray Delgado · Purchaser · up next").

Before you start, find where each of these is defined in the repo, and note in your final report any I've got wrong.

---

## 1. A living plant: time and motion

**Goal:** when someone opens Day One, the plant is *running*. Trucks arrive, batches run, lots move from quarantine to released, stock drains and Kevin reacts. Every screen agrees with every other screen because one clock drives them all.

### 1.1 The simulation clock

**What it is:** a single, app-wide simulated clock. It's the only source of "now" for every screen, the 3D twin, the curtain panel, the activity feed and Talk to Kevin.

**Find first:** how the app handles "now" today. The Overview says "Live," the Plant map says "Replay of a run recorded on 2026-10-29," and the "Up next" / "The run so far" step player exists (with "Start over"). There is probably a run or step player that walks through the recorded steps. **The new clock should absorb that step player, not compete with it.** The recorded run becomes a stretch of time on the clock, and its steps become scheduled events at fixed sim timestamps.

**Spec:**

- **State**
  - `simNow`, an ISO timestamp in the plant's local time zone
  - `speed` ∈ {paused, 1×, 10×, 100×}, plus an internal "jump" mode used by seek
  - `seed`
  - `mode` ∈ {`history` (scrubbing the 12-month past), `golden` (the recorded run window), `live` (the deterministic continuation after the golden run)}
- **Speeds**
  - 1× means 1 sim minute per real second. That reads as "real time" for a demo, and real wall-clock time would be too slow to show anything.
  - 10× means 10 sim minutes per second.
  - 100× means about 1.7 sim hours per second, which covers a week in under two minutes.
  - Put the exact mapping in one config constant.
- **Controls** (global header, see §5.3)
  - play/pause
  - speed chips
  - a date-time readout ("Mon Nov 9 · 6:42 AM")
  - a **scrubber/timeline popover** with the 12-month range, incident markers, and the golden-run window highlighted
  - "Jump to…" presets: *Today 5 AM*, *Golden run start*, *PO-1042 refusal*, *Linda's approval*, *QC release of ASC-261116-01*, *PO-1047 USDC*, *Winter peak*, *Price hike*, *Failed QC lot*, *Recall notice*
- **Event engine**
  - All world changes are **events** with a sim timestamp, from the generator (§2) and from the golden run.
  - As `simNow` advances, the engine emits events in order to subscribers.
  - **Seeking** backward or forward recomputes state by folding events up to `simNow` from the nearest precomputed snapshot. Precompute a daily snapshot so seeks are O(events in one day), not O(year).
  - Event processing must be pure: `state' = reduce(state, event)`. That's what makes seek, replay and tests trivial.
- **Determinism**
  - The seed lives in config, with a default used for the demo, and appears in the URL as `?seed=` for debugging.
  - The same seed and the same sequence of user actions give the same world.
  - Any randomness during "live" continuation comes from a seeded PRNG keyed on `(seed, simDay, entityId)`, never `Math.random()`.
- **User actions vs. clock**
  - When a user approves a move (Three plants "Approve the move"), approves a PO, releases a lot and so on, that action becomes an event at the current `simNow`.
  - In the golden-run window, user actions follow the recorded script (the existing step player behavior).
  - In live mode, they're appended to a session event log. Offer a "Reset session" control that clears it and returns to the seed state.
- **Persistence:** store `simNow`, speed and the session log in URL and localStorage, so a reload lands where you were. Add "Reset to demo start" in the header overflow menu.
- **Performance**
  - At 100×, batch UI updates. Throttle React re-renders to about 10 Hz for numbers and tables. The 3D scene animates on its own frame loop and reads the clock directly (§4.9).
  - Never re-render the whole app per tick.

**UX behavior:**

- **First load** (and "Reset to demo start") opens at **5:00 AM on the golden-run day**, paused, with the dawn scene (§1.3) and the 5am brief. Pressing play starts the day.
- When paused, every number on every page is consistent with `simNow`.
- **Scrubbing into the past** shows the plant as it was. For example, during the January winter peak, Overview tiles show January's batches and yield, inventory shows January's stock, and the 3D racks show January's pallet counts.
- **Crossing into or out of the golden-run window** makes the header show a subtle "Recorded run" chip (cyan, chain-ish), because those events are backed by real testnet transactions. Outside it, show a "Simulated" chip. **Judges must always know what's recorded on chain versus simulated.**

**Acceptance criteria:**

- [ ] One clock module. Grepping for `Date.now()` / `new Date()` in UI and data code finds no remaining "now" calls except in the clock itself and in formatting utilities.
- [ ] Every page (Overview, Purchasing, Inventory, Three plants, ERP connection, Money, Suppliers, Lots, 3D twin, curtain panel, activity feed) updates when the clock advances and agrees after a seek.
- [ ] Seek to any day in the 12 months is under 150 ms on a laptop.
- [ ] Same seed gives an identical event stream. A test hashes the first N thousand events.
- [ ] The golden-run window replays exactly the recorded steps in order, with recorded tx hashes.
- [ ] Play at 100× for a simulated week without dropped frames in the UI (React profiler: no commit over 16 ms during steady play on the Overview).

**Don't break:** the existing step player's "Start over" and "Up next" semantics, or the recorded-run labeling ("Replay of a run recorded on 2026-10-29. All companies, people and numbers are fictional.").

### 1.2 Kevin's activity feed (persistent right rail)

**What it is:** a live, scrolling log of what Kevin is doing, in plain plant language. It should feel like a coworker narrating his shift, not a report. It lives in a right-hand rail on the Overview: a narrow column of timestamped, plain-language entries, newest at top, each with a small icon and status chip.

**Placement:**

- On desktop (≥1280 px) it's a persistent right rail, about 320 px, collapsible to a 48 px strip with an unread counter.
- It **shares the right column with the curtain panel.** With the curtain off, the rail shows Kevin's activity. With the curtain on, the rail splits: activity on top (40%) and chain transactions below (60%), or show both as tabs. Pick whichever reads better with the current curtain panel, which is today a dark column on the right.
- Below 1280 px it's a slide-over drawer opened from the Kevin status chip in the header.

**Event types and line templates** (all times in sim time; **bold** = a record link that opens the inspector, §5.8):

| Type | Icon / color | Example line |
|---|---|---|
| `read_record` | doc / neutral | "6:42 AM · Read batch record **BR-B-1046**, flagged **2.1 kg** over-consumption on lot **ASC-261116-01**" |
| `inventory_update` | box / neutral | "6:44 AM · Posted consumption: 9 lots, 1,000.492 kg, to **ADJ-515**" |
| `reorder_trigger` | bell / amber | "6:51 AM · Ascorbic acid will cross its reorder point in 6 days, including about 10% waste allowance" |
| `rfq_sent` | send / neutral | "6:52 AM · Asked 3 qualified suppliers for quotes, **RFQ-2611-01**" |
| `quote_received` | inbox / neutral | "7:10 AM · Northgate quoted $7.10/kg, 4-day lead. QuickChem Direct is out (credential suspended)" |
| `po_drafted` | cart / neutral | "7:12 AM · Drafted **PO-1042**, $5,150.00 for 700 kg ascorbic acid" |
| `po_refused` | shield / red | "7:12 AM · The spend policy refused **PO-1042**: over my $2,500 per-PO limit. Texted Linda." |
| `approval_requested` | phone / amber | "7:13 AM · Waiting on Linda Park: YES 1042 or NO 1042" |
| `approval_received` | check / green | "7:31 AM · Linda approved **PO-1042** by text" |
| `escrow_funded` | lock / gold | "7:31 AM · Funds for **PO-1042** set aside until QC release" |
| `truck_arrived` | truck / neutral | "Nov 13 · 9:05 AM · Northgate truck at the dock. 700 kg into quarantine as **ASC-261116-01**" |
| `qc_released` | flask / green | "Nov 13 · 2:20 PM · Priya released **ASC-261116-01**" |
| `escrow_released` / `paid` | coin / gold | "2:21 PM · Paid Northgate $5,150.00 for **PO-1042**: matched to PO, receipt and bill" |
| `anomaly` | alert / amber | "Duplicate invoice **NG-INV-24190** arrived twice, held the second copy" |
| `price_drift` | trend / amber | "Pacific Excipient billed $0.41/kg over the PO price on 2 lines" |
| `transfer_suggested` | arrows / blue | "Lakeview has 16,000 spare 150 cc bottles, so moving them saves about $336" |
| `credential_event` | badge / cyan | "QuickChem Direct suspended after 2 QC rejects in a row" |
| `attack_refused` | shield / red | "Refused a 'new bank details' change for Northgate: payout account doesn't match vendor master" |
| `brief_ready` | sun / gold | "5:00 AM · Your 5am brief is ready: 3 things need a person today" |

(Dates and amounts above are illustrative. Derive the real ones from the data, and for golden-run events, copy them from the recorded run.)

**Behavior:**

- New items slide in at the top (200 ms), with a 1 s highlight fade. At 100×, coalesce: "+14 routine updates" collapses into one expandable line, so the feed stays readable.
- **Filter chips:** All · Needs a person · Money · Quality · Chain (Chain only shows when the curtain is on).
- **Clicking a record** opens the inspector (ERP record plus, when the curtain is on, its on-chain tx). **Hovering an item** highlights the related object in the 3D twin if it's open.
- **"Needs a person" items** carry inline actions (Approve, Dismiss) that call the same handlers as the existing buttons on Three plants and Overview. **Don't duplicate logic.**
- **Kevin status chip** in the header mirrors the latest item: *idle · reading · drafting · waiting on Linda · paying · attested*. It has a soft pulse while Kevin is "working."
- Every feed item is derived from the event stream. The feed is a view, not a separate data source.
- **Copy voice:** first person, short, plain plant language, numbers with units, no crypto words unless the curtain filter is on.

**Acceptance:**

- [ ] The feed is identical for the same seed and time range.
- [ ] Every item links to at least one record.
- [ ] Golden-run items use the recorded text and IDs.
- [ ] The feed survives a 100× week without the DOM exceeding about 200 nodes (virtualize the list).

### 1.3 Dawn scene for the 5am brief

**What it is:** when the clock sits at the start of a day (default 5:00 AM), the Overview and the 5am brief page open on a calm dawn scene. A soft gradient sky warms from indigo to peach behind a small, simplified plant silhouette, or the 3D twin in "dawn" lighting if WebGL is available. Kevin's brief card sits on top: "Good morning, Ray. 3 things need a person today."

**Spec:**

- **Find the existing 5am brief and extend it.** Don't replace its content logic.
- **The brief has 3–5 bullet cards:**
  - needs-a-person items
  - what arrives today (trucks and lots)
  - what runs today (batches)
  - money today (bills due, escrow to release)
  - one "Kevin noticed" insight, such as a price drift or a transfer opportunity
- Each card has one big number and a one-line context, and links to the page or record.
- **Time-of-day lighting** is driven by `simNow`, in four keyframes (night, dawn, day, dusk), and is shared with the 3D twin (§4.5). The 2D version is a CSS gradient plus an SVG silhouette, so it works without WebGL.
- **When the clock plays past 6:00 AM,** the dawn fades to the normal day theme over about 2 s, and the brief collapses into a "Today" strip at the top of Overview.
- **`prefers-reduced-motion`:** no animated sky, just a static gradient.

**Acceptance:**

- [ ] Opening the app fresh shows the dawn plus the brief at 5:00 AM on the golden-run day.
- [ ] Brief numbers match the Overview tiles at the same `simNow`.
- [ ] It works with WebGL disabled.

---

## 2. Deeper data: make the plant believable

This is the section Anthony cares about most after the 3D twin. Today there are about four weeks of hand-authored data for one plant. **The goal is 12 months across all three plants, generated deterministically, with the existing recorded data sitting inside it untouched.** This is the hardest data-engineering part of the run, so I'm being very specific.

### 2.1 The 12-month history generator

#### 2.1.1 Principles

1. **Generated, not hand-written.** Write a deterministic, seeded generator that produces the world as event streams and ERP-shaped records. Don't hand-author thousands of fixtures.
2. **Anchors are sacred.** The existing four weeks (the golden run and everything the current screens show) become **fixed anchors**. The generator builds history *around* them and must never alter, renumber or re-date an anchor record.
3. **Physically consistent.** Mass balance holds per lot, per material and per plant. Money balances across PO → receipt → bill → payment. Stock never goes negative unless that's a named incident.
4. **Precomputed and committed.** Generation runs at build time, or as a script, and writes versioned output (JSON or a SQLite file, whichever the app already uses for data). The app loads precomputed data and doesn't generate a year in the browser on every load. A test regenerates it and checks the output hash matches what's committed.
5. **Explainable.** Every generated number traces back to a rule or parameter in one config file (`world.config`, whatever fits the repo's naming). That config is how anyone adjusts the world. Comment it well.

#### 2.1.2 The timeline and the story

Let **T0** be the day Kevin goes live at Hollow Pine, the start of the existing hand-authored window. Find the exact date in the current data. The visible dates suggest it's around **mid-October to early November 2026**: PO-1035 is Oct 1, PO-1042 is Nov 9, and the recorded run is dated 2026-10-29.

- **History window:** the 12 full months ending at the end of the golden-run window, roughly **Dec 2025 → Nov 2026**. Adjust so the golden run lands in the final month.
- **Hollow Pine (Plant B, being acquired):** everything before T0 is **legacy history**. It's what the plant ran on spreadsheets and paper, brought in through the existing **spreadsheet import wizard** and the ERP **cutover** ("34 purchase orders, with 34 receipts; none typed in"). Legacy data is deliberately a bit messier:
  - a duplicate invoice that got paid
  - price drift nobody caught
  - a January ascorbic-acid stockout fixed with expensive rush freight
  - over-ordering
  
  This is the "before Kevin" baseline.
- **Riverside and Lakeview (existing Acme plants):** the same 12 months, generated with the same engine and different parameters (size, product mix, a couple of their own incidents). **Check the existing copy:** if the app already implies these plants run Kevin, give them Kevin-era behavior for part of the year. If it doesn't, they're legacy too, and Kevin only runs from T0. Don't invent a story the existing screens contradict.
- **Kevin's look-back:** on Day One, Kevin reads the 12 months of history and **finds the leaks**: duplicate payments, price drift, waste above standard, rush freight, dead stock. Those become "identified" savings (§2.4.7). This is why a year of history matters to the pitch, not just to the visuals: it's how Kevin pays for himself in his first week.
- **Golden-run window:** unchanged, exactly as recorded.
- **Live continuation (after the golden run):** the same generator extends 4–6 weeks past the golden run, labeled **Simulated**, so the clock can keep playing and the plant keeps moving after the hero moments. Kevin's realized savings accrue here.

#### 2.1.3 Generator architecture (suggested; adapt to the repo)

```
world.config (params, seed)
  └─ calendar        → working days, shifts, holidays (fictional plant calendar), seasonality curves
  └─ demand          → monthly/weekly demand per finished product per plant (seasonal × trend × noise)
  └─ production plan → batches scheduled to meet demand within capacity (shifts × line rate)
  └─ BOM explosion   → material requirements per batch (+ standard waste ~10%, actual waste noisy)
  └─ inventory sim   → daily on-hand per material/lot; reorder point + safety stock logic
  └─ purchasing      → RFQs, quotes, supplier choice, POs (respect spend policy & limits)
  └─ logistics       → lead times, shipments, receipts (on-time/late/partial per supplier stats)
  └─ quality         → QC per received lot (pass/fail by supplier QC rate), quarantine→released/rejected
  └─ AP             → vendor bills (3-way match; injected anomalies), payment terms, payments
  └─ AR / shipments  → finished-goods lots, sales orders, fulfillments to fictional customers, invoices, receipts
  └─ incidents       → named, dated overrides applied on top (price hike, late shipment, failed QC, recall…)
  └─ anchors merge   → splice in existing hand-authored records; validate no conflict
  └─ derive          → snapshots, KPIs, money metrics, supplier scorecards, genealogy index
  └─ emit            → events stream + ERP-shaped tables + daily snapshots (+ hash)
```

Each stage is a pure function of `(config, seed, upstream outputs)`. Use a seeded PRNG (mulberry32, xoshiro or similar) with **sub-streams per stage and entity**, for example `rng("receipts", supplierId, month)`. That way, changing one stage's parameters doesn't reshuffle the randomness in unrelated stages. This matters a lot for keeping the world stable while you tune it.

#### 2.1.4 Entities and fields (ERP-shaped)

The mock ERP is "NetSuite-shaped," and existing records use NetSuite-like record types (`inventoryAdjustment`, `purchaseOrder`, `itemReceipt`, `vendorBill`). **Find the existing type definitions and extend them. Don't fork a parallel schema.** Target shapes (rename fields to match what exists):

- **Plant** `{ id, name, shortCode: "B" | …, departments[], shifts, timezone }`
- **Item / Material** `{ code: "ASC", name, uom: "kg" | "ea", category: "active" | "excipient" | "flavor" | "packaging" | "lab", standardCost, reorderPoint, safetyStock, shelfLifeDays, qualifiedSupplierIds[] }`
- **Product (finished good)** `{ sku, name: "Vitamin C 500 mg Chewable", form: "tablet" | "capsule" | "powder", bom: [{ materialCode, qtyPerUnit, uom }], lineRate, standardYield, seasonalityProfile }`
- **Supplier (vendor master)** `{ id, name, erpVendorId, testnetAccount?, paymentTerms: "Net 30", payoutAccountRef, credential: { status: "active" | "suspended" | "revoked", issuedAt, reputationScore }, materials: [{ code, basePrice, priceHistory[], leadTimeDays: { mean, sd }, onTimeRate, qcPassRate, minOrderQty }] }`
- **RFQ / Quote** `{ rfqId: "RFQ-2611-01", materialCode, qty, invited[], quotes: [{ supplierId, unitPrice, freight, leadTimeDays, status: "quoted" | "out" | "declined", reason? }], winnerId, method: "standard" | "sealed" }`
- **PurchaseOrder** `{ poNumber, plantId, supplierId, lines: [{ materialCode, qty, unitPrice }], freight, total, createdAt, approval: { rule: "matrix rule 4", path: "auto" | "director_text", approver?, at }, contractVerdict: "funded" | "refused" | "approved", txHashes?, state: "draft" | "refused" | "approved" | "funded" | "accepted" | "shipped" | "received" | "paid" | "cancelled", groupBuyId? }`
- **ItemReceipt** `{ irNumber: "IR-35", poNumber, receivedAt, lines: [{ materialCode, qty, lotId }], late: boolean, daysLate, partial: boolean }`
- **Lot** `{ lotId: "ASC-261116-01", materialCode, supplierId, supplierLotRef, receivedAt, qty, uom, state: "on_order" | "en_route" | "received" | "quarantine" | "released" | "in_use" | "consumed" | "wasted" | "rejected", qc: { testedBy, at, result, coaRef }, expiresAt, location: { plantId, zone, rack, slot } }`. These are the existing lifecycle states from the exec summary. Keep them exactly.
- **Batch (assembly build / work order)** `{ batchId: "BR-B-1045", sku, plantId, startedAt, endedAt, plannedUnits, actualUnits, yield, wasteKg, consumption: [{ lotId, qtyStd, qtyActual }], batchRecordRef, anchorTx? }`
- **FinishedGoodsLot** `{ fgLotId, batchId, sku, units, expiresAt, location }`
- **SalesOrder / Fulfillment (shipment)** `{ soNumber, customerId, lines[], shippedAt, fgLotIds[], carrier }`
- **Customer** (new, fictional) `{ id, name, terms }`. Use 6–10 obviously fictional distributors, e.g. "Cedar Lane Pharmacy Co-op," "Brightway Natural Grocers," "Summit Health Distributors." Check they're generic.
- **VendorBill** `{ billNumber: "NG-INV-24190", supplierId, poNumber, irNumber, amount, billDate, dueDate, match: "matched" | "price_variance" | "qty_variance" | "duplicate" | "unmatched", status: "open" | "approved" | "paid" | "held" }`
- **VendorPayment** `{ id, billNumbers[], amount, paidAt, rail: "escrow_release" | "erp_ach_mock" | "usdc_testnet", txHash? }`. Legacy payments are "erp_ach_mock" (not on chain). Kevin-era payments go through escrow. Only PO-1047 uses real Circle testnet USDC.
- **CustomerInvoice / Receipt** for AR and cash-in.
- **InventoryAdjustment** `{ adjNumber: "ADJ-515", reason: "consumption" | "count" | "waste" | "transfer", lines[] }`
- **Transfer** `{ id, fromPlant, toPlant, materialCode, lotId, qty, value, suggestedAt, approvedAt? }`
- **GroupBuy** `{ id: "PO-G-2001", plants[], materialCode, totalQty, total, perPlantAllocation[] }`
- **ChainEvent** `{ txHash, method, signer, gasPayer?, events[], verdict: "ok" | "refused", reason?, explorerUrl, recorded: boolean }`. **Generated (simulated) history never invents fake tx hashes.** Only recorded testnet transactions have hashes. Simulated chain-relevant events show "Simulated · would anchor" in the curtain, in a distinct style (§5.7).
- **Incident** `{ id, type, title, startsAt, endsAt?, affected: { suppliers[], materials[], lots[], plants[] }, narrative }`

#### 2.1.5 Volume targets (rough, so the world feels real but stays fast)

Calibrate to what exists. The Overview shows **8 batches in the last 4 weeks** at Hollow Pine, and Purchasing shows **35 orders**. That's a small plant.

| Per plant per month | Hollow Pine | Riverside | Lakeview |
|---|---|---|---|
| Finished products (SKUs) | 10 (existing "Ten products") | 8 | 12 |
| Batches | 7–10 (winter up to 13) | 6–9 | 10–14 |
| Raw/pack materials tracked | ~25–35 | ~20–30 | ~30–40 |
| RFQs | 3–6 | 3–5 | 4–7 |
| POs | 8–14 | 7–12 | 10–16 |
| Receipts | ~1.1 × POs (partials) | ″ | ″ |
| Lots received | 12–25 | 10–20 | 15–30 |
| Vendor bills | ≈ receipts (+ injected anomalies) | ″ | ″ |
| Shipments to customers | 15–30 | 12–25 | 20–35 |
| Spend | $20k–$45k (winter higher) | $18k–$40k | $25k–$55k |

**Year totals across three plants**, roughly:

- 330–420 POs
- 400–480 receipts
- 600–800 lots
- 300–400 batches
- 600–900 shipments

That's plenty to look deep and small enough to keep everything in memory (under about 15 MB JSON, or use SQLite or IndexedDB if the app already uses them).

**PO numbering:** existing POs are PO-1035 … PO-1047, and the cutover brought over 34. **Don't let generated POs collide with or shift existing numbers.** Recommended:

- Hollow Pine legacy POs use a **legacy prefix** from the old spreadsheets, e.g. `HP-PO-0001…` (or whatever the spreadsheet import already uses). The cutover maps the last 34 of them to the existing PO-10xx numbers if that's how the import works today.
- Kevin-era POs after the golden run continue from the highest existing number (PO-1048+).
- Riverside and Lakeview get their own sequences (e.g. `PO-R-…`, `PO-L-…`).

**Check how the existing ID scheme works** (e.g. `BR-B-` / `BP-B-` / `BC-B-` look like product family + plant letter + sequence) and extend it consistently.

#### 2.1.6 Seasonality, trends and noise

Make demand **shaped**, not random:

- **Vitamin C 500 mg Chewable:** a winter peak, about ×1.45 Dec–Feb versus summer. It rises from mid-October and peaks in January.
- **Fiber Powder Canister:** a sharp January "new year" bump (×1.3) that fades by March.
- **Probiotic 10B Capsule:** mostly flat, with slow growth (+1%/month).
- **Other SKUs:** give each one of a few profiles (flat, winter, summer such as electrolytes or hydration, back-to-school).
- **Noise:** weekly multiplicative noise of ±8%, seeded.
- **Production** follows demand with a lag (a build-ahead of 2–3 weeks before the peak). That drives **raw-material demand spikes for ASC (ascorbic acid) in Oct–Dec**. This is how the winter story shows up in purchasing, inventory, cash flow and the 3D warehouse.
- **Yields:** about 89–92% for tablets (BR-B-1045 at 90.8% is typical), 95–98% for capsules and powders. Waste is around the ~10% planning allowance with noise, and a few batches have clear over-consumption, which is what Kevin flags.
- **Prices:**
  - a slow drift of +0–3% a year for most materials
  - ASC jumps in the price-hike incident (below), up to the $7.10/kg on PO-1042
  - packaging prices stable, apart from a freight surcharge period
- **Lead times:** sampled per supplier per order from `{ mean, sd }`, then late or on-time by `onTimeRate`.

#### 2.1.7 Named incidents (dated, fictional, all trace through every view)

Put these in `world.config` as data, with dates that fit the history window. Each one must be visible in at least three places: the activity feed and history timeline, the affected page (Suppliers, Inventory, Money), the 3D twin when scrubbed to that date, and the clock scrubber's incident markers.

1. **January ASC stockout (legacy, Hollow Pine).** Winter demand outran a late reorder. One batch slipped two days, and $1,200-ish in **rush freight** went on a rush PO. Kevin's look-back flags it: "a reorder point set 9 days too low for winter."
2. **Late shipment (Sierra Mineral Supply, CAC, about March).** It arrived 9 days late, the schedule shifted, and Sierra's on-time rate dropped. It shows on the supplier scorecard trend.
3. **Duplicate invoice paid (legacy, about April).** A supplier bill was entered twice from paper and paid twice. Kevin's look-back finds it. **Identified saving = the duplicate amount (recoverable).** The existing "duplicate-invoice alert" logic should be what catches it. Reuse it.
4. **Failed QC lot (about June).** A Fennimore Polyols lot (or another excipient) fails a moisture spec. It's rejected, returned, replaced, and Fennimore's QC pass rate drops.
5. **QuickChem Direct: two QC rejects in a row (about Aug–Sep) → NEP-393 credential suspended.** This must line up with the existing behavior: "two QC rejects in a row suspends a supplier until HQ reinstates them," "QuickChem Direct out" on RFQ-2611-01, and the existing refused rogue anchor by `quickchem-direct.testnet`. Check how "out" is currently explained and align the incident to it. Don't contradict existing copy.
6. **Ascorbic acid price hike (about Aug–Sep).** Ridgeway Ascorbics and Northgate both move from about $6.40 to about $7.10/kg. **PO-1042's $7.10/kg must be consistent with the post-hike price.** The Money page shows the cost impact, and the what-if planner (§3.4) uses it as its baseline.
7. **Mass-balance gap at Acme Riverside.** The existing "115.199 kg unaccounted at Acme Riverside" stays exactly. Seed a plausible history so that number emerges from, or at least agrees with, Riverside's generated consumption records. If making it emerge naturally is too fiddly, pin it as an anchor value and make the generator respect it.
8. **Mock supplier recall notice (on demand, not on the golden-run timeline).** Ridgeway Ascorbics issues a mock notice for one **historical** ASC lot, received months before T0. Pick a lot that went into several Vitamin C batches across at least two plants, so the trace is impressive. **Never the golden-run lot ASC-261116-01.** The drill is triggered from the Lots & recall page or judge mode (§2.3).
9. **Freight surcharge period (packaging, about May–Jul).** A small, steady cost increase that's visible in the spend-by-category chart.
10. **Holiday shutdown (late Dec).** Two quiet days. It's a nice visual in the 3D twin when scrubbed there: dark buildings, no trucks.

#### 2.1.8 Splicing anchors into the generated world

This is the part most likely to go wrong. Do it like this:

1. **Inventory the anchors.** Load every existing hand-authored record (POs, receipts, lots, batches, bills, payments, adjustments, transfers, group buy, chain events, the 34 cutover POs, the 36 bills of which 35 matched, the step-player steps) into an `anchors` set keyed by ID.
2. **Generate with reservations.** Before generating, reserve every anchor ID, date and quantity:
   - **Inventory continuity:** the generator's simulated on-hand for each material at T0 must equal the on-hand the existing screens show at T0. Run the inventory sim *backward-compatible*: generate history forward, then compute an **opening-balance adjustment** at T0−1 so the levels meet exactly. Record it as a dated "count adjustment" (`inventoryAdjustment`, reason `count`) labeled "cutover count." That's realistic, since acquisitions always start with a physical count.
   - **Open POs at T0:** the generator must not create POs that overlap existing open ones for the same material ("Open purchase orders: 1, $612.00").
   - **Escrow at T0:** before the golden run, escrow holds only what existing data says (e.g. "$612.00 held," the "0.00 DTUSD escrowed" readout) at the matching time.
3. **Merge** anchors over generated records. Anchors win.
4. **Validate** (fail the build if any check fails):
   - no ID collisions
   - no anchor field changed (deep-equal against a frozen snapshot)
   - per-material mass balance continuous across T0
   - money continuous across T0 (AP, escrow and spend-to-date match the existing tiles: "Spend this month $5,150," "$612.00 held for orders on the way," "Received this month, Nov $5,150.00," "Kevin may commit $60,000.00 a month," "spend-policy budget 25,000.00 DTUSD")
   - every proof-point record present and identical

#### 2.1.9 Keeping reconciliation 7/7 over the bigger data

Find the 7 reconciliation checks. They compare Day One and the ERP over the records that crossed the connector.

- **The headline "7 of 7" scope stays exactly as today:** post-cutover records that crossed the connector. Don't widen it so that legacy mess breaks it.
- **Make every check run correctly over the bigger dataset.** For example, if a check sums all bills, it now has to be scoped to the connector window, or legacy records must also agree. Generated Kevin-era records (the live continuation) **must also pass all 7.** Build them with the same three-way-match logic the app already uses.
- **Optionally add a separate "History health" panel** on Reconciliation. It shows what Kevin's look-back found in legacy data (duplicate paid, price drift, the mass-balance gap) as *findings*, not as reconciliation failures. Label it "Before cutover · found by Kevin."
- **Keep "35 of 36 bills matched"** exactly for its existing scope. Find which bill is the unmatched one and keep it unmatched.

#### 2.1.10 Performance

- Precompute and commit:
  - the event stream (compact arrays, or columnar JSON)
  - daily snapshots per plant (on-hand by material, open POs, AP, escrow, KPIs)
  - indexes (lot → batches → FG lots → shipments; supplier → orders; material → lots)
- **Lazy-load** by month for tables. Paginate or virtualize anything over 100 rows (Purchasing will have about 130 orders per plant per year). Add filters: plant, supplier, state, date range, material.
- **Charts** read from pre-aggregated monthly and weekly series, never raw events.
- **Budget:**
  - initial data load under 1.5 MB gzipped for the default view
  - full year under 8 MB gzipped
  - first meaningful paint under 2 s on a laptop
  - seek under 150 ms

#### 2.1.11 Tests to add (minimum)

- **Determinism:** generating twice with the same seed gives an identical hash. A different seed gives a different hash and still passes all invariants.
- **Anchor integrity:** deep-equal every proof-point record and every hand-authored fixture against a frozen snapshot. **This is the most important new test.**
- **Mass balance:** for every lot, received = consumed + wasted + on hand + transferred ± adjustments. For every plant and month, the sums close.
- **Money:**
  - Σ payments = Σ bills paid
  - PO total = Σ lines + freight
  - escrow never negative
  - escrow funded − released − refunded = balance at every snapshot
- **Three-way match:** every Kevin-era payment has PO + receipt + matched bill.
- **Policy:**
  - no generated Kevin-era PO over $2,500 is auto-approved (it must go to the director path)
  - monthly commitment ≤ $60,000
  - suspended suppliers never win an RFQ while suspended
- **Seasonality sanity:** January vitamin C batches exceed July's by at least 25%.
- **Incidents:** each named incident exists on its date and affects the expected entities.
- **Reconciliation:** 7 of 7 still pass, including over the live continuation.
- **Performance:** a smoke test that seek over 12 months stays under budget, in CI or a scripted check.

### 2.2 Suppliers: multiple per material, with a scorecard feeding NEP-393 reputation

**Goal:** every important material has 2–4 qualified suppliers with distinct personalities, so Kevin's choices are visibly *reasoned*.

**Spec:**

- **Supplier personalities.** Suppliers vary by price, lead time, on-time rate, QC pass rate and minimum order quantity. For ASC, for example:
  - Northgate (reliable, mid-price)
  - Ridgeway Ascorbics (cheaper, slower)
  - QuickChem Direct (cheapest, now suspended)
  
  Use the existing suppliers and add at most a few new fictional ones if a material lacks alternatives.
- **Price history** per supplier per material: a monthly series with the incident jumps.
- **Scorecard metrics**, computed from the generated history over a rolling 90 days plus the full year:
  - on-time rate = on-time receipts / receipts
  - average days late
  - QC pass rate = released lots / tested lots
  - consecutive QC rejects
  - price competitiveness = supplier average unit price / best qualified price for the same material in the window
  - invoice accuracy = matched bills / bills
  - responsiveness = quotes returned / RFQs invited
- **Reputation score** (0–100). Pick weights, put them in config and show the formula in an info popover. For example:

  `score = 35·QC + 30·onTime + 15·invoiceAccuracy + 10·priceCompetitiveness + 10·responsiveness`
  
  Each component is normalized to 0–1, with a hard override: **2 QC rejects in a row → suspended**, per the existing NEP-393 rule.
- **NEP-393 link.** The credential status and reputation shown on the scorecard are what the soulbound credential represents. Credential events that exist on testnet (issue, suspend, reinstate) show their tx behind the curtain. Generated changes show as "Simulated · would update credential." Don't write fake hashes.
- **Suppliers page redesign** (see §5.6). It has:
  - a sortable leaderboard
  - a per-supplier detail page with price-history sparkline, lead-time distribution, on-time and QC trend lines, recent POs and lots, and the credential card
  - a "Why Kevin picks them" panel that explains supplier choice for recent RFQs in two lines each

**Acceptance:**

- [ ] Every RFQ in the year has at least 2 quotes (or a clear reason for fewer).
- [ ] Kevin's winner is explainable by the scoring rule.
- [ ] QuickChem's suspension date matches incident #5.
- [ ] The scorecard numbers are reproducible from the raw data with the documented formula.

### 2.3 Lot genealogy and recall tracing

**Goal:** click any raw-material lot and see everything downstream. Then run the killer real-world moment: **a mock supplier recall notice arrives, and Kevin traces it in seconds.**

**Data:** the generator already records `batch.consumption[{ lotId }]`, `fgLot.batchId` and `fulfillment.fgLotIds`. Build a precomputed **genealogy index** in both directions:

- forward: raw lot → batches → FG lots → shipments → customers
- backward: shipment → FG lot → batch → raw lots → supplier lot ref → receipt → PO

**Lots & recall page (new):**

- **Search:** lot ID, material, supplier, date or batch.
- **A genealogy graph**, left to right: raw lot → batches → FG lots → shipments/customers. Nodes are color-coded by lot state (amber quarantine, green released, gray consumed, red rejected, blue in use). It's zoomable and pannable, and clicking a node opens the inspector. Use whatever graph or flow library the repo already has. If there's none, a lightweight DAG layout (dagre or elk) with SVG is fine.
- **A list view** alternative for accessibility.
- **"Run recall drill" button** (also a judge-mode step):
  1. A mock **supplier recall notice** appears as an email-like card: "From: Ridgeway Ascorbics (fictional) · Subject: Precautionary notice, lot RA-xxxxx." It names the supplier's lot ref, not ours.
  2. Kevin's activity feed narrates in fast steps, each with a timer: "Matched supplier lot RA-xxxxx to our lot ASC-26xxxx-0x (0.2 s) → used in 4 batches across 2 plants (0.4 s) → 7 finished-goods lots → 23 shipments to 6 customers (0.9 s) → 112 kg still on hand, placed on hold (1.1 s)."
  3. The graph animates the trace outward in red-orange.
  4. A **summary card** shows lots on hold, units affected, customers to contact, value at risk, and time to trace: "Traced in 1.3 s · by hand: about 2 days of paper." Phrase that as a comparison, not a regulatory claim.
  5. **Actions:** "Place remaining stock on hold" (an inventory event), "Draft customer notices" (drafts only, no sending, fictional), and "Anchor the trace" (on testnet: anchor the trace report hash via the existing `anchor` path, if the relayer is available and Anthony enables it; otherwise "Simulated · would anchor").
  6. "End drill" restores state. The drill is a reversible session overlay that doesn't touch the base world.
- **In the 3D twin:** when a trace is active, affected racks and pallets pulse red-orange, and the trace path draws as a line from the receiving dock → production → FG warehouse → shipping dock.

**Acceptance:**

- [ ] The trace completes in under 1.5 s on the full dataset.
- [ ] The numbers equal a brute-force recomputation (add a test).
- [ ] The drill is fully reversible.
- [ ] The golden-run lot is never the recall target.
- [ ] Copy contains no compliance claims.

### 2.4 Money depth

**Goal:** a CFO-grade view of the plant's money over 12 months, every number derivable from the data with a visible formula, ending in the **"Kevin paid for himself"** counter. The mood: a calm, dark, data-dense finance console. A hero "Kevin paid for himself" panel with a ratio ring, then tiles for cash on hand, inventory on hand, inventory turns (a gauge) and escrow held (gold, with a lock icon), a 12-month cash-flow area chart, AP aging buckets and a savings ledger (for example group buy PO-G-2001, an inter-plant transfer, a sealed bid, a duplicate invoice caught). Chart tooltips sit exactly on the hovered point. Anthony loves this section. Make it rich but honest.

**General rules:**

- Every metric has an ⓘ popover with its formula, its window and a link to the underlying records.
- Plant filter: All / Hollow Pine / Riverside / Lakeview. The time range comes from the sim clock (default: trailing 12 months ending `simNow`).
- All money is in USD. In staff views, chain settlement amounts (DTUSD/USDC on testnet) show as dollars. The curtain view shows the token detail.
- Clearly separate **Recorded** (golden-run, testnet-backed), **Generated history** and **Simulated continuation** where it matters, through chart annotations and a small legend.

**Metrics and formulas** (put the formulas in one `money.ts`, or the repo's equivalent, with unit tests):

1. **Cash flow (monthly, 12 months)**
   - Cash out = vendor payments (by `paidAt`) + modeled overhead (labor, utilities, rent as monthly constants in config, labeled "modeled").
   - Cash in = customer receipts (invoice date + terms, Net 30 with seeded ±7-day jitter).
   - Show net and cumulative.
   - The chart is a stacked area or bars with a net line, annotated with incidents (winter build-ahead, price hike, rush freight).
2. **AP aging.** Open vendor bills bucketed by days past due at `simNow`: Current, 1–30, 31–60, 61–90, 90+. Show total AP, a stacked bar, and a list per bucket. Legacy era shows some late-paid bills. Kevin era shows near-zero past due, because Kevin pays on QC release.
3. **Inventory value / working capital tied up in inventory**
   - Value = Σ on-hand qty × lot unit cost (actual cost per lot from its PO line, plus allocated freight).
   - Show raw materials, packaging, WIP (batches in progress at `simNow`) and finished goods, as a value and a trend.
   - Tell the story: "$X tied up in ascorbic acid during the winter build-ahead."
4. **Inventory turns and days on hand**
   - Turns (annualized) = COGS over trailing 12 months / average inventory value over the same window.
   - DOH = inventory value / (trailing 90-day COGS / 90).
   - COGS = Σ consumed lot cost for batches completed in the window, plus waste cost. Show both per material and per plant.
   - Flag dead stock: no consumption in 120+ days.
5. **Escrow balance.** Funded − released − refunded at `simNow`, by PO, with a timeline.
   - **The recorded segment must match the testnet contract view.** In the golden run, use the same numbers the curtain panel shows ("escrowed 0.00 DTUSD" before funding, "$612.00 held").
   - Simulated continuation escrow is labeled simulated.
6. **Spend vs. budget**
   - By category (active, excipient, flavor, packaging, lab, freight) × plant × month, against budgets in config.
   - Kevin's commitment headroom: "Kevin may commit $60,000.00 a month," with committed so far as a gauge.
   - The per-PO limit ($2,500) is a reference line on a PO-size histogram, which visually shows why PO-1042 was refused.
7. **Savings ledger.** Every entry is a record with `type`, `amount`, `status: "identified" | "realized"`, `evidenceRecordIds[]`, `formula`, `date` and `plant`. Types and formulas:

   | Type | Formula |
   |---|---|
   | Group buy | (Σ standalone best quote per plant − group price) × qty. **PO-G-2001 ($9,490)** is the anchor entry, realized. Compute its saving from the existing per-plant quotes if they exist. Otherwise, add a clearly labeled standalone quote to the data so the saving derives. The saving is *not* the PO total. |
   | Inter-plant transfer | avoided purchase cost (qty × last price paid) − transfer freight (config). The existing Three plants suggestions ("about $336.00," "about $46.50") become entries when approved. |
   | Sealed bid | (median of other qualified quotes − winning quote) × qty, or versus the incumbent's last price. Pick one, document it, be conservative. |
   | Over-consumption caught | excess kg × unit cost (e.g. the 2.1 kg on ASC-261116-01). Identified, then realized if the cause is fixed and subsequent batches return to standard. |
   | Duplicate invoice caught | the bill amount. Realized in the Kevin era (held before payment). In the look-back, the legacy duplicate is "identified · recoverable." |
   | Price drift caught | (billed − PO price) × qty. |
   | Rush freight avoided | rush freight cost in the comparable legacy event, only counted when Kevin's reorder point prevents a recurrence in the live continuation. Be conservative and label it. |
   | Attack refused | **Don't count money "saved" from refused attacks as savings.** Show it separately as "Payments protected: $X refused" (the amount the attack tried to redirect). It's a protection stat, not savings. |

8. **"Kevin paid for himself" counter (the hero stat)**
   - **Kevin's cost** = a configurable monthly fee (an assumption in config, labeled "assumed cost of Kevin," fictional) + metered NEAR AI Cloud inference (from the existing attestation and inference path if it tracks usage, otherwise a modeled $/answer) + testnet gas (shown as ≈$0, since it's testnet).
   - **Value** = Σ realized savings since T0. Identified-but-not-realized savings show as a separate, lighter bar.
   - **Display:**
     - a large count-up number ("$X saved since Day One")
     - a ratio ("N× his cost")
     - a progress ring toward break-even
     - a mini timeline of when each saving landed
   - The counter also appears small in the global header or Overview hero (Anthony likes it), ticking up when a saving lands as the clock plays.
   - **Honesty rule:** realized-only by default. A toggle shows "including identified." Never mix them silently.

**Money page layout:** see §5.6. Also surface the key money stats on Overview (one tile) and in Talk to Kevin (questions like "How much has Kevin saved?").

**Acceptance:**

- [ ] Every money figure on every page comes from `money.ts` functions.
- [ ] Unit tests cover each formula with hand-computed small cases.
- [ ] Money page totals reconcile: cash out = Σ vendor payments + modeled overhead.
- [ ] PO-G-2001, PO-1042 and PO-1047 amounts are unchanged.
- [ ] The savings ledger never counts the same evidence twice (add a test).

---

## 3. New features that make strong demo moments

**Explicitly out of scope: agent-to-agent negotiation.** Don't build haggling, counter-offers or negotiation transcripts between Kevin and supplier agents. The existing simulated supplier quotes and the sealed-bid flow stay as they are.

### 3.1 Attack arena (judge-playable)

**Goal:** turn "15 of 15 attacks refused" from a claim into something a judge *does*. They pick an attack, fire it, and watch the contract refuse it live, with the reason and a testnet explorer link. This hits the security track hard.

**Look and tone:** a restrained, premium security console in the spirit of Linear, Vercel or Stripe Radar. **No rubber stamps, no cartoon effects, no giant or diagonal text.** Layout:

- **Header:** the K tile, "Day One · Attack arena", and a subtle tally at the right ("15 of 15 refused", with a small muted-red dot).
- **Left column:** the list of attacks, each row with a small status dot, under a quiet "Recorded on NEAR testnet" label.
- **Center:** the selected attack's title, a one-line description of what the attacker tries, a quiet "Fire attack" outline button, then an inline result card: a small red **"Refused by contract"** chip, the verbatim reason in monospace (e.g. `per-PO limit exceeded: $5,150 > $2,500`), Method (`submit_po`), Signer (`kevin.plant-b.acme-holdings.testnet`), a shortened tx hash and "View on explorer ↗".
- **Right column:** a compact "Behind the curtain · NEAR testnet" log of timestamped method calls with their outcomes (refused, ok, funded), method names in their real lowercase form.

**Find first:** the existing 15-case attack suite (probably a test file and/or a script that recorded the runs). **The arena must reuse those exact 15 cases** as its catalog: same names, same inputs, same expected refusals, same recorded tx hashes. Don't write a second, divergent set.

**Catalog.** Each card shows:

- a title in plain words
- the attacker's story in one sentence
- the defense ("Spend policy," "Vendor master check," "Credential," "Escrow," "Duplicate detection")
- the contract method that refuses it

Examples that are already in or near the suite:

- **Fake "new bank details" email:** a supplier-lookalike email asks to change Northgate's payout account. Kevin drafts the change, and the payout no longer matches the vendor master, so it's refused.
- **Split PO to dodge the limit:** two $2,499 POs to the same supplier for the same need within minutes. The spend policy catches the split (if the suite has it; otherwise show whichever limit case it has).
- **Duplicate invoice:** NG-INV-24190 submitted twice.
- **Rogue supplier anchor:** `quickchem-direct.testnet` tries to anchor records. "Only a registered purchasing agent or an approved supplier can anchor records."
- **Over the per-PO limit without approval:** the PO-1042 pattern.
- **Over the monthly cap.**
- **Suspended supplier tries to get paid.**
- **Approval signed by the wrong account.**
- **Escrow release before QC.**
- …the rest of the 15, exactly as defined.

**Interaction:**

1. The judge picks a card. A details panel shows what the attacker controls and what they'll try.
2. "Fire attack": a quiet outline button, not a big red one. The tone is a premium security console (Linear / Vercel / Stripe Radar).
3. A step timeline animates:
   - Kevin receives
   - Kevin drafts (Kevin drafts honestly, because the point is that *the contract*, not the UI, refuses)
   - Contract checks
   - an inline result card with a small red "Refused by contract" chip, the reason string verbatim from the contract in monospace (e.g. `per-PO limit exceeded: $5,150 > $2,500`), the method, the signer, a shortened tx hash and "View on explorer ↗". **No rubber stamps, no diagonal text, no cartoon effects.**
   - "Funds didn't move"
4. The right panel (curtain styling) shows the transaction: method, signer, events, verdict and an **explorer link**.
5. A scoreboard updates ("Refused 4 of 4 you tried · Suite: 15 of 15").
6. "Try all 15" runs the suite sequentially with a montage feel: about 1.5 s per case, with each list row's status dot turning red and its reason code appearing, one by one. Keep it calm.

**Two execution modes** (a toggle in the arena header):

- **Recorded (default, always works):** replays the recorded refusal for that case with its real testnet tx hash and explorer link. It's labeled "Recorded on NEAR testnet, Oct 29." This is the golden-run-safe mode.
- **Live testnet (optional):** submits a fresh transaction through the existing server-side relayer, gets a new refusal and a new hash, and shows it. Requirements:
  - it's only enabled when a server env flag is set and the relayer is healthy
  - a health check runs before showing the toggle
  - rate limit, e.g. 1 attack per 5 s per session, 30 per hour per IP
  - no keys in the browser
  - if the call fails or takes over 8 s, fall back automatically to the recorded result, with a small "network slow, showing recorded result" note
  - never let a live failure look like a successful attack

**In 3D:** if the twin is open in curtain mode, a fired attack shows as a red pulse traveling toward the contract node and hitting a red hex shield (see §4.8).

**Acceptance:**

- [ ] All 15 cases are playable in recorded mode with working explorer links.
- [ ] Live mode is guarded and falls back cleanly.
- [ ] Arena results never alter the base world (no money moves, no records change).
- [ ] An e2e test fires 3 attacks and checks the refusal reasons match the suite.

### 3.2 Talk to Kevin

**Goal:** a chat panel where anyone can ask Kevin why he did something, and he answers from the data, with clickable citations and an attestation badge.

**Placement:**

- a "Talk to Kevin" page (full width)
- a ⌘K / header-button drawer reachable from anywhere, with page context pre-loaded (on PO-1042, the drawer opens with "Ask about PO-1042")

**Grounding:**

- Retrieval over the generated world plus the anchors: POs, quotes, scorecards, lots, batches, bills, money metrics, incidents, chain events. Build compact, typed "fact cards" per record, and retrieve by ID mention, entity type and keyword. Don't embed the whole year in a prompt.
- **Answers must cite record IDs** as links ("PO-1042," "RFQ-2611-01," "Northgate scorecard"). If the answer isn't in the data, Kevin says so plainly. No invented numbers.
- **Kevin can explain and propose, never execute.** No payments, approvals or credential changes from chat. Proposals deep-link to the page where a person acts.

**Model path:** use the **existing NEAR AI Cloud TEE path** that already signs answers ("Kevin's model ran in a hardware enclave · 15 enclave checks · 2 signed answers").

- Each answer shows an **attestation chip**: "Signed in enclave ✓". Click it for the attestation details already implemented.
- If NEAR AI Cloud is unavailable, use the **existing labeled Anthropic fallback**, and the chip reads "Fallback model · not attested" (neutral gray, not red).
- Update the "N signed answers" counter in the curtain panel as answers are signed.

**Suggested questions** (chips):

- "Why did you order from Northgate instead of QuickChem?"
- "Why was PO-1042 refused?"
- "What would a 20% ascorbic acid price rise cost us?" (opens the What-if, §3.4)
- "Where did lot ASC-261116-01 go?"
- "How much have you saved since Day One?"
- "What's below reorder point today?"
- "Which supplier is most reliable for calcium carbonate?"

**Golden-run safety:** for the demo video, keep a **canned, pre-signed answer set** for the 3–4 suggested questions used in the tour, so the video never depends on live inference. The canned answers must be real answers that were actually signed earlier, with their real attestations. Don't fake signatures. Label them "recorded answer."

**Acceptance:**

- [ ] 10 scripted Q&A tests check citations exist and refer to real records.
- [ ] The fallback labeling is correct.
- [ ] Chat never triggers a state change.

### 3.3 Supplier disruption drill

**Goal:** press a button and Northgate goes down. Kevin re-sources, re-quotes and explains the cost and delay impact in under 10 seconds.

**Flow:**

1. On Suppliers (or in judge mode), click "Run disruption drill" and pick a supplier (default Northgate Ingredients) and a reason (plant fire, mock; carrier strike; credential revoked).
2. Kevin:
   - lists open POs and upcoming needs that depend on the supplier
   - finds the next-best **qualified** suppliers by scorecard, skipping suspended ones (QuickChem stays out)
   - issues a sealed-bid RFQ to them using the existing sealed-bid flow (no negotiation)
   - shows the resulting plan:
     - new supplier per material
     - price delta (Δ$/unit and total)
     - lead-time delta and which batches slip (if any)
     - cash impact
     - a recommended inter-plant transfer to bridge the gap, if another plant has stock
3. Any new PO over $2,500 goes to Linda's approval path, the same as PO-1042. **Policy is still enforced in the drill.**
4. The activity feed narrates, and the 3D twin shows Northgate's route greyed out with a re-routed truck path.
5. "End drill" reverts. It's a session overlay; the base world doesn't change.

**Acceptance:**

- [ ] Deterministic results per seed.
- [ ] Suspended suppliers are never chosen.
- [ ] Over-limit POs go to approval.
- [ ] Fully reversible.

### 3.4 What-if planner

**Goal:** answer "what if" questions with the forecast, the purchase plan and the cash impact updating side by side.

**Scenarios (presets plus free sliders):**

- **Add a second shift** at Hollow Pine. Capacity ×1.7 (config). The demand-limited forecast shifts, and batches, material requirements, POs and inventory build all change.
- **Ascorbic acid +20%** (or any material, ±50% slider).
- Demand ±X% for a SKU (e.g. a stronger winter).
- Lead time +N days for a supplier.
- Per-PO limit change (shows how many POs would need Linda: a nice governance visual).

**Mechanics:**

- Re-run the generator's demand → production → BOM → purchasing → money stages **from `simNow` forward over 13 weeks**, with the scenario overrides.
- The same seed means differences are caused only by the scenario, not by noise. This is why stage-level PRNG sub-streams matter.
- Don't mutate the base world.

**UI:**

- a scenario builder (left)
- side-by-side "Base vs. Scenario" (right):
  - batches per week
  - material requirement for the changed material
  - purchase plan (POs, suppliers, dates)
  - cash out per week
  - working capital peak
  - savings at risk
- A one-line Kevin summary: "A second shift adds about 9 batches over 13 weeks, needs 2.1 t more ascorbic acid and peaks working capital at +$X in week 6. Three POs would need Linda's approval."
- Export the scenario as a shareable link (encoded in the URL).

**Acceptance:**

- [ ] Recomputation is under 500 ms.
- [ ] Base is unchanged after any scenario.
- [ ] Unit tests for "ASC +20%": the material cost delta equals 0.2 × the base ASC spend in the window, within rounding.

---

## 4. The 3D digital twin becomes the hero

This is where Day One wins the demo video. Today the 3D plant map is a nice but small card on the Plant map page. It has:

- "This run / Group buy" and "Flat / 3D" toggles
- +/−/Fit zoom
- layer chips (Equipment · Orders & money · Labels)
- a legend (online · not yet · money · quarantine · refused / disputed)
- low-poly green-roofed buildings with labels (Weigh & Dispense, Compression, QC Lab)
- Escrow ("$612.00 held") and Acme HQ ("budget") blocks
- a red arc for the refused PO with a red barrier
- "Plant B: 4 of 9 departments online"

Keep that DNA. It's charming and on-brand. Make it **bigger, deeper, alive, and the single shot that explains the whole project.** The target hero shot: Hollow Pine with the roof cut away, showing labeled Weigh & Dispense, Compression, Packaging and QC Lab rooms (QC Lab its own room, separate from the warehouse and the quarantine cage), warehouse racks with amber (quarantine) vs. green (released) pallets, and a truck arriving at the dock from the supplier depot. Riverside and Lakeview sit on **their own separate plinths** with their own labels. The gold money stream flows **HQ → Escrow → supplier (Northgate depot)**, never directly from HQ to the supplier. A small legend covers Released, Quarantine and Money.

### 4.1 Stack: check first, then keep it

- **Find what the current 3D view uses.** It's very likely three.js, probably via react-three-fiber (R3F) and drei. **Keep that stack.** Don't introduce Babylon, PlayCanvas, Unity or a second renderer.
- If it's R3F, these are the tools to reach for. Add only what you need, and check the versions against the existing React and three versions:
  - `@react-three/drei`: `CameraControls` (smooth fly-to), `Instances` / `Merged`, `Detailed` (LOD), `Html` (labels), `Bvh`, `PerformanceMonitor`, `AdaptiveDpr`, `Environment`, `ContactShadows` / `AccumulativeShadows`, `Line`, `QuadraticBezierLine`, `Outlines`, `useGLTF`
  - `@react-three/postprocessing`: Bloom, very subtle vignette, optionally SMAA. Keep post-processing **optional and off on low tier**.
  - `maath` for easing and damping, if it's not already present
  - `camera-controls` (via drei) for the fly-to system
- If it's plain three.js, keep plain three.js and implement the same concepts with `InstancedMesh`, `LOD`, `EffectComposer` and `camera-controls`.
- **Geometry approach:**
  - Stay **procedural and low-poly** (boxes, extrusions, lathe shapes) like the current buildings.
  - Use a handful of small glTF props only if they're tiny (<150 KB each, Draco/meshopt compressed) and license-clean (CC0 such as Kenney or Quaternius; record the attribution in the README).
  - Procedural is safer for the deadline and keeps the bundle small.
- **Code-split the twin.** Lazy-load it so pages without 3D don't pay for three.js.

### 4.2 Modes and entry points

- **Full-screen hero mode (new):**
  - route `/twin`, or the existing Plant map page gets a "Full screen" button and the `F` key
  - the canvas fills the viewport
  - the global header collapses to a thin translucent bar with sim clock, curtain toggle, judge-mode button and an exit button (Esc)
  - Kevin's activity feed is available as a translucent overlay on the right (toggle)
- **Embedded mode:** the existing card on Overview and Plant map stays as a smaller live view, with the same scene and camera presets limited to "Campus" and "Hollow Pine." Clicking it enters full screen with a smooth camera transition.
- **Flat mode:** keep the existing flat isometric map as the **2D fallback** (§4.11) and as an option ("Flat / 3D" toggle stays).
- **Keep the existing toggles.**
  - "This run / Group buy" now acts as **scenario focus**. It highlights the relevant flows and adds camera presets.
  - Layer chips (Equipment · Orders & money · Labels) remain, plus new ones: **Stock** (rack fill), **People** (tiny worker figures, optional) and **Chain** (only with the curtain on).

### 4.3 Scene layout (campus)

A single campus scene. The three plants are in one world for drama even though they're "elsewhere." Stylize distance: each plant sits on its own raised plinth (an island) connected by roads that fade into distance fog, with Acme HQ and the Escrow between them. Units are meters, roughly to scale for buildings. Suggested layout (adjust to match the current scene composition):

```
                    [ Acme Lakeview plinth ]  (NE, ~180 m away, smaller detail)
                           \
   [ Suppliers yard ]       \            [ Acme HQ tower ]  (teal glass box, "budget")
   (W edge: supplier         \                 |
    depots as small           \           [ Escrow vault ]  (squat dark vault, gold seam light)
    branded sheds;             \               |
    trucks spawn here)     [ HOLLOW PINE TABLET CO. ]  (center, hero, full interior detail)
                                   /
                    [ Acme Riverside plinth ]  (SW, ~180 m away, smaller detail)
```

- **Hollow Pine (hero, full detail).** The main building is about 80 × 50 m and single storey (about 8 m high), with a **cutaway roof** that fades away as the camera zooms in, or toggle with `R`. There are nine departments, matching the existing "4 of 9 departments online" model. **Use the existing department list and online/not-yet states.** A likely set:
  1. **Receiving dock:** 2 roll-up doors, dock levelers, a staging lane, a "lot label" printer kiosk
  2. **Quarantine cage:** fenced area with amber floor markings
  3. **Warehouse (racked):** 6–10 rows of pallet racks, 3–4 levels each
  4. **Weigh & Dispense:** booth with downflow hood, floor scales, IBC/drum props
  5. **Blending / Granulation:** V-blender or bin blender prop
  6. **Compression:** 2–3 rotary tablet presses (cylinder plus turret), with hoppers
  7. **Encapsulation / Powder fill:** a capsule filler and a canister fill line (for the Probiotic and Fiber SKUs)
  8. **Packaging:** bottle line conveyor (bottler, capper, labeler) ending in a case packer and pallet wrapper
  9. **QC Lab:** benches, an HPLC-ish box, a fume hood, a "release" terminal glowing when Priya releases a lot
  
  Plus a **shipping dock**, an office corner (Ray's desk; optional), and a "not yet online" visual for departments not yet migrated to Kevin. Those are rendered in desaturated gray with a dashed outline, matching the existing "not yet" legend.
- **Acme Riverside and Lakeview: medium detail.** An exterior with roof on, a small yard, dock doors and a visible rack count via a roof-top "fill bar" or holographic stack (no interior), plus a status beacon. They can be entered in a simplified interior (warehouse plus line only) if time allows. That's a stretch goal.
- **Acme HQ:** a teal glass tower (existing look), with a soft budget gauge ring around its top showing monthly commitment versus $60,000.
- **Escrow:** a squat vault with a gold light seam whose brightness scales with the escrow balance. Show a floating label "$612.00 held" (live from data).
- **Suppliers yard (west edge):** small depots per active supplier (Northgate, Ridgeway, Pacific Excipient, Sierra Mineral, Orchard Flavor, Fennimore, BLS Bayfront, QuickChem). Suspended suppliers' depots have a red-gray tint and a closed gate. Trucks spawn here.
- **Customers edge (east):** a highway off-ramp where outbound trucks exit. Customers stay abstract; no buildings needed.
- **Ground:** sage-green terrain, stylized pine trees (instanced, about 300), roads with dashed lines, parking lots with instanced cars.

### 4.4 Interiors and real data binding

Everything in the interior is **bound to data at `simNow`**:

- **Warehouse racks show real pallet counts.**
  - Each rack slot maps to a lot location (`location: { zone, rack, slot }`). If the data has no locations yet, the generator assigns them deterministically.
  - Pallet appearance encodes lot state:
    - quarantine: amber glow, in the quarantine cage
    - released: soft green
    - in use: blue, moving to the production staging lane
    - consumed: removed
    - rejected: red, moved to a "reject" bay
  - Rack fill per material = on-hand / max (from reorder point × 3, config).
  - Hover a pallet to see a tooltip ("ASC-261116-01 · 700 kg · quarantine · Northgate"). Click it to open the inspector.
  - Implementation: **one `InstancedMesh` for all pallets** (box plus a separate instanced cardboard-wrap top), with per-instance color via `instanceColor` and per-instance matrix. Update only changed instances per tick.
- **Machines animate when their batch is running.** A rotary press turret spins while a batch is in progress in Compression, the blender rotates, and the bottle line conveyor moves (a UV-scrolled texture or instanced bottles moving along a path). Idle machines are still, with a dim status light. A machine in an over-consumption flagged batch gets a small amber exclamation marker.
- **QC lab:** when a QC test is in progress for a lot, a bench terminal glows blue. On release, a green check pops above the lab and the corresponding pallet in quarantine changes amber → green, then a forklift moves it to the released zone.
- **Receiving:** trucks arrive on actual receipt events. The truck drives in from the supplier depot along a spline path (about 6–10 s at 1× visual speed, compressed at higher sim speeds), backs into the dock, pallets unload (instanced, staggered) into the **quarantine cage**, and the truck leaves.
- **Shipping:** outbound trucks on fulfillment events. FG pallets move from the FG area to the shipping dock and out.
- **Inter-plant transfers:** a small truck travels between plinths along the road (the existing Three plants "Approve the move" triggers it).
- **Group buy (PO-G-2001):** a shared truck route that splits into three branches to the three plants, with gold money beams from all three plants converging into Escrow.
- **People (optional layer):** tiny capsule figures (instanced, about 20) walk between stations on simple paths. Ray at the office, Priya in QC, a forklift driver. These are purely ambient and off by default on the low tier.
- **"Not yet online" departments:** gray and dashed. As stages complete in "Your integration," they light up. The stage-to-department mapping already exists implicitly ("4 of 9 departments online"); find it and use it.

**Event → animation mapping.** Make it one table in code, so there's one place to edit:

| Data event | 3D response |
|---|---|
| `receipt_created` | truck spawns at supplier depot → drives → unloads pallets to quarantine (amber) |
| `qc_started` / `qc_released` / `qc_rejected` | lab terminal blue → green check & pallet turns green → forklift to released zone / red & to reject bay |
| `batch_started` / `batch_completed` | machine animation on / off; WIP pallet appears at line; FG pallets appear at FG zone |
| `consumption_posted` | pallets in staging shrink/disappear; rack fill bars update |
| `fulfillment_shipped` | FG pallets to shipping dock → outbound truck exits east |
| `transfer_approved` | inter-plant truck along road |
| `escrow_funded` | gold beam HQ → Escrow, vault seam brightens |
| `escrow_released` / `paid` | gold beam Escrow → supplier depot, vault seam dims |
| `po_refused` | (curtain on) red shield at the contract node; (curtain off) small red flash on HQ tower + feed item |
| `approval_received` (Linda text) | phone-shaped glyph pops above HQ, green check, beam unblocks |
| `credential_suspended` | supplier depot gate closes, tint red-gray |
| `incident:*` | incident-specific (late truck idles on road with amber hazard; holiday = lights off; recall trace = red-orange path) |

### 4.5 Visual style

- **Style:** stylized low-poly, matte, friendly. Think a polished SimCity or Mini Motorways, not photoreal. Keep the existing green-roof / gray-wall / pine-tree palette.
- **Lighting:**
  - one directional "sun" with soft shadows: a shadow map of 2048 on the high tier and 1024 on mid, with shadows off on low (use contact shadows)
  - a hemisphere fill (sky/ground)
  - a subtle environment for reflections on glass (HQ tower) only
- **Time-of-day** follows `simNow` and is shared with the dawn scene (§1.3):
  - night: deep indigo, building windows lit, warm emissive
  - dawn (5–7 AM): peach horizon, long shadows
  - day: neutral
  - dusk: amber
  
  Interpolate the sun angle, color and intensity, sky gradient and fog color. Window emissive turns on at dusk.
- **Color language** (reuse the design tokens from §5.2, and keep the 2D legend in sync):
  - **Pine green** (brand): online buildings, released lots, success
  - **Amber** `#F2A93B`: quarantine, waiting on a person, warnings
  - **Red** `#F0524F`: refused, rejected, disputed
  - **Gold** `#F5C451`: money flows, escrow
  - **Cyan** `#38D3E8`: the chain layer (curtain), anchors, contract nodes
  - **Blue** `#5B9CFF`: in use, in progress, QC testing
  - **Desaturated gray, dashed:** not yet online
- **Materials:** `MeshStandardMaterial` with low metalness and medium roughness, and flat or vertex colors (no big textures). Emissive is only for status lights, beams, windows and the chain layer. Bloom picks up emissive only (use a luminance threshold). Keep bloom subtle on the plant and stronger in curtain mode.
- **Labels:**
  - HTML labels (drei `Html`) for buildings and departments, styled like the existing green pill labels ("Weigh & Dispense," "Compression," "QC Lab")
  - occlude them behind geometry
  - fade them by camera distance
  - cap visible labels at about 25
  - the "Labels" chip toggles them
- **Money light streams:**
  - animated tubes or lines along `QuadraticBezierLine` / `CatmullRomCurve3` arcs, with a scrolling dash or a shader that moves bright particles along the curve
  - thickness ∝ log(amount)
  - a "$5,150.00" label rides the stream at its midpoint for big flows, then fades
  - capped at about 12 concurrent streams; queue the rest

### 4.6 Camera system

- **Controller:** drei `CameraControls` (camera-controls), with damping.
  - orbit with left-drag, pan with right-drag or two-finger, zoom with the wheel
  - clamp the polar angle (no going under the ground: 15°–80° from vertical)
  - clamp distance (8 m – 600 m) and pan bounds to the campus
- **Fly-to on click.** Clicking a building, department, rack, truck, depot or chain node smoothly flies to a framed view of it (`setLookAt` / `fitToBox` with `transition = true`, 1.2–1.8 s ease-in-out), then opens the inspector. Double-click to "enter" a department (cutaway roof, interior framing).
- **Presets** (buttons in a small floating "Views" pill, and keys 1–8):
  1. **Campus** (all three plants, HQ, Escrow, suppliers)
  2. **Hollow Pine** (exterior, 3/4 view)
  3. **Receiving & quarantine**
  4. **Production floor** (Weigh & Dispense → Compression → Packaging)
  5. **QC lab**
  6. **Warehouse racks**
  7. **HQ & Escrow** (money view)
  8. **Chain layer** (only in curtain mode, a high angle over the network)
- **Follow mode:** click a truck, then "Follow" to keep the camera trailing it until it docks (great for video).
- **Keyboard:**
  - `F` full screen
  - `Esc` exit or close the inspector
  - `R` roof toggle
  - `C` curtain toggle
  - `Space` play/pause the sim
  - `1–8` presets
  - `T` start the tour
  - `?` shortcut help
- **Mobile touch:** one-finger orbit, two-finger pan and pinch zoom, tap to select, double-tap to fly in.
- **Motion comfort:** with `prefers-reduced-motion`, transitions become fast cuts or crossfades, and there's no auto-orbit.

### 4.7 Inspector panel (click anything)

A right-side glass panel (dark translucent, about 380 px; a bottom sheet on mobile) that opens for any selected object. It's the **same Inspector component** used in 2D pages (§5.8), so clicking PO-1042 in a table or in 3D shows the same thing.

- **Header:** object type and ID ("Lot ASC-261116-01"), a state chip, and plant.
- **Body (staff view, curtain off):** the ERP record fields in plain language:
  - for a lot: material, supplier, received, qty, QC result and tester, location, used in (batch links)
  - for a PO: lines, total, approval path, receipt, bill, payment
  - for a machine: current batch, yield so far, last batches
  - for a supplier depot: scorecard summary
  
  Add a mini timeline of the object's lifecycle, then "Open in page →".
- **Chain section (curtain on):**
  - the on-chain transactions for this object: method, signer, gas payer, events, verdict, reason, **explorer link** (recorded only)
  - for simulated objects: "Simulated · would anchor `<hash of record>`," computed deterministically from the record so it's stable, and visually distinct (dashed cyan, no explorer link)
- **Actions** (only where a person would act, calling the same handlers as the 2D pages): Release lot (QC persona), Approve move, Approve PO (opens Linda's phone mock in the golden-run window).

### 4.8 The 3D curtain (the single shot that explains the project)

When the curtain toggle flips on (header toggle, `C`, or judge mode), the twin transitions over about 1.2 s. The end state: the plant turns to a translucent wireframe; a cyan chain layer floats above it with Spend policy / Escrow / Credentials contract nodes, beams carrying pulses, and anchor pins; a **red shield blocks the gold money beam** ("Refused · PO-1042 · $5,150 over $2,500 limit"); and the inspector shows `submit_po`, the full signer `kevin.plant-b.acme-holdings.testnet`, the `po_refused` event, the verbatim refusal reason and "View on explorer."

1. **The plant goes translucent.** Building materials crossfade to a ghosted look: opacity about 0.18, a slight blue-gray tint, a fresnel rim, and edges drawn as thin lines (`EdgesGeometry` / drei `Outlines`). Pallets and machines dim, but status colors stay faintly visible, so you can still see amber or green.
   - Implementation tip: keep a parallel "ghost" material per material type and swap with a uniform-driven blend, rather than recompiling materials.
   - Set `depthWrite = false` on ghost materials, and sort them carefully.
2. **The chain layer rises.** A cyan network fades in about 25–40 m above the campus, on a subtle grid plane:
   - **Contract nodes:** floating hexagonal prisms with soft glow and labels, one per contract the app uses:
     - **Spend policy**
     - **Escrow**
     - **Credentials (NEP-393)**
     - **Anchors / Records**
     - optionally **Sealed bids**
     - optionally **Group purchase**
     
     **Use the real contract set and names from the repo.** Each node hovers above the building it governs: Spend policy above HQ, Escrow above the vault, Credentials above the suppliers yard, Anchors above Hollow Pine.
   - **Accounts as small orbs:** `kevin.plant-b…`, `director.plant-b…`, `receiving.plant-b…`, `dayone-relayer.testnet`, and supplier accounts above their depots. Short labels, with the full name in the inspector.
   - **Beams:** thin cyan lines from accounts to contract nodes, and from contract nodes down to the physical objects they govern (vertical light pillars into buildings).
   - **Transactions as pulses:** each chain event is a bright cyan pulse traveling signer → contract node (about 0.8 s), then a burst on the node, then outcome beams (to Escrow, to the supplier and so on). The method name (`submit_po`, `approve_po`, `confirm_receipt`, `anchor_batch`) flashes as a small mono label next to the node.
   - **Refusals as red shields:** a refused tx shows a **red hexagonal shield** materializing in front of the contract node, the pulse shattering against it into red particles, and the money beam behind it **stopping** at the shield. A callout card shows the verbatim reason ("PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required."). The shield lingers about 3 s, then fades to a small red marker that stays on the node as a "refusal count."
   - **Anchors as pins:** each anchored record (batch record, approval, invoice) drops a cyan pin onto the building where the record lives, with a small ripple on landing. Hovering a pin shows the record type, ID and tx. Many pins should cluster (instanced, with a count badge when there are more than 5 in one spot).
   - **Money in chain mode:** gold streams still show, now *passing through* the escrow contract node, so the viewer sees that funds are held by the contract and released on QC.
   - **TEE attestation:** a small enclave cube near the Kevin account orb, with a lock glyph. It glows when Kevin produces a signed answer, and the pulse from Kevin carries a small "signed" glint.
3. **Recorded vs. simulated in the chain layer:**
   - recorded testnet tx are solid cyan pulses, and clicking one opens the inspector with the explorer link
   - simulated would-be tx are dashed and dimmer, labeled "Simulated"
   
   This keeps us honest.
4. **Turning the curtain off** reverses the transition. The chain layer sinks and fades, and the plant solidifies.
5. **The 2D curtain panel and the 3D chain layer show the same tx list**, from one source.

### 4.9 Data binding and the frame loop

- The twin subscribes to the sim clock and event stream. On each frame:
  - read `simNow` (no React state per frame; use a ref or store subscription like zustand `subscribe`, or the repo's equivalent)
  - advance active animations
  - spawn new ones for events whose timestamps passed since the last frame
- **At high sim speeds,** compress animations (a truck takes 1.5 s instead of 8 s) and **coalesce** (if 12 receipts happen within one second of real time, show 3 trucks and a "+9" badge). Never queue unbounded animations.
- **Seek:** on seek, cancel in-flight animations and **snap** the scene to the snapshot state (rack fills, pallet states, machine states, escrow glow), then resume.
- **Animation controllers** are small pure classes (TruckController, PalletController, BeamController, PulseController), driven by `useFrame`. Avoid per-object React components for anything with more than 50 instances.
- **Selection** uses raycasting with a BVH (drei `Bvh`) over static geometry, plus instance ID picking for pallets and trees.

### 4.10 Scripted camera fly-through tour (for the demo video)

A deterministic, scripted tour that runs the hero moments by itself. It's used for the demo video and as the last step of judge mode.

- **Definition:** one `tour.ts` (or JSON) with an array of **beats**. Each beat has:
  - `t` (seconds from the tour start)
  - `simSeek` (jump the clock to a sim timestamp)
  - `simSpeed`
  - `camera` (preset or an explicit `{ position, target, fov }` keyframe, plus a transition duration and easing)
  - `curtain` on/off
  - `layers`
  - `caption` (one short line plus an optional subcaption)
  - `highlight` (object IDs to outline)
  - `ui` (show the phone mock, show the inspector, etc.)
- **Proposed beats** (about 100–120 s total; tune live):
  1. **Dawn over campus (0–8 s).** Campus preset at 5:00 AM, slow push-in, and the 5am brief card fades in. Caption: "Day One. Kevin starts before the plant does."
  2. **Batch record → consumption (8–18 s).** Fly to Weigh & Dispense and Compression. The press spins. The activity feed shows "Read batch record BR-B-1046 · flagged 2.1 kg over-consumption."
  3. **Reorder → PO-1042 (18–28 s).** Fly to the warehouse. The ASC rack fill is low and turns amber. Kevin drafts PO-1042, $5,150.00.
  4. **Curtain on → refusal (28–42 s).** Toggle the curtain. The plant ghosts and the chain layer rises. A pulse goes `kevin.plant-b…` → Spend policy, and the **red shield** blocks the money beam. Callout with the verbatim reason. Caption: "The contract said no. Not the UI. The contract."
  5. **Linda's text approval (42–54 s).** Split-screen: Linda's phone mock (from §5.9) slides in, and "YES 1042" is tapped. A pulse goes `director.plant-b…` → Spend policy, then a green burst, the shield dissolves and the gold beam flows HQ → Escrow.
  6. **Truck → quarantine → QC release → payout (54–76 s).** Curtain off. Follow the Northgate truck in, pallets unload amber into quarantine as ASC-261116-01, cut to the QC lab, Priya releases it, the pallet turns green, curtain on briefly, and the escrow releases gold to Northgate's depot. Caption: "Paid only when QC says it's good."
  7. **Group buy PO-G-2001 (76–86 s).** Campus view. Three plants' beams converge, and a shared truck splits three ways. "$9,490 · three plants · one order."
  8. **Real USDC, PO-1047 (86–94 s).** A close-up on the escrow node, with a distinct USDC-tinted pulse. "$19.00 in real Circle testnet USDC."
  9. **Attack montage (94–108 s).** A high chain view, 15 red shields flashing in sequence on their contract nodes, with the counter ticking to "15 of 15 refused."
  10. **Pull back (108–118 s).** Curtain off, dusk lighting, and the "Kevin paid for himself" counter on screen. Tagline: **"He does the paperwork. You run the plant."**
- **Controls:**
  - Start ("Play tour" in judge mode, or `T`), pause or resume, skip beat (→), restart.
  - A **"Clean capture" toggle** hides all UI chrome except captions, and adds a 16:9 safe-frame guide.
  - Target 1920×1080 at 60 fps. Optionally `?capture=1` to lock the DPR and disable adaptive quality during recording.
- **Determinism:** the tour always seeks to fixed sim timestamps from the golden run and uses recorded data only, so it **never depends on the network.** Add an e2e test that runs the tour at 10× and asserts that each beat's expected objects and captions appear.

### 4.11 Performance budget and fallbacks

- **Target:** 60 fps on a typical laptop (integrated GPU, e.g. an M1 Air or Intel Iris Xe) at 1080p in full-screen campus view, curtain on. Minimum 30 fps on the mid tier.
- **Budgets (high tier):**
  - under 250 draw calls
  - under 400k triangles visible
  - under 64 MB GPU texture memory
  - under 1.5 MB gzipped JS for the twin chunk (excluding three)
  - initial twin load under 2.5 s
- **Techniques:**
  - instancing for pallets, trees, cars, people, pins, rack uprights and bottles
  - merge static geometry per building (`BufferGeometryUtils.mergeGeometries`)
  - **LOD** via `Detailed`: interiors render only for the focused plant, and Riverside and Lakeview stay exterior-only beyond about 120 m
  - frustum culling on (the default); turn it off only for instanced meshes, and set bounding spheres manually for them
  - `frameloop="demand"` when the sim is paused and nothing is animating; invalidate on interaction
  - `PerformanceMonitor` plus `AdaptiveDpr`: start at DPR min(2, devicePixelRatio) and step down when fps drops below 50 for 2 s
  - post-processing only on the high tier
  - dispose geometries and materials on unmount, and test for leaks by toggling full screen 20 times
- **Quality tiers** (auto-detected, user-overridable in a small ⚙ menu):
  - High: shadows, bloom, people, full interiors
  - Mid: no post, smaller shadows, no people
  - Low: no shadows (contact shadow only), no bloom, reduced trees, focused plant only
- **Fallback to 2D.** If WebGL2 is unavailable, the GPU is blocklisted (very low fps on mid for over 5 s), the viewport is under 768 px wide (mobile), or the user picks "Flat," render the **existing flat isometric map**, upgraded with the same data bindings (rack fill bars, lot state colors, money arcs, refusal markers). The tour then runs as a 2D version (pans and zooms over the flat map plus the same captions).
- **Mobile:** the twin defaults to the flat map with a "Try 3D" button. 3D on mobile uses the low tier.

### 4.12 Accessibility

- Every 3D object that can be selected has a 2D equivalent: an **"Objects" list panel** (searchable) beside the canvas lists buildings, departments, trucks en route, lots in quarantine and chain events. Selecting from the list flies the camera there and opens the inspector.
- **Keyboard:** Tab cycles focusable hotspots (departments, HQ, Escrow, contract nodes), Enter selects, and arrows orbit slightly.
- An ARIA live region announces significant events ("PO-1042 refused by spend policy," "Lot ASC-261116-01 released"), throttled.
- **Color is never the only signal:** quarantine pallets also get a striped pattern or a small "Q" decal, refusals get a shield glyph, and released lots get a check.
- `prefers-reduced-motion` means no auto-camera, crossfades instead of fly-tos, and static beams with periodic highlights instead of flowing particles.
- **Contrast:** labels meet WCAG AA against their backdrops, so use a pill background behind every label.

### 4.13 Suggested scene graph

This is a sketch. Map it onto the existing scene components and keep their names where they exist.

```
<TwinCanvas>                       // lazy chunk; quality tier, DPR, frameloop policy
  <SceneLighting simNow />         // sun, hemi, fog, sky gradient — time-of-day driven
  <Ground /> <Roads /> <TreesInstanced /> <CarsInstanced />
  <Campus>
    <PlantHollowPine detail="full">
      <BuildingShell roofCutaway />                 // merged static geometry
      <Department id="receiving">  <DockDoors/> <StagingLane/> </Department>
      <Department id="quarantine"> <Cage/> </Department>
      <Department id="warehouse">  <RacksMerged/> </Department>
      <Department id="weigh_dispense"> … </Department>
      <Department id="blending"> … </Department>
      <Department id="compression"> <PressInstanced/> </Department>
      <Department id="encap_fill"> … </Department>
      <Department id="packaging"> <BottleLine/> </Department>
      <Department id="qc_lab"> <ReleaseTerminal/> </Department>
      <ShippingDock/>
    </PlantHollowPine>
    <PlantRiverside detail="exterior" />  <PlantLakeview detail="exterior" />
    <AcmeHQ budgetRing />  <EscrowVault balance />  <SuppliersYard />  <CustomersExit />
  </Campus>
  <PalletsInstanced />   // ALL pallets across plants, one InstancedMesh (+ wrap tops)
  <TrucksLayer />        // controllers + small pool of truck meshes (pool size ≈ 16)
  <MoneyBeamsLayer />    // pooled beams, max ≈ 12
  <PeopleInstanced />    // optional tier
  <ChainLayer visible={curtain}>
    <ContractNode id="spend_policy" /> <ContractNode id="escrow" /> <ContractNode id="credentials" /> <ContractNode id="anchors" />
    <AccountOrbs /> <Beams /> <TxPulses /> <RefusalShields /> <AnchorPinsInstanced /> <EnclaveCube />
  </ChainLayer>
  <Labels />  <SelectionOutline />  <CameraRig presets tour />
  <PostFX tier />
</TwinCanvas>
<TwinOverlay> header bar · Views pill · layer chips · legend · Objects list · Inspector · captions </TwinOverlay>
```

### 4.14 Build order inside the twin (so it's demoable at every step)

1. **Full-screen shell.** Add the camera rig with presets and fly-to, plus the inspector wiring, using the *existing* buildings. This alone is a visible upgrade.
2. **Data-bound pallets.** Build `PalletsInstanced` from the snapshot, with lot-state colors, plus seek snapping.
3. **Event controllers.** Add trucks (receipt and shipment), QC release, machine animation and money beams. Drive them from the event → animation table.
4. **Interiors.** Add the Hollow Pine cutaway departments and the not-yet-online styling.
5. **The 3D curtain.** Add the ghost materials, chain layer, pulses, shields and pins.
6. **Time-of-day lighting** plus visual polish (bloom, labels, outlines).
7. **The scripted tour** and clean-capture mode.
8. **Performance work.** Build the tier system, LOD and the flat-fallback data binding.
9. **Accessibility.** Add the Objects list, keyboard hotspots and live region.

Commit after each step. If time runs short, steps 1–5 and 7 are the must-haves for the video. Riverside and Lakeview interiors and people are the first things to cut.

### 4.15 Common pitfalls to avoid

- **Re-creating React components per pallet or truck per tick.** This kills fps. Use pooled controllers.
- **Transparent ghost materials that z-fight or sort wrong.** Render the ghost pass with `depthWrite=false` and a fixed `renderOrder`. Draw the chain layer after it.
- **Shadow acne** on big flat roofs. Tune `shadow.bias` and `normalBias`, and fit the shadow camera tightly to the focused plant.
- **HTML labels tanking performance.** Cap the count, hide them off-screen, and use `occlude` sparingly. Consider sprite text (troika / drei `Text`) for dense label sets.
- **Floating-point jitter** at a far zoom. Keep the campus within ±1 km of the origin.
- **Bloom washing out the UI palette.** Keep the threshold high, so only beams, pulses, windows and shields bloom.
- **Animations drifting from data after a seek.** Always snap from the snapshot, then animate forward.

### 4.16 Acceptance criteria (3D)

- [ ] **Stack:** the twin uses the same 3D library as the current Plant map, with no second renderer.
- [ ] **Full screen:** the twin opens via route or button or `F`, and closes with Esc. The header collapses into a translucent bar.
- [ ] Hollow Pine has an enterable interior with at least these departments matching the data: Receiving, Quarantine, Warehouse, Weigh & Dispense, Compression, Packaging and QC Lab. The "online / not yet" state matches "Your integration."
- [ ] **Warehouse pallets:** their count and states equal the on-hand lots at `simNow` (test: compare the scene's instance count by state to the data snapshot for 3 timestamps).
- [ ] **Trucks:** they arrive on receipt events and leave on fulfillments, and the quarantine → released color change happens on QC release.
- [ ] **Money streams:** they flow HQ → Escrow on funding and Escrow → supplier on release, with amounts from the data.
- [ ] **Curtain:** the 3D curtain shows contract nodes, account orbs, tx pulses, red shields on refusals with verbatim reasons, and anchor pins. Recorded tx are clickable with working explorer links. Simulated ones are visibly distinct.
- [ ] **Inspector:** clicking any object opens the shared inspector with the ERP record (plus chain info when the curtain is on).
- [ ] **Tour:** it plays all 10 beats deterministically offline, and clean-capture mode works at 1080p.
- [ ] **Performance:** 60 fps on the campus view on the reference laptop (record an fps measurement in the final report), with auto-degrade working.
- [ ] **Flat fallback:** it works with WebGL disabled and is the default under 768 px.
- [ ] **Accessibility:** the Objects list and keyboard navigation work, and reduced motion is honored.
- [ ] **Don't break:** the existing Flat/3D toggle, the "This run / Group buy" toggle, the layer chips, the legend semantics and the Plant map page continue to work. The existing embedded card on Overview still renders.

---

## 5. UI upgrade: design system, header, pages, judge mode

**Anthony's taste:** good visuals, easy to navigate, looks cool. Today's app is clean and trustworthy, but it reads like a document. The direction is **"mission control, but friendly"**:

- a dark-capable, data-dense, glanceable dashboard that a plant purchaser could still use at 6 AM
- big numbers, small words
- color that *means* something
- motion that explains

The Overview (§5.6), Attack arena (§3.1) and Money page (§2 and §5.6) descriptions set the mood. Keep the existing brand anchors:

- the **pine-green "K" tile**
- the pine-green primary buttons ("Start over," "YES 1042," "Approve the move")
- the existing status chip vocabulary (paid, released, refused, funded, "before you buy," "run complete," "refused · needs Linda")
- the amber left-border "Waiting on a person" pattern
- the dark curtain panel styling

### 5.1 Principles

1. **One glance, one number, one context line.** Replace sentence paragraphs in cards with a big value, a delta, a sparkline and one context line of six words or fewer. Move the full sentence to a tooltip or the inspector.
2. **Color has meaning, and only meaning.** Green means good or released, amber means waiting or quarantine, red means refused or rejected, gold means money, cyan means chain, blue means in progress. Nothing decorative uses these colors.
3. **Every number is clickable.** It opens the inspector or the filtered page that produced it. Nothing is a dead end.
4. **The clock is always visible.** Every page reflects `simNow`. Change the time, and everything changes.
5. **Staff vs. judges.** Staff views are chain-free. Judge and curtain views add the chain without rearranging the staff layout, so the toggle is a reveal, not a page change.
6. **Never empty.** No "0 transactions" or "No transactions yet" on a demo path (§5.7).
7. **Reuse, then restyle.** Find the existing card, table, chip and sidebar components and evolve them with tokens. Don't fork a parallel component library.

### 5.2 Design tokens (light + dark)

Find how styles are done today (Tailwind config, CSS variables, CSS modules, a theme object) and **implement these as tokens in that system**. If it's Tailwind, extend `theme` with CSS variables so dark mode is a variable swap. Pick final values by eye against the existing brand green. These are starting points.

**Color: core**

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F4F6F8` (keep the soft blue-gray gradient feel) | `#0B1018` |
| `--surface-1` (cards) | `#FFFFFF` | `#111823` |
| `--surface-2` (raised / hover) | `#F8FAFC` | `#172130` |
| `--surface-glass` (overlays on 3D) | `rgba(255,255,255,.72)` + blur 16 | `rgba(17,24,35,.66)` + blur 16 |
| `--border` | `#E3E8EE` | `#223044` |
| `--text` | `#0F172A` | `#E8EEF5` |
| `--text-muted` | `#5B6778` | `#93A1B3` |
| `--text-faint` | `#8A96A6` | `#64748B` |
| `--brand-500` (pine green) | match existing, about `#1F6B54` | `#2E9E78` |
| `--brand-600` (pressed) | `#17543F` | `#23805F` |
| `--brand-tint` | `#E6F2ED` | `rgba(46,158,120,.14)` |
| `--focus-ring` | `#2E9E78` @ 40% | `#38D3E8` @ 50% |

**Color: semantic (both modes, tuned for contrast)**

| Token | Use | Light | Dark |
|---|---|---|---|
| `--ok` | released, paid, matched, online | `#15803D` | `#34D399` |
| `--wait` | quarantine, needs a person, warning | `#B45309` | `#F2A93B` |
| `--bad` | refused, rejected, disputed, overdue | `#B91C1C` | `#F0524F` |
| `--money` | money flows, escrow, savings highlights | `#A16207` | `#F5C451` |
| `--chain` | curtain, tx, anchors, contracts | `#0E7490` | `#38D3E8` |
| `--info` | in progress, QC testing, in use, funded | `#1D4ED8` | `#5B9CFF` |
| `--neutral` | consumed, not yet | `#64748B` | `#7B8794` |

Each semantic color also gets `-tint` (a chip background at about 12–16% alpha) and `-border` variants.

**Lot-state map** (one source of truth, also used by 3D and the flat map):

| State | Token |
|---|---|
| on order | neutral |
| en route | info (outline) |
| received | info |
| quarantine | wait |
| released | ok |
| in use | info (solid) |
| consumed | neutral |
| wasted | bad (muted) |
| rejected | bad |

**Typography**

- **UI:** keep the current sans (it looks like Inter or system). Use `font-feature-settings: "tnum"` (tabular numerals) for every number.
- **Mono** (chain, IDs in the curtain): keep the current mono (JetBrains Mono or similar).
- **Scale (px / line height):**
  - 12/16 caption
  - 13/18 label
  - 14/20 body
  - 16/24 body-lg
  - 20/28 h3
  - 24/32 h2
  - 32/40 h1 (page title)
  - 44/48 stat-xl
  - 64/64 hero-number (for the Kevin counter)
- **Weights:** 400 body, 500 labels, 600 headings, 700 big numbers.
- **Eyebrows:** keep the existing uppercase eyebrow style ("HOLLOW PINE TABLET CO. › OVERVIEW," "THREE PLANTS · ONE TRUTH") at 12 px with 0.08 em tracking.

**Spacing, radius, elevation**

- **Spacing:** 4-pt grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Card padding is 20 (dense) or 24 (default). The grid gap is 16 on desktop and 12 on mobile.
- **Radius:** 6 (chips, inputs), 10 (buttons), 14 (cards, matching the current rounded cards), 20 (hero panels, glass overlays), and full (pills, avatars).
- **Elevation:**
  - light mode uses soft shadows: `e1 0 1px 2px rgba(15,23,42,.06)`, `e2 0 4px 12px rgba(15,23,42,.08)`, `e3 0 12px 32px rgba(15,23,42,.12)`
  - dark mode uses borders and inner highlights, not shadows: `e1 = 1px var(--border)`, `e2 = border + 0 0 0 1px rgba(255,255,255,.02) inset`, `e3 = glow for focused or hero, 0 0 24px rgba(46,158,120,.18)`
- **Glass:** overlays on the 3D twin use `--surface-glass`, `backdrop-filter: blur(16px) saturate(140%)` and a 1 px border at 8% white.

**Themes:**

- **Light** is the staff default (friendly, plant-floor).
- **Dark** is the mission-control mode. It's the default in judge mode and in the full-screen twin.
- Add a theme switch in the header overflow menu (System · Light · Dark) and persist it.
- **Both themes must look intentional:** test every page in both.

### 5.3 Global header (consistent on every page)

The current app has no global header: the plant switcher sits at the top of the sidebar, and the curtain toggle at the bottom. Add a **56 px global header** across the top of the content area, dark, with an icon-only nav rail beside it. Left to right:

1. **Breadcrumb / page title area.** Keep the existing eyebrow ("HOLLOW PINE TABLET CO. › PURCHASING") either in the header or as the first line of the page. Pick one, and be consistent.
2. **Plant switcher pill:** Hollow Pine Tablet Co. ▾ / Acme Riverside / Acme Lakeview / All plants. This moves the existing sidebar plant card ("Hollow Pine Tablet Co. · Plant B · joining Acme") into the header, or mirrors it, with one state. "All plants" shows aggregated views where they make sense (Money, Suppliers, Three plants).
3. **Sim clock control** (center):
   - ⏯ play/pause
   - speed chips 1× · 10× · 100×
   - date-time readout (tabular, "Mon Nov 9 · 6:42 AM")
   - a chip: **Recorded** (cyan) or **Simulated** (neutral)
   - a ▾ opening the scrubber/timeline popover: a 12-month bar with incident markers and the golden-run window, plus the "Jump to…" presets
4. **Kevin status chip:** an avatar "K" with a status dot and text (idle · reading · drafting · waiting on Linda · paying · signed ✓). Click it to open the activity drawer, or focus the rail.
5. **"Kevin saved" mini counter** (optional; if it's too crowded, put it on Overview only): "$18.6k saved · 3.1×". It ticks when a saving lands.
6. **⌘K search / command palette:** jump to any record by ID (PO-1042, ASC-261116-01, BR-B-1045), page, supplier or action ("Run recall drill," "Fire attack," "Start tour").
7. **Curtain toggle:** "Behind the curtain," with a shield icon, cyan when on. It's the same state as the existing sidebar footer toggle ("Protected · Behind the curtain"). Keep that one too, or replace it with a compact status line, but **only one source of truth**.
8. **Judge mode button:** pine-green, "Judge mode."
9. **Persona switcher:** the existing persona card (Ray Delgado · Purchaser · up next; Day One · Run summary) as an avatar menu. Ray, Linda, Marcy and Priya each see their "up next."

**Behavior:**

- The header is sticky, the same on every page, and collapses on scroll to 48 px (hiding the counter).
- Under 1024 px, it becomes title + clock (compact) + curtain + a ☰ overflow with the rest.
- In the full-screen twin it becomes the translucent thin bar (§4.2).

### 5.4 Left navigation

Keep the current grouping logic, which works. Clean it up and add the new pages:

- **PLANT**
  - Your integration
  - Overview
  - Plant twin (renamed from "Plant map"; the Flat/3D toggle lives inside)
  - 5am brief
  - Batch records
  - Inventory & forecast
  - **Lots & recall** (new)
  - Schedule
  - Purchasing
  - Invoices
  - Spreadsheets
- **MONEY** (new group)
  - **Money** (new)
  - Bookkeeper export
- **ACROSS ACME**
  - Three plants
  - ERP connection
  - Group purchasing
- **ACME HQ**
  - Spending limits
  - Suppliers (now with scorecards)
  - Sealed bids
  - Reconciliation
- **PROOF** (new group; visible to everyone, styled with a subtle cyan accent)
  - **Attack arena**
  - **Talk to Kevin**
  - **What-if**

Notes:

- Keep the existing count badges (amber "3"/"4," red "1"). Make them derive from `simNow`.
- Collapsible to a 64 px icon rail (persist the choice). Icons are the existing line icons. Tooltips on hover when collapsed.
- The active item gets a brand-tint background and a 2 px left accent bar.
- **Footer:** compact curtain status plus persona (as today), and the theme switch.
- **Home:** "Your integration" stays the first-run home. Once all stages are done, which they are in the recorded state ("8 of 8 done"), default to **Overview**, with Your integration one click away.

### 5.5 Component kit (build or upgrade these first, then use everywhere)

- **StatTile** (replaces the current white number cards)
  - label (12/16 muted)
  - value (44 bold, tabular)
  - unit suffix (smaller)
  - delta chip (▲▼ with semantic color, plus "vs prior 4 wk")
  - sparkline (8–12 points, 32 px tall, with a faint reference band such as a target or reorder point)
  - context line (six words or fewer)
  - optional mini visual instead of a sparkline: gauge, ring, bullet bar or stacked bar
  - **The whole tile is clickable.** Hover lifts it (e2) and shows "View →."
- **Gauge** (semicircle) and **Ring** (progress): for yield vs. standard, commitment vs. $60k, budget vs. actual, break-even.
- **BulletBar:** actual vs. target vs. limit (great for per-PO limit and budgets).
- **Sparkline:** with a hover crosshair and tooltip, optional threshold line, and an end-dot in a semantic color.
- **StatusChip:** one component with all states (paid, released, refused, funded, quarantine, needs Linda, before you buy, run complete, recorded, simulated, signed, fallback). Use the existing vocabulary.
- **LotBadge:** an ID in mono with a state-colored left dot. Click it to open the inspector.
- **RecordLink:** any ID (PO, lot, batch, bill, RFQ, tx), with an inspector on click and a preview on hover (a 300 ms delay popover with the 4 key fields).
- **MoneyAmount:** tabular, with a currency symbol, smart compaction ($18.6k) with the full value in the tooltip, and optional "held" or "paid" styling.
- **Timeline / Stepper:** for the PO lifecycle, the integration stages and tour beats.
- **ActivityItem** (feed).
- **ChainTxRow:** the existing curtain card (method, signed by, gas paid by, events, explorer link, ✓ or ✗ refused, with the red-bordered refused variant). Keep its look; it's already good.
- **InspectorDrawer** (§5.8).
- **DataTable:** sticky header, virtualized rows, column filters, state chips, row hover with a quick-action, an inline expand for lines, and a per-page density toggle.
- **EmptyState, Skeleton, ErrorCard** (§5.11).
- **PhoneFrame:** for Linda's text approval and the mobile previews (§5.9).
- **CommandPalette** (⌘K).

### 5.6 Page-by-page redesign

For each page: what it is today (from the screenshots) → what it becomes.

#### Overview

- **Today:** four white stat cards:
  - "Batches, last 4 weeks · 8 · ↓1 vs the 4 weeks before (9)"
  - "Tablet yield · 90.4% · ↓0.1 pt"
  - "Below reorder point · 3/4 materials"
  - "Spend this month · $5,150 / $0 · $612.00 held for orders on the way"
  
  Then a Plant map card (This run / Group buy; Flat / 3D), "Up next" (Linda's text approval with NO 1042 / YES 1042), "The run so far" (step cards with people and chips), and a Recent batches table (BR-B-1045, BP-B-0509, BC-B-0309).
- **Becomes:**
  - **Row 1: Today strip.** At dawn this is the 5am brief (§1.3); later it's a compact strip: "3 need a person · 2 trucks today · 1 batch running · $612 in escrow."
  - **Row 2: 4–6 StatTiles:**
    - Batches (28 d) with a sparkline
    - Yield, as a **gauge** vs. the standard band (89–92%)
    - Below reorder (count plus a red/amber chip, with the materials on hover)
    - Spend this month, as a **BulletBar** vs. $60k commitment, with the per-PO limit marker
    - Kevin saved (ring)
    - On-time receipts (90 d)
    
    The window follows the sim clock (default trailing 28 days, with a selector for 7d / 28d / 90d / 12m).
  - **Row 3 (left 2/3): live twin card.** The embedded 3D twin (or flat map), with the "Full screen" button, the same toggles as today and the legend below (online · not yet · money · quarantine · refused).
  - **Row 3 (right 1/3): "Needs a person."** The existing "Up next" content becomes a queue of cards (Linda's text approval stays the hero card in the golden run). Each card has inline actions, and the amber left border is kept.
  - **Row 4 (left): "The run so far"** becomes a horizontal **Timeline** of today's events (people avatars, chips), scrollable. Clicking one opens the inspector.
  - **Row 4 (right): Recent batches.** A compact DataTable with a yield mini-bar per row and a waste column with an amber flag when over standard.
  - **Right rail:** Kevin's activity (§1.2), or the curtain when it's on.

#### Purchasing

- **Today:**
  - stat cards ("Received this month, Nov · $5,150.00 · Kevin may commit $60,000.00 a month," "Per-PO limit $2,500 · over it, Linda Park approves," "Open purchase orders 1 · $612.00," "Last quotes 3 · RFQ-2611-01; QuickChem Direct out")
  - Orders (35) / Quotes (1) tabs, with a table (PO, Raw materials, Supplier, Date, Total, State chip)
  - the curtain panel showing "0 transactions"
- **Becomes:**
  - **StatTiles:**
    - Committed this month, as a BulletBar vs. $60k
    - Per-PO limit, shown as a **PO-size histogram** with a $2,500 line, where bars over the line are amber (needs Linda) or red (refused)
    - Open POs (count plus $ and an "arriving" mini timeline)
    - Quote coverage ("3 quotes avg · 1 supplier out")
  - **Pipeline view (new, default):** a Kanban-like lane view by PO state (Draft → Needs approval → Funded (escrow) → Shipped → Received / QC → Paid), with cards showing PO, supplier, $ and age. There's a toggle to the Table view.
  - **Table:** the full 12 months (about 130 POs for Hollow Pine), virtualized, with filters (state, supplier, material, date, approval path) and grouping by month. **Rows show approval-path icons:** auto (✓), Linda by text (📱), refused-then-approved (shield → ✓).
  - **Quotes tab:** RFQs with a quote comparison mini-chart per RFQ (price × lead time scatter, with the winner highlighted and suspended suppliers shown as "out" with a reason).
  - **PO detail (inspector or page):**
    - a lifecycle stepper
    - lines
    - the approval path, with **Linda's text thread** for PO-1042
    - receipt, lot(s) and QC
    - bill and 3-way match status
    - payment
    - curtain section with tx

#### ERP connection (desktop and mobile)

- **Today:**
  - "Connected to Acme Holdings ERP · the acquirer's system of record"
  - "Brought over at cutover · 34 · purchase orders, with 34 receipts; none typed in"
  - "Bills matched · 35 of 36"
  - "Reconciliation · 7 of 7 · all agree"
  - a long numbered text list, "What crossed on the recorded run" (Ray confirms → ADJ-515…; Small PO → PO-1041…; Big PO → PO-1042…; Kevin retries; Delivery → IR-35, NG-INV-24190…)
  - curtain "0 transactions"
  - The mobile version is the same stack.
- **Becomes:**
  - **Hero:** a **two-system diagram**, "Day One ⇄ Acme Holdings ERP." On the left are the Day One-owned objects (inventory, lots, escrow); on the right, the ERP-owned objects (vendor master, bills, approval matrix, GL). The middle connector shows animated record chips flowing by PO number when the clock plays. A status dot shows "Connected."
  - **StatTiles:**
    - Cutover 34/34, with a ring
    - Bills matched 35/36, as a ring with an amber slice; click it to see the one unmatched bill and why
    - Reconciliation 7/7 (green), with the 7 checks listed on hover
    - Last sync (sim time)
  - **"What crossed on the recorded run"** becomes a **vertical swimlane timeline** with two lanes (Day One | ERP) and the steps as connected cards: record type icon, ID (RecordLink), a one-line verdict and the contract verdict chip (funded / refused pending the director's approval / approved). Keep all the existing content and IDs ("matrix rule 4," tx abbreviations), but break the sentences into fields.
  - **Over 12 months:** a monthly bar of records synced by type (POs, receipts, bills, payments, adjustments), with cutover marked.
  - **Mobile:** stat tiles 2×2, then the swimlane collapsed to a single lane with lane tags.
  - The curtain shows the connector's anchored tx (§5.7).

#### Three plants

- **Today:**
  - "THREE PLANTS · ONE TRUTH" with tiles ("Needs a person 5 · 1 to review · 4 moves," "Low stock 6 materials · below the reorder point," "Mass balance 115.199 kg · unaccounted at Acme Riverside")
  - "Waiting on a person": long "before you buy" sentences ("Before you buy: Acme Lakeview has 96,000 of 150 cc HDPE bottle (BTL) above its own need and reorder point. Moving 16,000 (BTL-260905-01) to Hollow Pine Tablet Co. keeps it at its reorder point instead of ordering 100,000. That is about $336.00…"), with Approve the move / Dismiss buttons
- **Becomes:**
  - **Top:** a **three-column plant comparison**, one column per plant, each with:
    - a mini status
    - departments online
    - stock health (a ring: % of materials above reorder)
    - spend (month)
    - on-time
    - yield
    - a mass-balance flag (Riverside's 115.199 kg in amber)
  - **"Waiting on a person"** stays, with the amber left border kept, but each move becomes a **visual transfer card**:

    ```
    [Lakeview] —16,000 BTL→ [Hollow Pine]
    stock-after bars for both plants with the reorder-point tick
    "Saves ≈ $336.00 vs ordering 100,000"
    Approve / Dismiss
    ```

    The full sentence goes into a "Why?" expander.
  - **Map strip:** a small three-plant map (or a twin preset) showing pending moves as dashed arrows.
  - **Material matrix (new):** rows are materials, columns are plants, cells show on-hand vs. reorder as a tiny bullet bar. It's the "one truth" in one glance.

#### Plant map → Plant twin

- **Today:**
  - the 3D card with labels (Weigh & Dispense, Compression, QC Lab), Escrow ($612.00 held), Acme HQ (budget) and the refused red arc
  - "Plant B: 4 of 9 departments online. PO-1042 · $5,150.00 refused, refused by the contract (tx FQepeewB…)."
  - "Replay of a run recorded on 2026-10-29."
- **Becomes:** a page that's mostly the twin (§4), with the canvas filling the content area, a left "Objects" list (collapsible), the Views pill, the layer chips and the legend. It has a "Full screen" button, and the inspector on the right. Keep the replay note and the fictional-data note as a small footer chip.

#### Your integration

- **Today:** "Seven stages after you meet Kevin…," a Progress bar showing 8 of 8 done, and stages 0–7 as a checklist:
  - 0 Meet Kevin
  - 1 Your spreadsheets
  - 2 Your paper
  - 3 Your products and schedule
  - 4 Your suppliers and spend rules
  - 5 Your first order
  - 6 Your books and the ERP
  - 7 Day to day
  
  Then Kevin's message ("We're set…"), with the curtain at 0 transactions.
- **Becomes:**
  - A **horizontal journey map**: 8 stage nodes on a path. Each completed node shows its key artifact as a mini-thumbnail and stat. For example, stage 1 shows "12 months imported · 1,214 rows," and stage 5 shows "PO-1042 · paid."
  - Clicking a stage expands a panel with what Kevin did, who checked it, and links.
  - The checklist remains as an accessible list view.
  - A small **plant illustration lights up department by department** as stages complete, tied to "4 of 9 departments online."
  - The curtain shows the stage's anchored records.

#### Pages not in the screenshots

Batch records, Inventory & forecast, Schedule, Invoices, Spreadsheets, Spending limits, Group purchasing, Sealed bids, Bookkeeper export and Reconciliation get the same treatment:

- StatTiles on top
- a visual primary element:
  - Inventory gets **stock-level bars with reorder lines and a forecast cone**
  - Schedule gets a **Gantt by line** driven by generated batches
  - Spending limits gets **gauges and the PO-size histogram**
  - Sealed bids gets a **commit → reveal timeline**
  - Group purchasing gets a **three-plant allocation donut** for PO-G-2001
  - Reconciliation gets **7 check cards with green ticks** and a "History health" section (§2.1.9)
- a DataTable below

Keep each page's existing logic and copy where it's correct.

#### New pages

- **Money.**
  - **Hero row:**
    - the "Kevin paid for himself" panel (hero-number count-up, ratio, ring, a realized vs. identified toggle)
    - tiles for cash on hand (modeled), inventory value, turns (gauge), DOH and escrow held (lock icon, gold)
  - **Middle:**
    - a 12-month cash flow chart (stacked in/out with a net line and incident annotations)
    - working capital by inventory class (stacked area)
  - **Bottom:**
    - AP aging (stacked bar plus bucket lists)
    - spend vs. budget heatmap (category × month, per plant)
    - **Savings ledger** (a table with type icons, status chips "identified/realized," amount, evidence links, and a formula tooltip)
  - Plant filter in the header. Every number has an ⓘ formula popover.
- **Suppliers (upgraded).**
  - a leaderboard table with reputation score (0–100 bar), on-time %, QC %, price index, invoice accuracy, a credential chip (active / suspended) and trend sparklines
  - a detail page per supplier: price history, lead-time histogram, recent lots, the credential card (curtain: NEP-393 tx), and "Why Kevin picks them"
  - the "Run disruption drill" button
- **Lots & recall:** §2.3. Search, genealogy graph, "Run recall drill."
- **Attack arena:** §3.1.
- **Talk to Kevin:** §3.2. Chat with citations, an attestation chip and suggested question chips. The left column has an "Ask about this page" context.
- **What-if:** §3.4. Scenario builder plus base-vs-scenario comparisons.

### 5.7 The curtain panel is never empty

**Today:** "BEHIND THE CURTAIN · NEAR TESTNET · 0 transactions," the spend-policy budget readout, "Kevin's model ran in a hardware enclave ✓ 15 enclave checks ✓ 2 signed answers," then "No transactions yet." That's on ERP connection, Purchasing, Your integration and others. On Overview and Plant map, it shows the tx cards (submit_po, approve_po, accept_po, mark_shipped, confirm_receipt, anchor, anchor_batch), with the refused ones in red. Those cards look great. Keep them.

**Fix:**

1. **Page-relevant first.** Each page declares a selector for the tx it cares about:
   - Purchasing: all `submit_po` / `approve_po` / escrow tx for POs in view
   - ERP connection: tx referenced by the connector steps (D28BgcP3…, 3sUEp63g…, EW5A8qi3…)
   - Your integration: tx anchored by each stage
   - Suppliers: credential and anchor tx
   - Money: escrow fund and release tx, plus PO-1047 USDC
   - Lots: `anchor_batch` and QC-related
   - Attack arena: refusals
2. **If the page has none at `simNow`,** show **"Recent on testnet"**, the latest recorded tx across the app, with a small note "Nothing on chain for this page yet. Here's the latest."
3. **Simulated items** show in a separate subsection, "Simulated · would anchor" (dashed cyan, no explorer link), so the panel has life outside the golden run without inventing hashes.
4. **The header summary** keeps the spend-policy budget and escrowed readout, plus the enclave box. Make the counts live:
   - "N transactions on this page · M total recorded"
   - "15 enclave checks · N signed answers"
5. **Linking:** hovering a tx card highlights the related row on the page and the object in 3D. Clicking it opens the inspector.

**Acceptance:** no demo-path page shows "0 transactions" or "No transactions yet" with the curtain on. Write a test that visits every route with the curtain on and asserts that at least one tx card renders.

### 5.8 Inspector drawer (shared)

- A right-side drawer (480 px on desktop; a full-height sheet on mobile).
- Stackable, with a back arrow for drill-down (PO → lot → batch → shipment).
- Deep-linkable (`?inspect=PO-1042`).
- **Sections:**
  - header (type, ID, state chip, plant)
  - key fields (2-column)
  - lifecycle stepper
  - related records (RecordLinks)
  - documents (batch record image or PDF preview if it exists, CoA mock)
  - chain (curtain on)
  - actions
- The same component is used from tables, the feed, 3D, the curtain, chat citations and judge mode.

### 5.9 Mobile views (two must-haves)

1. **Linda's text approval (phone).**
   - A **PhoneFrame** mock at 390×844, with an iMessage-like thread from "Kevin": "Kevin needs approval: PO-1042, $5,150.00 to Northgate Ingredients for 700 kg ascorbic acid. Over Kevin's $2,500.00 limit. Reply YES 1042 or NO 1042."
   - Two large buttons, NO 1042 (outlined red) and YES 1042 (pine-green), the same as the existing Overview card.
   - After YES, a confirmation bubble and a tiny "Approved on testnet ✓" line, visible only with the curtain on.
   - It must also work as a **real mobile route** (`/m/approve/1042`, or whatever fits the routing) that renders well on an actual phone, because judges may open it on theirs. In the golden run, the real recorded approval is the one shown. In live mode, it's session-only.
   - It's also used in the tour (beat 5) as a split-screen overlay.
2. **Receiving dock mode (phone or tablet).**
   - Find the existing receiving dock mode with lot labels and extend it into a **mobile-first** flow:
     1. today's expected trucks (cards)
     2. "Truck arrived" → scan, or pick the PO (big tap targets, at least 48 px)
     3. confirm qty per line with a stepper
     4. print or show the lot label (existing lot labels: ASC-261116-01 with a QR-style placeholder)
     5. "Into quarantine" (amber confirmation)
   - The dock persona is receiving.plant-b in chain terms, but staff see no chain words.
   - It works one-handed, with high contrast (dock lighting) and offline-tolerant UI states (just visual).
   
Also make Overview, Purchasing and ERP connection responsive (the existing ERP connection mobile layout is a good start), with a **bottom tab bar** on mobile: Today · Orders · Stock · Kevin · More.

### 5.10 Motion guidelines

- **Durations:**
  - micro (hover, press) 120–160 ms
  - UI transitions (drawers, tabs) 200–260 ms
  - number count-ups 600–900 ms
  - page-level reveals 300 ms, staggered by 40 ms per card, at most 6 staggered items
  - camera 1.2–1.8 s
  - curtain transition 1.2 s
- **Easing:** `cubic-bezier(.2,.8,.2,1)` for enter, `cubic-bezier(.4,0,1,1)` for exit, and spring for drawers if the repo has a motion library (Framer Motion or similar). Otherwise use CSS transitions.
- **Meaningful motion only:** a number counts up when its value changes because of a clock event, a chip flashes once when a state changes, the activity item slides in, money beams move, and the refusal shield fades in (a short 200 ms fade or scale, never a cartoon stamp). **No idle looping animations** except the subtle live pulse on the Kevin status dot and the clock.
- **Refusal moments** get a slightly heavier treatment everywhere (2D and 3D): a quick 80 ms scale-in of the red badge plus a soft glow, never a shake.
- **`prefers-reduced-motion`:** count-ups become instant, slides become fades, and there's no camera motion.

### 5.11 Empty, loading and error states

- **Loading:** skeletons shaped like the final content (StatTile skeleton with a bar and sparkline placeholder; table rows). No spinners except inside buttons.
- **Empty:** a friendly illustration-light message plus a next action. For example, "No open POs right now. Kevin will draft one when stock nears reorder. [Jump to next reorder]". Empty states are always **scoped to `simNow`** and offer a clock jump to when something happens.
- **Error:** an inline ErrorCard with what failed, "Try again," and for chain or inference calls, an automatic fallback to recorded data, labeled.
  - Testnet RPC down: the curtain shows recorded data plus an amber "Live testnet unreachable · showing recorded" chip.
  - NEAR AI Cloud down: the Anthropic fallback chip.
- Never show raw stack traces or JSON to users. Put them in a collapsible "Details" for judges.

### 5.12 Judge mode

**Goal:** a judge has a few minutes. Hand them the story in one click, with proof at every step.

- **Entry:** the header's "Judge mode" button, or the URL `?judge=1`, which is great for the submission link. It switches to dark theme, turns the curtain on, sets the clock to the golden-run start, and opens a **guided stepper overlay**: a docked bottom bar on desktop and a bottom sheet on mobile.
- **Steps** (each one: navigates, highlights the relevant UI with a spotlight cutout, shows a 1–2 sentence explanation, and offers a **"See it on chain ↗"** link to the recorded testnet tx):
  1. **Meet Kevin, and the twist.** "Staff never see the chain. You will." Overview at dawn, then a curtain flip.
  2. **PO-1042 refused by the contract.** Purchasing → PO-1042 inspector, with the red shield (in 3D if available). The link goes to the refused `submit_po` tx.
  3. **Linda approves by text.** The phone mock, with links to the `approve_po` tx and the funded `submit_po` tx.
  4. **Escrow released on QC.** Lot ASC-261116-01 → QC release → payment, with the `confirm_receipt` and release tx links.
  5. **15 of 15 attacks refused.** The attack arena, where the judge fires one themselves (recorded mode). "Try all 15."
  6. **Group buy PO-G-2001, $9,490.** Group purchasing, with the allocation donut and tx links.
  7. **7 of 7 reconciliation.** ERP connection or Reconciliation, with the 7 check cards.
  8. **Real USDC: PO-1047, $19.00.** Money → escrow, with the Circle testnet USDC tx link.
  9. **Attested answers.** Talk to Kevin, a recorded signed answer, and the attestation details. Mention the TEE re-verification after recording.
  10. **(Optional) Recall drill** and **Play the tour.**
- **Controls:** Next / Back / Skip / Exit, a progress dots indicator ("Step 3 of 9"), an estimated time remaining, and a final **summary card** with all proof links in one list plus "577 tests green" (link to the CI badge or test report if one is public by Nov 13).
- **Robustness:** judge mode uses **recorded data only** and works with no wallet, no login and no network to inference. Every "See it on chain" link is a real recorded explorer URL. Test every link in CI (HEAD request to the explorer, or at least URL format validation plus a manual check list).

### 5.13 UI acceptance criteria

- [ ] **Tokens:** they're implemented and used; no hard-coded hex values remain in components (lint or grep check).
- [ ] **Themes:** light and dark are both polished on every page, with WCAG AA contrast for text.
- [ ] **Header and nav:** the global header is on every page, and the new nav groups and pages are reachable.
- [ ] **Overview, Purchasing, ERP connection, Three plants, Plant twin and Your integration** are redesigned per §5.6. Sentence-cards are replaced with visual stats, and the sentences are preserved in tooltips or expanders.
- [ ] **New pages:** Money, Suppliers (upgraded), Lots & recall, Attack arena, Talk to Kevin and What-if all work with real generated data.
- [ ] **Curtain:** it's never empty on demo paths (with a test).
- [ ] **Judge mode:** it completes end to end offline in under 5 minutes, and all links are valid.
- [ ] **Mobile:** Linda's approval and the receiving dock work on a 390 px viewport, and Overview, Purchasing and ERP connection are responsive.
- [ ] **States:** skeleton, empty and error states exist for every data view.
- [ ] **Quality:** Lighthouse (desktop) performance ≥ 85 and accessibility ≥ 95 on Overview, with the twin excluded or lazy.

---

## 6. Process and guardrails

### 6.1 Priority order (if anything has to give, cut from the bottom)

1. **Foundation:** the sim clock (§1.1), the 12-month generator with anchors (§2.1), the activity feed (§1.2), design tokens plus the global header (§5.2–5.3), and the never-empty curtain (§5.7).
2. **Strongest new proof:** the attack arena (§3.1), plus lot genealogy and the recall drill (§2.3).
3. **The hero visual:** 3D twin full screen, data binding and the 3D curtain (§4.1–4.9).
4. **The story:** judge mode (§5.12) and the scripted tour (§4.10).
5. **Depth:** the Money page and savings ledger (§2.4), the supplier scorecards (§2.2), and the page redesigns (§5.6).
6. **Rest:** what-if (§3.4), Talk to Kevin (§3.2), the disruption drill (§3.3), the dawn scene (§1.3), mobile dock mode (§5.9), the Riverside and Lakeview interiors, and the people layer.

Anthony loves the 12-month history and the money depth, so treat §2.1 and §2.4 as non-negotiable even though §2.4 sits at priority 5 for build order. Money depends on the data, so it naturally comes after the foundation.

**Not in scope at all:** agent-to-agent negotiation.

### 6.2 Milestones and commits

Work in small, reviewable commits on a feature branch, or the branch convention the repo uses. **Keep all existing tests green at every milestone.** Suggested milestones (each ends with tests passing and a short entry in `UPGRADE_LOG.md`):

- **M0 (recon).** Map the repo:
  - the data layer, step player, 3D lib, styling system and test setup
  - where every proof-point record and the 15 attack cases live
  
  Write the findings at the top of `UPGRADE_LOG.md`. Freeze a **snapshot of all proof-point records** for the anchor-integrity test. No behavior changes yet.
- **M1 (clock + event engine).** Absorb the step player into it, with the golden-run window replaying identically.
- **M2 (generator v1).** Hollow Pine 12 months, with anchors spliced in, invariants, determinism and the anchor-integrity tests.
- **M3 (generator v2).** Riverside and Lakeview, incidents, the supplier personalities and scorecards, the genealogy index and money derivations (`money.ts` plus tests).
- **M4 (design tokens, theme, header, nav, component kit).** Plus the curtain never-empty fix.
- **M5 (activity feed + Overview redesign + dawn/5am brief).**
- **M6 (attack arena, recorded mode).** Then live mode behind a flag.
- **M7 (Lots & recall + Suppliers + Money pages).**
- **M8 (3D twin steps 1–5, §4.14).**
- **M9 (judge mode + scripted tour + clean capture).** Plus the mobile Linda approval.
- **M10 (remaining page redesigns, what-if, Talk to Kevin, disruption drill, receiving dock mobile).**
- **M11 (performance pass, accessibility pass, both-theme visual QA, final report).**

### 6.3 The golden run (lock it)

- Define a single **golden run** as the canonical demo path: a sim start timestamp, a seed and an ordered script covering the 5am brief, BR-B-1046 / ADJ-515, PO-1042 refusal, Linda's YES, the truck, QC release of ASC-261116-01, the payout, the group buy PO-G-2001, PO-1047 USDC and the attack arena.
- Create a `?golden=1` entry, or a "Reset to demo start" action, that always lands there.
- **Add an e2e test** (Playwright, or whatever the repo uses) that runs the golden run plus judge mode plus the tour (at speed) and asserts the key texts, IDs, amounts and explorer URLs. **It must pass with the network blocked**, apart from the static explorer link URLs.
- Before every milestone commit, run the golden-run test.

### 6.4 Feature freeze

Plan for a **feature freeze on Nov 11**. Nov 12–14 are reserved for Anthony's demo video, README and polish (the repo goes public on Nov 13, and submission closes Nov 14 at 3:59 PM PST). Since you're doing this in one run, the practical meaning is:

- Finish in priority order.
- Leave the codebase in a **releasable state after every milestone.** Any unfinished feature must sit behind a flag that's off by default and must not appear in judge mode.
- **Polish beats breadth.** Five features that never break are better than ten that sometimes do.

### 6.5 Data and claims hygiene (restated, because it matters)

- **Testnet only.** Every explorer link points to the testnet explorer.
- Fictional companies, people, customers and lots only. If you add names, make them generic and fictional.
- **No compliance claims.** "Audit-friendly records" only. The recall feature is a "mock supplier recall notice" and a "trace."
- No real personal data anywhere: phone numbers in Linda's mock are obviously fake (e.g. "(555) 01xx"), or not shown.
- **Never fabricate tx hashes, signatures or attestations.** Simulated chain activity is labeled "Simulated · would anchor."
- Keep the existing on-page disclaimer ("All companies, people and numbers are fictional.") visible on the twin, judge mode and the Money page.

### 6.6 Testing expectations (summary)

- **All 577 existing tests stay green.**
- New test areas:
  - **clock:** determinism and seek correctness
  - **generator:** determinism, anchor integrity, mass balance, money invariants, policy invariants, seasonality and incidents
  - **reconciliation:** 7/7 over the expanded data
  - **money:** formula unit tests, plus no double-counting in the savings ledger
  - **genealogy:** trace equals brute-force
  - **attack arena:** the catalog equals the 15-case suite, plus recorded refusals
  - **curtain:** never empty on any route
  - **judge mode and golden run:** e2e, offline
  - **3D:** scene-vs-snapshot instance counts at 3 timestamps, WebGL-disabled fallback renders, and the tour beats run
  - **mobile:** Linda approval and dock flow at 390 px
- **Report the new total test count.** Something like 577 → 750+ is a great README line.

### 6.7 Final report (produce this at the end, as `UPGRADE_REPORT.md`)

Include:

1. **Summary:** what shipped, by section, with ✓ / partial / not done.
2. **What I couldn't verify or had to assume:** anything in this brief that didn't match the repo (names, pages, the 3D library, the attack list), and what you did instead.
3. **Proof-point integrity:** confirmation that PO-1042, PO-G-2001, PO-1047, 15/15, 7/7 and the TEE attestation records are unchanged, with the test name that proves it.
4. **Data:** the generator config summary (seed, plants, SKUs, materials, suppliers), the actual year counts (POs, receipts, lots, batches, shipments, bills, payments), the list of incidents with dates, and the data size on disk and gzipped.
5. **Money:** the formulas used, the final "Kevin paid for himself" number and its assumptions (Kevin's assumed cost), and realized vs. identified totals.
6. **Performance:** the twin fps on the reference machine (campus, curtain on), the seek time, the initial load size and the Lighthouse scores.
7. **Tests:** the before and after counts, and the new suites.
8. **Golden run and judge mode:** the URLs (`?golden=1`, `?judge=1`), the steps, and how long each takes.
9. **Demo-video helper:** the tour beat list with timestamps and captions, the clean-capture instructions, and the recommended recording settings.
10. **Known issues and risks** before Nov 14, and what to cut first if something breaks.
11. **A screenshot list:** which pages and states to capture for the README, with their routes.

---

## 7. One-paragraph recap (keep this in mind the whole run)

Make Day One feel like a **living plant**:

- One deterministic clock drives a 12-month, three-plant world, with the recorded golden run sitting untouched inside it.
- Kevin narrates his shift in an activity rail.
- Every number is visual, clickable and traceable to records and formulas.
- The money story ends in an honest "Kevin paid for himself" counter.
- Judges can **fire the 15 attacks themselves** and watch the contract refuse them.
- A recall notice is traced in seconds.
- The 3D twin becomes the hero: full screen, data-bound, enterable. **One curtain flip turns the plant to glass and shows the contracts, the pulses and the red shield that stopped PO-1042.**
- Judge mode and the scripted tour hand the story to anyone in under five minutes, offline.

Keep 577 tests green and add many more. Don't touch the proof points, use no real data, make no compliance claims, and build no negotiation. Finish with `UPGRADE_REPORT.md`.

**He does the paperwork. You run the plant.**
