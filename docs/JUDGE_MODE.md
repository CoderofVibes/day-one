# Judge mode, Linda's phone and the Plant twin page

Built Oct 31 on `upgrade/judge` (brief §5.12, §5.9 item 1, §5.6 "Plant map → Plant twin"). The tour itself is in docs/RECORDING.md §7.

## Addresses

| Address | What opens |
|---|---|
| `?judge=1` | Judge mode at step 1: the recorded replay, dark, the curtain off for the two premise steps and on for the proof, the stepper docked at the bottom (a bottom sheet on a phone). Always the replay, even when the API runs |
| `?judge=<n>`, `?judge=summary` | Step n, or the summary card with the walkthrough's selected transaction links |
| `?page=approve&po=1042` | Linda's phone alone, 390×844 (the whole screen on a phone); `&curtain=1` shows "Approved on testnet ✓", `&replied=1` opens on her recorded YES |
| `?page=map` | The Plant twin page |
| `?video=1&tour=1` | The tour (docs/RECORDING.md §7) |

The header's pine-green **Judge mode** button opens it from 1440 px; under that it is in the header's menu. On the live UI it reloads into `?judge=1`.

## The first shift (Nov 1)

The front door (OPEN_QUESTIONS #45 and #46; Astra's design, `docs/astra/2026-11-01_FirstShift.md`). On a bare first visit to the replay, Kevin introduces himself on a quiet screen: a green line that moves as each of three captions lands, Ray's desk fading in behind (`web/src/FirstShift.tsx`, `KevinPresence.tsx`). "Show me around" starts the walkthrough, "Open my desk", Skip or Escape go straight to the Overview at 5:00 AM; "Read introduction" shows all three captions at once. Any query or hash (a page, a plant, `?inspect=`, `?judge=1`, `?video=1`, `?page=approve`) skips it, and so does a returning visitor (`day-one:first-shift:v1`, the old guide's closed flag, or a saved clock); blocked storage counts as a first visit. "Meet Kevin · first shift" in the header menu replays it.

The walkthrough uses judge mode's spotlight (`web/src/Spotlight.tsx`) and the same page-and-step routing, with its own script (`web/src/shiftScript.ts`): six stops of Ray's morning with the curtain off (the mail Kevin reviewed, the batch record that needs him, its place on the plant, the three drafts, his spending limits, Acme's books), then three behind the curtain with their testnet links (the refused PO-1042, Linda's own-key approval and the escrow paying on QC release, 15 of 15 attacks refused). About two minutes with the intro. It ends on "Start your shift" (the desk at 5:00 AM) or "Review the evidence" (judge mode below). It only opens pages: nothing is signed, confirmed or stepped. `web/src/shiftScript.test.ts` holds the first-open rule and keeps the chain out of Ray's stops.

## The steps

`web/src/judge.ts` holds them as data; `web/src/JudgeMode.tsx` draws them.

| # | Step | Page, recorded step | Proof links |
|---|---|---|---|
| 1 | Day One at the plant Acme just bought | Spreadsheets, the inventory workbook spotlit, curtain off: `INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx`, 19 rows read, 9 asked about before posting | none |
| 2 | Acme HQ sets Kevin's limits once | Spending limits, curtain off; a card with the limits as the recorded run read them from the contract, HQ's request "raise Kevin's per-PO limit to $3,000" and Kevin's draft of the owner call (`draftPolicyChange`, the grammar `npm run policy` uses, no model) | none: a draft is not signed |
| 3 | Kevin handled the paperwork | Overview at "Small PO", Kevin's desk spotlit; the curtain flips on after 1.5 s | PO-1041's `submit_po` |
| 4 | One decision needs Linda | Overview at "Big PO", the decision card spotlit (the limit meter, why her, what she decides, what happens after) | refused `submit_po` |
| 5 | Linda approves by text | Overview at "Linda texts", her phone over it | `approve_po`, funded `submit_po` |
| 6 | Escrow released on QC | Plant twin at "QC release" | `confirm_receipt`, `qc_release` |
| 7 | 15 of 15 attacks refused | Attack arena, open on "New bank details by email" (`?attack=15`), the case spotlit, with Kevin's words | three refused transactions; the summary lists all |
| 8 | Group buy PO-G-2001 | Group purchasing | both directors' `approve_po`, `submit_pooled_po`, `qc_release` |
| 9 | 7 of 7 reconciliation checks agree | Reconciliation, PO-1047's USDC card over it | the five calls on `spend-policy-usdc` |
| 10 | Attested answers | Talk to Kevin, the curtain's enclave block; a card with `npm run verify:attestation` | none |
| 11 | Explore a recall, or finish | Lots & recall; Play the tour (T) | none |

Steps 1 and 2 were added Nov 1 (Tony): judge mode had shown the proof and not the premise, a plant Acme just bought and the limits HQ sets. Reconciliation and USDC became one step to keep it near five minutes. The summary card also gives the realized saving at Hollow Pine against Kevin's modeled cost, from the Money page's own tally.

**Wording after Astra's README and judge-mode pass (Nov 2, `docs/astra/2026-11-01_ReadmeJudge.md`):** Linda's step says her reply is simulated and signed with the director key the server holds; the attacks step names the mock ERP among what stopped the fifteen and labels its three links as other cases (the selected email never reached the chain); the reconciliation step says the USDC order is a separate settlement; the attestation step says a signature proves where an answer came from, not that it is right; the summary is "Selected transaction proofs".

Every link comes from the recordings the pages already read (`web/src/data/demo-run.json`, `arena.json`, `group-buy.json`, and `usdc.json`, which `npm run web:data` exports from `data/usdc/`). `web/src/judge.test.ts` checks each one is a well-formed testnet explorer URL whose hash appears in a recording under `data/`, and that the titles carry the proof points as recorded.

**The test count** on the summary card is the last full green run's: `scripts/lib/test-count-reporter.ts` writes it to `data/runtime/test-count.json` (gitignored) after `npm test` or `npm run check` passes with no file filter, and `web/vite.config.ts` reads it at build time. A build on a machine where the suite has not run names the command instead of a number.

## Not built

- Step 10 shows the curtain's attestation chips and the re-verification command; the six recorded, signed answers on Talk to Kevin (`web/src/data/ask.json`, `npm run ask`, recorded Oct 31) are not yet linked from the step.
- The spotlight is a dimmed page with a cut-out; it does not block clicks on the page.
- Linda's phone in the replay shows only the recorded reply; NO says what the recording holds instead. Live mode keeps the existing Up next phone on the Overview.
