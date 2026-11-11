# Complexity and polish: make one order carry the story

Pass for Tony and Claude, November 4, 2026. Seats 1, 3 and 5, plus Tony's request to make the signed decision visible behind the curtain. Reviewed commit `b7a7824`; the checkout was clean before the pass and remained at that commit through the review. Proposals only; no application changes.

**Assessment: the product has a clear idea, but its presentation gives too many proofs equal billing.** The opening paragraph works. Linda's decision card works. The fourteen-row map between them makes the reader do the organizing. Judge mode then walks thirteen stops, including two different subjects on several stops, and ends by offering another tour. The strongest improvement is to follow one order from need to payment, and let everything else be reference.

**The best polish opportunity is already recorded:** Kevin's model signed `APPROVE` for PO-1042, and the contract still refused the order. The same signed decision accompanied the successful retry after Linda approved. Show that relationship. It makes the signature meaningful without implying that an authentic model answer grants purchasing authority.

Recommended scope: a shorter README entrance, six core judge stops, corrected claims, and a compact signed-decision display within the existing curtain. Keep the plant twin and lot trace in that short path: they show that this is a manufacturing assistant. No new purchasing behavior, contract work, model call, chain recording or second onboarding flow is needed.

## What I checked, and what I could not

- Read the brief's named files, the README in full, the proof runner and its command table, and the generated proof log's contents, relevant flows and limitations. Followed the signed-decision claim into `agents/kevin/src/decision.ts`, `contracts/spend-policy/src/lib.rs`, `attest.rs`, the curtain/export types and the recorded PO-1042 arguments. Those additional reads establish what can truthfully be displayed.
- `npm run prove -- --quick` printed **10 of 13 claims proved**. The three failures were `anchors`, `lots` and `sealed`, where read-only testnet RPC was unavailable in this sandbox. The local replay portions ran; this is not evidence that those on-chain claims are false. Full lint, TypeScript/Vitest and Rust tests were skipped, as the command reports. I did not repeat a full suite for a proposal-only pass.
- `npm run verify:lot -- ASC-261116-01 --offline` passed: **3 of 3 records lead to their day's root**. That does not independently verify the root on chain. `npm run proof -- --check` passed: **PROOF.md is current**.
- `npm run web:build` passed, with bundle-size and mixed static/dynamic import warnings. I make no loading-speed claim from a local build.
- Attempted the authorized screenshot command for judge steps 1 and 2, with `STEPS=0`. Edge exited during launch in the sandbox. No fresh captures were produced; I used the allowed fallback, current source and existing images, without requesting broader access. Steps 3, 7, 12 and the new intro capture were consequently not attempted with the same failed launcher.
- Inspected `docs/readme/first-shift-intro.png`, `linda-wide.png`, `linda-phone.png`, `paid-curtain-wide.png`; existing wide/phone judge images for 1, 2, 3, 7 and 12; and existing first-shift images. **The older `docs/astra/shots/judge-*` set shows eleven steps and fifteen attacks. Its step 12 image is actually the old final step. It is not visual evidence for today's new steps 7 and 12.** Layout concerns below distinguish that older visual evidence from current source inspection.
- The local `hackathon-intel/` contains only its README, not the tracker. I did not verify competitive uniqueness or browse external material. The pass rests on this product's evidence, not the assertion that no competitor has its features.

The timed reads below are editorial simulations using the actual text and scripted durations, not a timed user study or a completed browser walkthrough.

## A. Three timed reads

### 60 seconds: clear sentence, wrong next screen

**Verdict:** A reader can repeat the opening: Kevin handles purchasing and inventory for a newly acquired manufacturing plant, within limits enforced by a NEAR contract. They cannot absorb the map and the first judge screen in the same minute. The app's first judge stop reinforces spreadsheet cleanup more strongly than purchasing authority.

**First likely exit:** `README.md:13`, “What is in it, layer by layer.” It is fourteen rows and approximately 860 whitespace-delimited source words, before Ray's Monday. The first judge stop (`web/src/judge.ts:227`) adds 19 rows and nine questions before showing an order. In the older phone capture, the filename and a long inventory diagnostic consume most of the visible subject above the guide.

The map is useful reference; its position asks a reader to learn the architecture before seeing the useful act. Move it. Begin the app on Kevin's desk, with the acquired-plant premise in the caption.

### 5 minutes: the central story lands only if the reader skips

**Verdict:** Direct judge mode reaches the approval and payout, but a README reader who also explores the map cannot finish it in five minutes. A bare-site visitor taking the first shift first spends roughly two more minutes before entering a second explanation. The late lot proof and model provenance are likely to be missed.

Current judge durations total **375 seconds, or 6:15**, before any explorer inspection (`web/src/judge.ts:225`). The first shift totals **123 seconds**, plus its introduction (`shiftScript.ts:107`). These are alternate routes: `?judge=1` bypasses the intro, and any query/hash does so (`shiftScript.ts:32`). They are not automatically stacked. But “Review the evidence” after the first shift invites a visitor to stack them.

At the script's pace, the first five minutes reach the general attestation step; the lot passport is later. Step 7 combines a funding-time model signature with a settlement-time quantity formula, then quotes a different PO's short delivery. Step 10 places a USDC overlay over reconciliation. The reader must keep changing subjects while the interface appears to promise a single step.

**First likely doubt:** Step 2's unsigned $3,000 limit change (`judge.ts:238`, `JudgeMode.tsx:109`) precedes a refusal against $2,500. The text says it is only a draft, but the viewer now has two limits to remember. Remove the example change from the core path. The other trust gap is step 7: it says a decision was signed but shows a paid desk and an explorer link, not the decision.

What they still take on trust: the decision-to-PO connection, the difference between a replayed assertion and a fresh chain check, and caveats omitted from the route they happened to choose. A signature badge alone does not resolve those.

### 15 minutes: substantial evidence, expensive navigation

**Verdict:** The depth is real and the reference material is unusually inspectable. `PROOF.md` is the strongest reference: a contents list, flows, commands, transactions and “Does not prove” notes. The README map and claims table help when deliberately looked up; as consecutive explanations they add reading without adding much confidence.

**First likely doubt:** the scorecard says “Three plants pool one purchase” and “nobody can read” sealed quotes, while the more careful README says two plants purchased and discloses the limits of commit-and-reveal. These are factual scope problems, not just wordiness. A PASS beside an overbroad sentence makes the careful caveats elsewhere less persuasive.

In this sandbox the runner exposed another review cost: three RPC-dependent rows fail, with stack traces before the final scorecard. An agent must inspect output and code to discover that the local replays passed. I could verify replay consistency, the local lot paths, the generated proof log and the recorded decision linkage; I could not freshly verify chain state, the 93 transactions against archival RPC, production custody, real customer outcomes or competitor uniqueness.

## B. The AI agent judge

The reviewer notes at the top of `AGENTS.md` and `CLAUDE.md` work: they prevent a reviewing agent from following the builders' session plan. Keep them short. Do not turn the builder instructions into another product description.

From a clean clone, the first action is `npm ci`; the first assessment command is `npm run prove -- --quick` when minutes matter. This checkout already had dependencies, so I ran the latter, not a reinstall. Use the full `npm run prove` when the test budget allows. The runner does not install dependencies itself.

### What the actual output gives the reviewer

`scripts/prove.ts:24` prints compact completion lines to stderr. The first was `PASS loop (4 s)`. The final Markdown starts with a commit heading, then a four-column table containing full claim prose, full evidence prose and commands. **The overall result is last, not first** (`scripts/lib/prove.ts:182`). The progress lines are skimmable; the table is difficult in a terminal and costly in an agent's context. My final result was:

```text
10 of 13 claims proved.
Skipped: lint, typecheck and tests (--quick); `npm run check` runs them.
Skipped: the contract's Rust tests; `npm run prove -- --contract` or CI runs them.
```

The default has fourteen claims; quick mode removes `code` and has thirteen. Adding the Rust claim changes the count again. Do not label a quick run “fourteen checks.” The three failed rows were `anchors`, `lots`, `sealed`; their errors specifically concerned unreachable testnet RPC.

I read JSON construction at `scripts/prove.ts:93`, rather than repeating the same run. Its shape is suitable for an agent:

```text
{
  commit, node, platform,
  claims: [{ id, claim, evidence, ok, seconds, commands, reason? }],
  proved, failed, skipped
}
```

Two qualifications: the `reason` is generally a generic exit-code failure, while the useful RPC error is suppressed in JSON mode along with progress; and ordinary `npm run` adds its own header before the script's JSON line. Document the existing silent npm invocation for a parser, `npm run --silent prove -- --quick --json`, or explicitly say to parse the final line. Do not claim the entire ordinary npm output is a JSON document.

### Small changes to this existing runner

1. Before execution, print: **“Checking 13 claims from the recordings and read-only testnet queries. No keys required. Quick mode skips lint, typecheck and tests.”** Derive the count and mode, not a new literal. A final verdict cannot truthfully appear before execution.
2. At completion, put the existing `N of M claims proved` line first, followed immediately by failures and skips. Keep the long table below it; shorten each display label to the claim ID plus a short subject. The JSON can retain the full sentences.
3. Include a concise cause in a failed JSON row, e.g. **“Testnet RPC unavailable; on-chain comparison not completed.”** Keep the row failed and the command nonzero. Do not silently convert unavailable evidence into a PASS.
4. Fix claim wording before polishing the table. Exact replacements are below.

This is output cleanup, not a request to build a new offline verification mode. `--quick` is not offline. The runner calls `verify`, `verify:lot` and `verify:round`, all of which can read testnet. `llms.txt:9` should state that dependency. The old proposal in `docs/REFERENCE_IDEAS_PLAN.md:31` described a network-free command that writes nothing; that proposal is not the implementation. The implemented inventory check also invokes `inbox`, which writes ignored demo scans. “No tracked files changed” is the appropriate scope.

Also correct `README.md:15` and `:105`: `prove` does not run every listed command. For example, `escrow`, `policy`, `brief` and `books` are not in its claims; attestation is checked offline. Replace the command-table summary with **“Additional keyless commands; some read testnet.”** Replace “runs the whole column” with **“runs the checks in its claim scorecard.”**

## C. Where the depth repeats

The problem is not that multiple audiences hear the same idea. The problem is repeating full explanations and evidence lists instead of giving each surface a distinct job.

| Fact | Repetition now | Canonical evidence and the shorter copies |
|---|---|---|
| Limits, refusal, Linda, escrow | README opening, depth map, Ray's Monday, demo steps, Why NEAR, claims; judge mode; first shift; tour; llms; proof runner/log | Claims table owns the precise guarantee and tests; `PROOF.md` owns transactions. README and core judge route tell the one-order story once. First shift tells Ray when he is needed. |
| Attack suite total | Five README locations name the total: lines 31, 62, 109, 170 and the image description at 172; also llms, judge, first shift, tour and runner | Recorded arena data owns the count; claims table owns what each class establishes. Keep one total in the proof entrance and one in the arena. Do not strip useful accessible image descriptions merely to win a word count. |
| 93 transactions | README map introduction and claims row (the latter says “93 of 93”); llms opening; PROOF opening | Generated proof log owns the inventory. Use “Full transaction log” elsewhere. Transaction count measures evidence volume, not product value. |
| Enclave/model signature | README map has separate decision and answer rows; Why NEAR; claims; limitations; judge steps 7 and 11; curtain chips | The answer fixtures and verifier own authenticity, the contract/claim row owns the gate. Show the PO-specific decision at funding; fold the general attestation report underneath it. Keep its limits adjacent. |
| Settlement formula | Opening, map, Ray's Monday, demo, Why NEAR, claim, limitation, judge step 7 | Contract claim/test owns `min(escrow, pro-rata escrow, invoice)`. Staff route says what was received and paid. An optional short-delivery example demonstrates the formula. |
| Lot book quantities | Map, claims, llms, judge step 12, proof log | Lot book/proof log owns 1,955 records, 416 roots, nine transactions. Core story follows one lot, three records. Batch-anchoring caveat travels with either version. |
| ERP / USDC | Opening, map, command table, pages, Why NEAR, claims, judge step 10 | ERP gets a reconciliation pointer beside the paid order. USDC gets its own optional proof with its first-version caveat; it should not cover the ERP screen. |

The current raw README has roughly 8,160 whitespace-delimited words, including tables, code and image descriptions. Before “Try it” there are roughly 1,620 even with the HTML image tags removed. These are source counts, not a reading-speed measurement. The map alone consumes more reading than the one-minute entrance can afford.

Do not centralize necessary caveats so aggressively that the local claim becomes misleading. The full limitations can have one home; SMS/key custody, token/version and provenance caveats still need a short local sentence wherever the corresponding claim is demonstrated.

## D. Ranked cut and correction list

Ranked by confusion removed for the amount of change. Front door means what everyone sees; reference means what a reader opens deliberately.

| Rank | File and location | Change, including exact replacement where useful | Cost / size |
|---|---|---|---|
| 1 | `README.md:13`, depth map — front door | Move all fourteen rows below the quick path into reference, with `<summary>Explore the product layers and their evidence</summary>`. Above it use **“Follow one order below; use the layer index to inspect the rest.”** Keep every link. | The opening no longer displays the full breadth. That is the intended trade. Small. |
| 2 | `judge.ts:238`, `JudgeMode.tsx:109` — front door | Remove the $3,000 draft and CLI example from the core limits stop. Show the recorded $2,500/order and $60,000/month only. Exact body in E. Keep the policy demonstration on Spending limits. | A useful customization example becomes optional. Small. |
| 3 | `judge.ts:296` — front door | Dissolve the combined “Paid for what reached stock, on a signed decision” stop. Put the signed decision beside approval/funding; put the counted quantity and invoice beside QC/payment. Short delivery becomes an optional link. | No claim disappears; viewers stop doing time travel. Medium, with G. |
| 4 | `judge.ts:329`, `:350`, `:361`, `:386`; `JudgeMode.tsx:172` — front door | Move group buy, separate USDC, the general attestation stop and the invitation to another tour into the existing summary. Rename its entry **“See every proof”**. Replace the summary's savings paragraph with **“Choose a claim to inspect its recording, checks and limitations.”** Keep the tour as a small alternative, not the next primary action. | Less mandatory breadth and no modeled ROI in the conclusion. Medium. |
| 5 | `scripts/lib/prove.ts:96`, `:102`, `:108` — both | Replace group claim with **“Two plants pool PO-G-2001; each director approves that plant's share. Lakeview declines.”** Sealed claim: **“The contract accepts only reveals matching the earlier commitment, after the deadline; the recorded early award, changed reveal and late commitment are refused.”** USDC claim: **“A separate deployment of the first contract version settles PO-1047 in Circle testnet USDC.”** | Removes overclaiming, not evidence. Small. |
| 6 | `README.md:36`, `:128`, `:182` — front door/reference | Let Ray's Monday own the narrative; retain the eleven demo steps folded. Replace the expanded Why NEAR list above reference with **“NEAR enforces purchasing authority and holds the PO's money. Kevin cannot approve his own over-limit order; the supplier is paid after receipt and QC. Staff use the plant workflow while Day One relays their actions.”** Immediately retain the simulated reply/server-held-key note and link the claims table. | Account tree and cryptographic mechanics remain in reference. Small. |
| 7 | `README.md:56`, fraud — front door | Move the statistics and attack catalog into reference. In the story retain **“A payment-redirect message cannot change the supplier fixed on a funded PO. This does not protect stolen HQ or supplier keys, or payments outside Day One.”** | Gives up a second problem statement and headline loss figure in the first minute. Small. |
| 8 | `README.md:86`, browser instructions — front door | Give one primary route: **“In the browser, follow PO-1042 in judge mode (`/?judge=1`). The first shift introduces Ray's work; the captioned tour is an alternative viewing format. All three replay recordings.”** Describe the shorter duration only after Claude measures the revised path. Put query variations in `docs/JUDGE_MODE.md`. | Fewer routes compete for the same five minutes. Small. |
| 9 | `README.md:193`, claims and depth map — reference | Keep a visible **“Claims and evidence”** heading and direct anchor; put its full table inside `<details><summary>Code, tests and transactions for each claim</summary>`. Place the folded layer index immediately before it. Keep full Limitations outside the fold. | A human needs one click for the exhaustive table; raw Markdown remains available to agents. Small. |
| 10 | `llms.txt:3`, `:14` — agent front door | Replace the long opening with **“Day One is Kevin, a purchasing and inventory assistant for a newly acquired manufacturing plant. A NEAR testnet contract enforces his purchasing authority and settles funded POs. This repository contains fictional plant data, recorded testnet calls and keyless checks.”** Keep command, output scope, evidence links, limitations and a short code map; remove repeated catalogs of every contract method and plant attack. | Fewer search terms up front; source paths remain. Small. |

Keep the README's five installation/proof steps and their verbatim outputs. They are already a working contract with the clean-clone checks. Preserve the headings that `scripts/lib/clean-clone.test.ts:19` uses to identify that section, or change that parser deliberately; don't accidentally remove commands from its coverage by moving the table outside the slice it reads.

### Corrections that must travel with the cuts

These are small, but they matter more to credibility than a new animation.

- **First shift, keys and ERP:** `shiftScript.ts:173` says “I pay only a bill the ERP has matched,” stronger than the actual payment gate. Replace the staff-facing line with **“Day One keeps your batch records and lots. Acme's books show the order, receipt, bill and payment. Payment waits for delivery and QC and is based on the recorded quantity and invoice.”** Keep an adjacent **“Demo ERP · not a live integration”** disclosure; explain that the ERP match is not an on-chain condition in the trust/reference material, not Ray's staff narration. At `:197`, in the existing behind-the-curtain portion, replace the approval line with **“In this replay, Linda's text reply is simulated and signed with the director key held by the server. Day One pays the network fee. Escrow pays Northgate after Tommy confirms delivery and Priya releases the lot.”** At `:213`, say **“Kevin, the mock ERP or the contract stopped each recorded case.”** The current first shift omits the ERP from that attribution.
- **USDC version:** The caveat is good at `README.md:246` but missing beside “same contract” at `judge.ts:352`, `video.ts:253` and `PROOF.md:173`. Use **“PO-1047 paid $19.00 in Circle testnet USDC on a separate deployment of the first contract version. It does not demonstrate v2 receipt settlement or signed decisions.”** Change the generator `scripts/lib/proofLog.ts:237`, then regenerate, rather than hand-editing `PROOF.md`.
- **Sealed quotes:** `PROOF.md:155` also needs the stronger limitation already present in `README.md:250`. Replacement for the generator's `notProved`: **“This is commit-and-reveal, not encryption. A supplier can disclose its quote; transaction arguments remain public even when a reveal is refused.”**
- **Tour approval and closing claim:** `video.ts:135` does not say the text reply is simulated/server-signed; add that in the approval caption. Replace the close at `:208`, “one rule none of them can quietly change,” with **“Kevin does the purchasing work. The contract enforces the limits HQ sets, and every recorded payment can be traced to its order.”** HQ can change policy and the operator retains deployment keys; the current absolute closing line outruns the README's trust assumptions.
- **Lot provenance:** Add to the core passport copy: **“The history is seeded; its roots were anchored together on Nov 3, 2026. The check proves the records have not changed since anchoring.”** Current `judge.ts:374` omits this. Do not describe the old historical dates as nightly on-chain execution.
- **Current vs historical counts:** Three attested answers in the main run and 31 across all recordings are consistent (`scripts/web-data.ts:130`, `README.md:216`), not a defect. Label them with those scopes. Likewise 21 attack cases and 23 refused transactions are different units. `docs/HANDOFF_ASTRA.md` and `REFERENCE_IDEAS_PLAN.md` are dated historical documents, not sources for today's counters.

## E. The shape we want

**One sentence → one order → optional proof.** A reader should be able to stop after any layer and still describe the same product.

| Budget | Recommended path | What they leave knowing |
|---|---|---|
| One sentence | Opening below | Who Kevin helps and who controls his spending. |
| 60 seconds | Opening, Linda screenshot, a short PO-1042 paragraph | Kevin handled the work; Linda has one decision; approval is not payment. |
| 5 minutes | That minute plus six judge stops, targeted at about 3:25 | Need → limit → refusal → approval and signed decision → receipt/QC/payment → the lot's records. |
| 15 minutes | Run prove, select a claim, inspect its proof-log flow | What is checked locally, what reads testnet, what is simulated and what the evidence does not establish. |

The layer map belongs at the start of **reference**, after the short story and try-it path. It is not the second thing a reader should meet. Thirteen mandatory steps are too many for the stated review budget, even if each is individually useful.

### Exact README first-screen replacement

Replace the current opening and front-door map with the following; move the current map and verification-date note into reference. Preserve track/date metadata in Built with. Put the existing Linda image immediately after this text, with its accessible description retained.

```markdown
# Day One

The ops lead sets Kevin's purchasing limits once. Kevin handles the paperwork and buys within them; larger orders wait for the plant director. Day One is Kevin, a purchasing and inventory assistant for a small manufacturing plant its new owner has just acquired.

Kevin reads batch records, checks stock and compares quotes. A NEAR testnet contract enforces his limits and holds each funded PO's money until receipt and QC release. Staff see dollars, POs and decisions.

Follow PO-1042: Kevin prepared a $5,150 order, the contract refused it against his $2,500 limit, and Linda approved. Northgate was paid after the plant received and released the lot. The recorded calls show each step.

This is a prototype with fictional plant data. The text reply is simulated, staff keys are held by the server, and the ERP is a mock. This order uses DTUSD, a labeled test token. The separate $19 Circle testnet USDC order runs the first contract version.

[Try the recorded run](#try-it-no-keys-needed) · [Claims and evidence](#claims-and-evidence) · [Limitations](#limitations)
```

Retain the full on-chain/off-chain table, limitations, sustainability and disclosure sections required by the README rules. Near the claims entrance retain: **“Kevin is the purchasing agent; spending limits are one enforced layer. The escrow covers purchase orders and is not a general multisig.”** No caveat is removed by shortening the opening.

### Six judge stops, with the first three rewritten exactly

| New stop | Current material | Treatment and target budget |
|---|---|---|
| 1. Kevin takes on the purchasing work | Current 1 + 3 | Overview at Small PO, desk/handled work spotlit, curtain off; acquired-plant premise in the caption. Workbook stays in reference. 25 s. |
| 2. HQ sets what Kevin may spend | Current 2 | Recorded limits only; no proposed $3,000 change, owner-key prose or command. 20 s. |
| 3. The contract sends this order to Linda | Current 4 | Refused PO-1042, limit bar and exact refusal; curtain on. 30 s. |
| 4. Linda approves; Kevin's signed decision stays the same | Current 5 + signature part of 7 + relevant part of 11 | Director approval and unchanged retry; PO-specific evidence within the curtain, including local custody caveat. 50 s. |
| 5. Received, released, paid | Current 6 + settlement part of 7 | Keep the twin as the physical context for receipt/QC. Show 700 kg counted, $5,150 invoice, $5,150 paid. Short-delivery proof is optional. 40 s. |
| 6. The lot keeps the record | Current 12 + one pointer to books | Trace ASC-261116-01's receipt, QC and payment. Local provenance caveat; optional browser check and tamper action. A short link to the seven recorded mock-ERP reconciliation checks, no USDC overlay. 40 s. |

Then the existing summary becomes “See every proof,” grouped by claims, with the current optional stops/pages available by descriptive links. Current 8 attacks, 9 group purchase, the USDC portion of 10, generic 11 attestation and 13 tour do not need numbered core stops. Keep their transaction links in the summary even when they leave `JUDGE_STEPS`; `proofLinks()` currently derives its set from those steps. Update that dependency so a presentation cut cannot silently cut evidence.

**Stop 1 title:** “Kevin takes on the purchasing work”

**Body:** “Acme has just bought Hollow Pine, where stock lives in paper records and a spreadsheet. Ray confirms the batch record Kevin read; Kevin checks the plan, compares quotes and places a $612 order within his limits. Ray reviews what needs him.”

**Stop 2 title:** “HQ sets what Kevin may spend”

**Body:** “HQ set Kevin's limits at $2,500 per order and $60,000 a month. The contract enforces them. An order over those limits needs Linda's approval; Kevin cannot change the rules or approve his own order.”

**Stop 3 title:** “The contract sends this order to Linda”

**Body:** “Kevin prepared PO-1042: 700 kg of ascorbic acid from Northgate, $5,150 including freight. The contract refused it against his $2,500 limit. Linda decides whether to approve; approval sets the money aside, and payment waits for receipt and QC.”

Retain the exact recorded refusal below stop 3, with its transaction link. Do not repeat its entire sentence again in a second card.

The first shift should remain Ray's introduction, not become a competing audit. Keep its existing six staff stops and the calm introduction. After those, make the existing three trust stops optional using the existing end choices; “Review the evidence” should reach the shortened judge path. If that flow change proves fiddly, keep all nine stops for this release and simply make judge mode the README's primary route. Correct its misleading captions either way. Do not spend time creating a third tour.

## F. The ten changes I would make first

Small means copy, ordering or a contained display change; medium means a UI/data relationship that needs validation. These are implementation estimates, not promised hours.

| Order | Change | Size | Files Claude would touch / acceptance |
|---|---|---|---|
| 1 | Fix group, sealed, USDC and authority/custody wording | Small | `scripts/lib/prove.ts`, `scripts/lib/proofLog.ts`, `web/src/shiftScript.ts`, `web/src/video.ts`, `README.md`; regenerate `PROOF.md`. No route makes a stronger claim than its caveat. |
| 2 | Put one order and Linda's screen before the depth map | Small | `README.md`; bring `docs/README_TEMPLATE.md` into alignment with the current wording and layout. Keep the five-step command contract. |
| 3 | Cut judge mode to six core stops | Medium | `web/src/judge.ts`, `JudgeMode.tsx`, `docs/JUDGE_MODE.md`; preserve optional proof links independently of core steps. |
| 4 | Show PO-1042's signed decision and the two contract outcomes | Medium | `scripts/web-data.ts`, `web/src/run.ts`, `Curtain.tsx`, relevant curtain styles and exported `demo-run.json`; specification in G. No new signing or verification service. |
| 5 | Remove the unsigned limit-change example from the core stop | Small | `JudgeMode.tsx`, `judge.ts`; one recorded limit in view, no draft policy command on the staff-facing stop. |
| 6 | Make the judge guide fit beside its subject | Medium | `web/src/judge.css`, `Spotlight.tsx`, `JudgeMode.tsx`; keep Next visible on a 390 px phone, avoid overlaying the proof/Fire attack action, use actual guide height when positioning the subject. Fresh visual check required. |
| 7 | Lead the proof output with result, failures and scope | Small | `scripts/prove.ts`, `scripts/lib/prove.ts`, `llms.txt`; existing JSON structure preserved; failures expose the useful cause. |
| 8 | Give first shift and judge mode distinct jobs | Small | `shiftScript.ts`, `FirstShift.tsx`, `docs/JUDGE_MODE.md`; keep the staff introduction, make proof continuation deliberate, or retain nine stops and rely on the primary README route if time is tight. |
| 9 | Put lot provenance and evidence limits beside the demonstration | Small | `judge.ts`, lot-proof copy as needed, `JudgeMode.tsx`; seeded history/Nov 3 anchoring stated, 3 vs 31 answers labeled, USDC version visible at its optional proof. |
| 10 | Align existing tour captions and refresh the review captures | Small | `video.ts`, `docs/readme/`, `docs/JUDGE_MODE.md`; capture new core path wide/390 px, with `STEPS=0`, check the exact visible record and the Next button. Run existing relevant tests and the web export check. |

Scope cut order: do not create a new animation, new evidence dashboard, new menu system or new cryptographic verifier. If time bites, leave the first shift's stop count alone, leave generic attestation chips folded, and keep current tour timings while correcting its words. Protect changes 1–5 and the mobile check. Do not redeploy or re-record for this pass.

## G. Signed decision polish: show the evidence beside the order

### The observation

`docs/JUDGE_MODE.md` explicitly lists the absent decision display under “Not built.” `web/src/run.ts:21` exposes transaction metadata, not PO arguments; `Curtain.tsx:104` draws method, transaction signer, events and explorer link. `Curtain.tsx:59` has general attestation chips, but a viewer cannot connect the reasoning answer's chat ID to PO-1042 from that presentation.

The needed evidence exists. In `data/replay/demo-chain.json:248` and `:358`, the refused and funded submissions carry the same decision. Its response identifies chat `7190a65d67044a27ad7f0255403987e8`; its final verdict is:

```text
APPROVE 74e7707deb33681866d9f1ad99b8c9566e978912cd1f46601e8bb3be39069187
```

I parsed both recordings locally: that hash matches each submission's `po_hash`; the SHA-256 of the stored response matches the response digest in the signed text; the exported attestation entry matches that digest and chat ID and reports the signer and signed-text checks verified. Signer: `0x3b753b4406613c5e70ae640508632b600424fa0c`. The quick run also passed the offline attestation claim. I did not freshly fetch the enclave report or transaction from the network.

The contract checks the signed decision before the per-order-limit branch (`lib.rs:574`, `:622`). Thus the recorded refusal with that valid decision is especially useful: **the signature authenticates the model's answer, and the spending rule still blocks the order.** After Linda's approval, the unchanged retry succeeds. These are separately meaningful facts, currently separated across pages and terms.

### Display inside the existing curtain

Put one compact block with the PO-1042 submission, before the account tree/general attestation list in the focused judge view. Use the same component wherever that transaction is inspected; do not add another permanent panel or a seventh judge stop. Keep it entirely behind the curtain.

The top should read:

```text
PO-1042 · Model decision
700 kg ascorbic acid · Northgate · $5,150.00

APPROVE — response names this PO's fingerprint
Recorded signature check: verified
Model: z-ai/glm-5.3-flash · NEAR AI Cloud

Contract result: refused — Linda's approval required
```

At the successful retry, change only the final outcome line to:

```text
Contract result: funded after Linda approved
Same PO fingerprint and signed response as the refused attempt
```

“APPROVE — response names this PO's fingerprint” is explanatory display copy, **not a fabricated quotation of the model**. Label the expandable verbatim line “Signed response excerpt,” containing the full `APPROVE <hash>` above. Do not put a newly authored purchasing rationale in quotation marks or label it signed. If plan and quote facts are shown, label them “Inputs supplied to the model”; the raw signed answer is not a nicely written business memo.

Under **“Signature and recording”**, disclose the full PO hash, model signer, chat ID, request/response digests, existing verifier command and the relevant submission link. Link the two recorded attempts by outcome, not just raw hashes. Keep the signature/response bytes in the evidence/export as needed, but do not make a reader open a huge serialized answer to understand the result.

Use exact nearby caveat:

> “This recorded signature ties the answer to an attested model key and this PO's fingerprint. It does not prove the supplied facts are true or the purchase is correct. HQ registers the signer after checking attestation; the contract checks the signature. Instances of the model share a signing key.”

Keep Linda's separate role visible: **“Director approval: signed with the director account's key, held by the server in this demo.”** Do not confuse that account signature with the model's signing address. Do not label the card “Verified on chain now”: the static display is a recording. Generic attestation still belongs underneath for an interested reader.

### Data contract and failure states

Claude should join the exact submission arguments to the matching exported attestation answer by the raw response's chat ID and response digest. Preserve the distinction between the refused attempt and the funded retry, and gate the display by the current replay step. Avoid taking the first “reasoning” answer: the main run has two, and only one is the PO decision. `scripts/web-data.ts:120` already has a transaction-hash map of recorded calls; extend that export rather than maintaining a second handwritten evidence file.

No fresh verification in the browser is required for this presentation. Reuse recorded verifier results and the existing offline export verification. If the answer, digest or attestation association is missing or unverified, show **“Signed decision unavailable in this recording”** or the specific failed check; never infer a green badge from `submit_po` success. A PO below the threshold should say **“No signed decision required by this recorded policy”** only if the relevant policy was exported; otherwise show no claim. The rule currently applies to Plant B above $2,500, not every agent and not the old USDC deployment.

The full-PO relationship is anchored in a matching fingerprint. Do not say the contract reconstructed the stock forecast, checked the truth of the model's inputs or independently evaluated manufacturing need. That is not what `check_decision` does (`lib.rs:1504`).

### Visual hierarchy and acceptance

The checked-in Linda screenshots already have strong hierarchy: a named human, an order, a limit bar and “Why you / What you decide / What happens next.” Keep that visual language. The paid curtain screenshot instead has seven similar transaction cards and no obvious answer to “what did the model decide?” Lead the focused curtain with the decision and contract outcome, and fold the raw mechanics below it. Use an amber refused/pending outcome and a funded outcome with text; a green signature check must not look like permission to spend.

For 390 px, use a single column. Wrap full hashes only within the expanded evidence. The older judge screenshots show a dense bottom sheet and Next wrapping beneath secondary buttons; `judge.css` still permits a 55vh sheet, while `Spotlight.tsx:32` centers targets without accounting for its actual height. This is a current source-backed risk, not a verified fresh overlap. Keep Back and Next in a visible control row, fold long proof-link lists, and place the subject in the remaining visible region. One meaningful subject and one narration block should be visible together.

Meaningful validation for Claude's implementation:

- The displayed verdict, PO hash, response digest, signer and transaction must come from the matching fixture entries. A deliberately mismatched response/attestation association must not show “verified.”
- The same recorded decision appears with the refusal and funded retry, with the correct different outcome. A valid signature alone never changes a refused submission to an approved/funded display.
- The card does not appear before the decision-bearing submission or on a staff-only screen. Missing evidence and the older USDC recording get no invented signature claim.
- Existing judge link tests retain all optional evidence after the step cut. Existing web-data freshness, clean-clone README coverage and proof-log checks still pass; no new purchasing or contract tests are needed for display-only changes.
- Fresh screenshots at 1280 px and 390 px show the subject, claim and Next control together. The screenshot driver defaults to advancing eight demo steps even when a judge query is supplied (`tools/render/src/shot.ts:20`, `:112`), so explicitly use `STEPS=0`. The old step-3 image showing an already-paid PO is not reliable evidence of a current routing bug.

## Decision for Tony

I recommend approving the ten changes as an editorial/presentation pass, with the signed-decision display as its one contained data/UI addition. The product should feel finished because its existing facts are easy to follow. The evidence can stay deep; it no longer needs to introduce itself all at once.

There is no missing product decision blocking Claude's preparation. The deliberate tradeoff for Tony is whether group buying and USDC must remain mandatory demo stops. My recommendation is to make them optional proofs and keep the manufacturing need, human decision, physical receipt/QC and lot record in the core. If that recommendation is taken up, Claude should implement, verify and commit the pass and accepted changes by path under the existing Astra workflow.
