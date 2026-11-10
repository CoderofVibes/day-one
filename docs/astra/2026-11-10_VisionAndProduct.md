# Day One against the original vision

Review date: November 10, 2026. Seats: product and visual direction, judge's read, consistency. Proposal only; no application or README edits in this pass.

## Recommendation

Day One remains faithful to the original idea in its workflow: Kevin reads plant paperwork, checks it against the plant's records, prepares the next action, and brings consequential decisions to people. Acquisition is a useful first customer and deployment moment. The broader purpose is helping a paper-run plant work with agents while its staff retain useful control.

The presentation has narrowed toward purchasing authorization. That is a strong proof of NEAR's role, but it gives less weight to the work Kevin removes and the operational problems he notices. The existing opening in README.md:3 makes the new owner's spending rules the main benefit. The product brief at PROJECT_BRIEF.md:51 describes a wider transition from paper and manual entry.

Revise the earlier recommendation to stop adding functionality: there are worthwhile, focused changes. First improve the forecast's handling of when material becomes usable. Then expose the source-to-review-to-posting workflow in the replay, repair the confusing time context and readability issues, and lead the demonstration with that causal chain. A stability-report intake workflow is a good next extension after those foundations; broad QA or SOP management would require a separate scope.

Suggested story direction, for discussion: **Kevin reads the paperwork, spots material shortages, and handles purchasing within rules people set.** Keep the acquisition context in the next sentence and the original "Kevin's Survival Guide to the Agentic Economy" as the origin of the project. The working name Day One already fits the moment a plant starts this transition.

## What was checked

- Opened the local replay from a fresh browser visit, including Kevin's introduction, then used the staff desk rather than jumping immediately to the refusal.
- Walked upload, confirmation, discrepancy and forecast; inspected batch records, inventory, the morning brief, a recorded question to Kevin, the phishing explanation, spreadsheets, group purchasing, the ERP connection, and judge tour steps 1, 3 and 5.
- Visually inspected the desktop layout at a 1280 by 720 browser viewport. No fresh phone review in this pass.
- Read the relevant extraction, forecasting, purchasing, supplier, inbox, navigation and presentation code. Checked the brief, README and curated handoff. The handoff contains older counts; current replay output takes precedence.
- Ran the four focused test files for extraction, forecast, purchasing and supplier agents: **36 tests passed**. Command: `npm test -- agents/kevin/src/forecast.test.ts agents/kevin/src/purchasing.test.ts agents/kevin/src/extraction.test.ts agents/suppliers/src/agent.test.ts`.
- Ran `npm run demo` and `npm run demo:group`: both matched their committed transcripts, exit 0.
- Did not start the API, call a model, sign transactions, read credentials or runtime data, or recheck the recorded transactions against a live node. The API inbox review below is source-inspected, not exercised in the browser. Replay success establishes reproducibility of the supplied recordings, not production readiness or new chain verification.
- The working tree already contained the earlier authorized README/proof/video changes from this chat. This pass adds only this report and its index row.

## What already serves the mission well

| Original need | What exists and why it matters | Boundary |
|---|---|---|
| Stop retyping batch paperwork | Extraction validates units, material/lot identity, formula consumption and uncertainty. Confirmation posts consumption and creates the record fingerprint. The smudged-quantity test blocks posting until answered. See agents/kevin/src/extraction.ts:101, :219, :556 and extraction.test.ts. | Recorded vision on fictional documents; public replay does not offer a complete document review surface. |
| Notice what production will need | Forecast derives demand from scheduled batches and actual historical use, with formula fallback. The replay finds about 514 kg of ascorbic-acid shortfall and recommends 700 kg. New quotes are screened against the need date. See agents/kevin/src/forecast.ts and purchasing.ts:291. | The existing incoming-stock calculation lacks availability dates and treats QC-held stock as covering demand. Finding 1 below. |
| Reduce spreadsheet and acquisition friction | Spreadsheet intake surfaces duplicate lots, aliases, units, expired stock and conflicting sales totals. The UI shows the recorded workbook's 19 rows and 9 questions. The mock ERP flow connects confirmation, inventory adjustment, orders, receipt, bill and payment. | The ERP is a mock. A production adapter and migration process have not been established by this review. |
| Help staff who are not technology specialists | "Needs you", "Handled for you", "Why you", "What you decide" and "What happens next" explain responsibility well. Plant screens use familiar names, material quantities and dollars. | Many navigation entries, simulation controls and different time contexts compete with the next decision. |
| Resist ordinary operational fraud | The recorded new-bank-details email is held, with no payout change. The explanation connects the suspicious message to the funded PO's fixed supplier account. | One demonstrated scenario and a scoped attack suite; not general phishing protection. Staff and operator keys remain trusted. |
| Work across the acquired business | Kevin checks sister-plant stock before buying; discrepancies become reviewable drafts. The group run has two plants contribute under their own limits and approvals, while the third declines because it has no need. | Scripted fictional scenarios; the demo does not establish independent production deployments. |
| Enter agent commerce | Supplier agents quote, anchor the quote under their own account, check escrow, accept and ship. The contract records purchasing and settlement. | Suppliers are rule-based, run through an in-process bus, and use server-controlled accounts. There is no open agent market or autonomous negotiation. |
| Reduce QA analysis labor | Batch yields, waste, lots, QC status and traceability already provide useful foundations. | No stability-report extraction, annual QA reporting or controlled SOP revision workflow was found in the relevant modules. Those remain future scope. |

The strongest distinction is this connected sequence: a plant document changes the inventory picture; that changes a purchasing decision; that decision crosses company and role boundaries; the resulting receipt and payment reconcile back to records. The acquirer is a plausible buyer because the work spans several plants. The employee benefits because Kevin prepares work in familiar terms. NEAR supplies enforceable authority and settlement underneath those interactions.

## Finding 1 — Plan by material availability date

**Verified in code; highest product priority.** `agents/kevin/src/forecast.ts:178` sums open PO quantities, :191 sums transfers in transit, and :205 adds received/quarantined lots. At :208 the entire sum is available before the first scheduled batch is evaluated. No arrival date, expected QC release date or uncertainty is consulted. The test at forecast.test.ts:47 deliberately shows an undated funded PO removing the shortage and need date.

This does not mean Day One ignores lead times everywhere. `agents/kevin/src/purchasing.ts:301` computes the days to need, and :323 excludes a new quote that is too late. That test passed. The gap is maintaining a trustworthy availability forecast once material is on order, on the road or waiting on QC.

Why it matters: a plant can have enough total quantity purchased and still stop because the material is unavailable on the production date. This is directly aligned with the founding problem. The present demo's recorded order arrives before its planned use; this review did not find an actual missed batch in that recording.

Proposed scope: a dated material-availability calculation over the existing production horizon. Keep usable stock, scheduled incoming stock, and uncertain/QC-held stock distinct. Track expected arrival and earliest usable date with their source and assumptions. Missing dates should create a request to confirm timing, not a green "covered" verdict. Show the first threatened batch, shortage on that day, last safe order date, and available responses: expedite, qualified alternative, feasible sister-plant transfer, or schedule review. A warning about an existing order must not automatically produce a duplicate purchase.

The UI should explain the decision in one line and let the user expand the dated stock movements. Suggested form, not current fixture text: "This batch needs the material before the current order is expected to be usable. Confirm an earlier arrival or review the schedule."

Implementation surfaces: forecasting and its types, the ledger's incoming-date representation (`server/src/ledger/schema.ts:822` currently has a need date but no explicit availability-date field on the PO), material decisions, brief, schedule impact and their exported replay data. Existing quote lead-time checks should remain.

Acceptance cases: sufficient quantity arriving after consumption still warns; an earlier arrival clears the warning; quarantine does not silently guarantee coverage; unknown arrival timing stays uncertain; partial receipts do not double-count incoming stock; a transfer does not make the sending plant short. These are proposed cases, not tests run in this pass.

Rough effort: medium, likely the largest item in this pass. Budget approximately one to two focused builder days including tests and a fixture demonstration; this is an estimate, with date/schema handling the main uncertainty. Cut probabilistic forecasting, route optimization and automatic rescheduling. Keep the demonstrated case deterministic and auditable.

## Finding 2 — Make the document review the first visible proof

**Observed in the browser and checked in source.** The replay's "Upload the batch record" advances directly to "Confirm BR-B-1045". The decision card summarizes eight materials and yield but does not show the source and extracted values together. Clicking the batch record in the table filters that same table. `web/src/RecordNav.tsx:46` implements the generic page/filter fallback; `web/src/pages/Plant.tsx:101` routes the batch link to the batch page. The confirmation copy is at `web/src/desk.ts:629`.

The working API path is better than the public replay: `web/src/InboxPane.tsx:182` renders the source scan and :168 selects blocking questions for review. Therefore this is not a claim that the app has no scan viewer. That source-inspected review is still primarily a scan plus flagged questions; it does not display every extracted material line side by side with its source.

Why it matters: the product asks a person to confirm what Kevin read. The judge needs to see both the work Kevin removed and the basis for that confirmation. The current best evidence of paper-to-reviewed-data is behind the replay/API divide.

Proposed scope: one shared record-review drawer for the replay and working app. Show the scan, extracted material/lot/quantity/unit rows, formula checks, unresolved questions and the named confirmation. Mark corrections explicitly. Keep all rows available while prioritizing uncertain fields. After confirmation, show the resulting stock movement and the next material decision in the same place. Let batch-record links reopen that review history.

Use BR-B-1045 for continuity with the existing order. Use BR-B-1046 as the separate, already tested uncertainty example. Do not invent an OCR mistake in the main recording. Confidence values are the model's estimates, not a measured accuracy rate.

Acceptance: a first-time visitor can inspect the source before confirming, see a flagged field remain unresolved, and follow the confirmed value into inventory. Replay must clearly identify simulated interaction. A wrong/unknown value must not post merely because a screen advanced.

Rough effort: medium, approximately half to one builder day if existing extraction data can be exported cleanly. Main risk is maintaining one review model across replay and API. Cut source bounding-box overlays, arbitrary new uploads and a new OCR engine. Keep the source image and exact fields.

## Finding 3 — Give each screen a coherent time context

**Observed.** At the November 9 forecast step, Kevin's desk says ascorbic acid runs short by about 514 kg. Inventory displays the November 16 end snapshot, with 1,010 kg on hand and 43/43 materials covered. Batch records already list BR-B-1045 as confirmed before its replay confirmation. The morning brief is dated November 16 while the global replay clock says November 9. The recorded question page explains that its answers use the end snapshot.

This is partly disclosed: Inventory and Batch records carry a "Recorded snapshot" label with an explanatory tooltip. `web/src/reads.ts:234` loads the final pages snapshot; `web/src/App.tsx:582` renders the label. The findings are about the burden of reconciling those views, not hidden fabricated numbers.

Why it matters: after confirming a document, a user expects inventory to show the consequence. Time context is especially important when the core claim concerns shortages and lead times. Additional explanatory text alone will not make a contradictory-looking demo feel causal.

Preferred fix: show all pages in the main demonstration from the selected step's state. Smaller fallback: contain the before/after record, stock and forecast in a self-contained workflow view, and explicitly label final snapshots as a separate end-of-week view. Do not leave a global clock visually governing data from another date. Keep the API and replay distinctions plain.

Rough effort: medium if every page becomes step-aware; small to medium for the contained workflow plus clear snapshot treatment. Cut a general historical database reconstruction. Acceptance is that a judge can follow BR-B-1045 through confirmation and shortage without reconciling two dates mentally.

## Finding 4 — Correct the small presentation problems that undermine plant credibility

1. **Dark-mode morning-brief callout is difficult to read.** Browser screenshot and computed styles showed `rgb(237, 242, 245)` text on `rgb(255, 248, 232)` behind the waiting-on-QC item. `web/src/pages/brief.css:142` hardcodes the pale background. Use theme-aware text and background together. Small change; verify the actual waiting item in both themes, not only the empty brief.
2. **Yield comparisons mix process types.** Batch records averages the last twelve batches across forms but places that figure in the tablet 89–92% band (`web/src/pages/Plant.tsx:180`). Its own explanation says capsule and powder yields are nearer 97%. The mixed chart at :267 uses a 90% expected line; Overview does the same at `web/src/pages/Overview.tsx:819`. Individual table rows already have product-specific expected yield. Show separate process/product series or deviation from each product's own expected yield. Small to medium. This is a better immediate QA improvement than adding another mixed average.
3. **The staff's first screen has too many competing destinations.** The desk is strong, but Plant, Money, Across Acme, HQ and Proof are expanded together, and the page includes simulation controls, mail, twin, activity, statistics and history. Default to a role-focused desk with the work and its evidence first. Retain the rest under navigation groups and a clearly chosen judge view. Small presentation scope if implemented through existing groups; avoid a new navigation system.
4. **Some visible actions lead to an explanation or existing table rather than a decision.** The batch link is the clearest verified case. "See orders and quotes" is a useful destination but should not imply that a new order has been drafted. Use labels that match the resulting action and offer a return to the unresolved task. Audit the few links in the primary story rather than every page before submission.

## Agent-to-agent commerce: what can honestly be said today

Yes, there is already a bounded agent-to-agent purchasing demonstration.

- `agents/suppliers/src/bus.ts:13`: Kevin's request is delivered to supplier agents through an in-process bus.
- `agents/suppliers/src/agent.ts:55`: each supplier prepares its quote and anchors it with its own account as signer.
- `agents/suppliers/src/shipping.ts:33`: the supplier checks the escrow and supplier identity, accepts and ships through its own account.
- The main replay includes those supplier actions and the final supplier payout. The group replay includes separate purchasing-agent accounts opening and joining the pool and separate directors authorizing their plants' shares.

Both replays matched their transcripts in this pass. That is substantial evidence of the mechanics. Describe it as "purchasing agents and supplier agents coordinate and settle on NEAR testnet." Describe the suppliers as rule-based and the bus as local. Do not claim live independent businesses, decentralized discovery, autonomous negotiation or a generally deployed agent economy. An agent does not need an LLM to quote from a price list and follow an escrow policy.

A judge-facing view could show the existing messages as a compact sequence: Kevin requests, suppliers quote, Kevin compares qualification/arrival/cost, required people approve, supplier accepts, staff confirm receipt/QC, payment settles. Each commercial claim should open its existing record or transaction. This is primarily presentation work; an additional agent framework is unnecessary for that demonstration.

## The QA and SOP opportunities

The next meaningful extension is **reviewed stability-report intake**: a fictional scan becomes a structured result table with product, lot, test, time point, result, unit, method and source-page reference. QA resolves uncertain readings, then exports reviewed rows for analysis. Preserve corrected values and who confirmed them. Handle censored results, units, duplicates and missing time points explicitly rather than treating all entries as simple numbers.

A credible first increment can end at reviewed CSV export. Add trend charts only after tests establish correct grouping by product/method/unit/time point. Existing batch/yield charts are useful context but do not implement this workflow. Avoid making release, shelf-life, validation or compliance claims from it.

This directly serves the manual analysis work described in the brief, but adds a new document type, review model and acceptance cases. Treat it as the next product increment, or a tightly bounded optional pre-deadline slice only after the main workflow and final verification are secure. There is no need to imply it is already delivered.

SOP management deserves a later design: controlled versions, markups, approvals, effective dates, obsolete-copy handling and training acknowledgments. A generic document chat would leave those operational responsibilities unresolved. Similarly, production ERP connectors, staff-held login credentials, real messaging and independently deployed suppliers remain important post-hackathon work.

## How to show the build

Lead with the person and a consequence. Suggested picture: a scanned batch record on the left; Kevin's extracted rows and one review decision in the middle; the resulting inventory and threatened batch on the right. Put the real purchasing authority and transaction trail immediately underneath. Preserve the existing refusal/approval/payment strip as the proof of the money boundary.

Suggested short demonstration sequence, using current evidence unless marked as new:

1. Open the fictional batch record and Kevin's reading. Show what Ray checks rather than only announcing that extraction occurred.
2. Confirm it; show stock changing and the two scheduled batches creating the recorded shortfall. If the dated-availability enhancement ships, add its tested arrival/QC warning as a clearly identified new scenario.
3. Show qualified suppliers returning quotes. Explain the chosen quote using qualification, delivery and landed cost.
4. Show the existing over-limit refusal, the named approval, escrow and eventual receipt/QC/payment. Keep simulated messaging, testnet and server-held-key disclosures close to this sequence.
5. Show the linked stock adjustment and payment in the mock ERP, or a closing task list of what Kevin handled and what people decided.

The longer video already has paper-record and founder-story beats (`web/src/video.ts:58` and :84); the short order cut concentrates on authority. Reorder and tighten existing material before adding new animation. The plant twin works well as context and a progress map after the user understands the task. It is not evidence of physical equipment integration.

For a human judge, make the cause and effect visible and leave the technical detail expandable. For a code-reviewing judge, map the same claims to the focused tests, replay files and transactions. No special evaluator instructions are necessary. Keep the existing one-command evidence path and honest limitations.

Do not claim measured labor hours, avoided outages or production ROI from fictional fixtures. A defensible demo can count fields extracted, review questions, records posted and reconciled entries directly from its data. Describe a money comparison as a comparison within the fictional scenario. Any later time-saving estimate needs a stated method and a measured manual baseline.

## Suggested order for the remaining work

| Order | Work | Completion condition | Cut if time tight |
|---|---|---|---|
| First | Date-aware availability and its warning | Late/unknown/QC-held incoming material cannot silently produce a covered verdict; no duplicate purchasing | Probabilistic planning and automatic rescheduling |
| Alongside the forecast | Shared source/field review and visible stock consequence | A judge can inspect before confirming and follow the resulting shortage | New OCR provider, arbitrary new document types, scan overlays |
| Then | Consistent time context; brief contrast; product-specific yield comparison | The main story shows one coherent state and readable, meaningful numbers | Whole-app historical replay; broad redesign |
| Then | Staff-first opening and one complete paper-to-purchase demonstration | The first screen explains who benefits; every step opens its evidence | Additional tour branches and feature montages |
| Optional, after verification | Stability report to reviewed export | Source-linked fictional rows, uncertainty review, deterministic export | Annual analytics and SOP management |
| Before recording/submitting | Fresh-clone verification, changed claim checks, final video and README consistency | Evidence matches the shipped revision and the video | Further feature additions |

Estimated effort above describes individual scopes and is not an aggregate delivery promise. Date handling and shared review data determine how much fits. No contract redesign is needed to demonstrate the recommended workflow improvements. Preserve existing contract limitations, particularly trusted staff reports/keys and the documented signed-fingerprint boundary, rather than broadening the security claim.

Tony's useful next decision is whether to prioritize these first two workflow improvements before freezing the submission. No source changes were made in this pass.
