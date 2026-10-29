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

_Empty until the design session proposes: the page list and navigation, the design system, each page sketched with its data sources, the twin concept, Kevin's assistant pattern, what is cut, and the build order with dates._
