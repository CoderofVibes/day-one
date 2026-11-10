# Judge mode, Linda's phone and the Plant twin page

Built Oct 31 on `upgrade/judge` (brief §5.12, §5.9 item 1, §5.6 "Plant map → Plant twin"). The tour itself is in docs/RECORDING.md §7.

## Addresses

| Address | What opens |
|---|---|
| `?judge=1` | Judge mode at step 1: the recorded replay, dark, the curtain off for the two premise stops and on for the rest, the stepper docked at the bottom (a bottom sheet on a phone). Always the replay, even when the API runs |
| `?judge=<n>`, `?judge=summary` | Step n (1–6), or "See every proof" |
| `?page=approve&po=1042` | Linda's phone alone, 390×844 (the whole screen on a phone); `&curtain=1` shows "Approved on testnet ✓", `&replied=1` opens on her recorded YES |
| `?page=map` | The Plant twin page |
| `?video=1&tour=1` | The tour (docs/RECORDING.md §7) |
| `?video=1&cut=order` | The 2:07 submission cut, from the Day One Overview and plant handover to NEAR verification |

The header's pine-green **Judge mode** button opens it from 1440 px; under that it is in the header's menu. On the live UI it reloads into `?judge=1`.

## The first shift (Nov 1)

The front door (OPEN_QUESTIONS #45 and #46; Astra's design, `docs/astra/2026-11-01_FirstShift.md`). On a bare first visit to the replay, Kevin introduces himself on a quiet screen: a green line that moves as each of three captions lands, Ray's desk fading in behind (`web/src/FirstShift.tsx`, `KevinPresence.tsx`). "Show me around" starts the walkthrough, "Open my desk", Skip or Escape go straight to the Overview at 5:00 AM; "Read introduction" shows all three captions at once. Any query or hash (a page, a plant, `?inspect=`, `?judge=1`, `?video=1`, `?page=approve`) skips it, and so does a returning visitor (`day-one:first-shift:v1`, the old guide's closed flag, or a saved clock); blocked storage counts as a first visit. "Meet Kevin · first shift" in the header menu replays it.

The walkthrough uses judge mode's spotlight (`web/src/Spotlight.tsx`) and the same page-and-step routing, with its own script (`web/src/shiftScript.ts`): six stops of Ray's morning with the curtain off (the mail Kevin reviewed, the batch record that needs him, its place on the plant, the three drafts, his spending limits, Acme's books), then three behind the curtain with their testnet links (the refused PO-1042, Linda's simulated approval signed with the server-held director key and the escrow paying on QC release, 21 of 21 attacks refused; the count is read from the arena's recording). About two minutes with the intro. It ends on "Start your shift" (the desk at 5:00 AM) or "Review the evidence" (judge mode below). It only opens pages: nothing is signed, confirmed or stepped. `web/src/shiftScript.test.ts` holds the first-open rule and keeps the chain out of Ray's stops.

## The steps

`web/src/judge.ts` holds them as data; `web/src/JudgeMode.tsx` draws them. Since Nov 4 (Astra's complexity pass, `docs/astra/2026-11-04_Complexity.md`; Tony approved the batch) the core path follows one order, PO-1042, from need to payment in six stops, about three and a half minutes; everything else is a proof under "See every proof".

| # | Step | Page, recorded step | Proof links |
|---|---|---|---|
| 1 | Kevin takes on the purchasing work | Spreadsheets with the inventory workbook spotlit (19 rows read, 9 asked about) until "Next: Ray's desk", then the Overview at "Small PO" with Kevin's desk spotlit; curtain off | PO-1041's `submit_po` |
| 2 | HQ sets what Kevin may spend | Spending limits, curtain off; a card with the limits as the recorded run read them from the contract, nothing else | none |
| 3 | The model approved. The contract still refused. | Overview at "Big PO", the decision card spotlit, the contract's refusal quoted; the curtain's decision card reads "refused, Linda's approval required" beside a verified signed APPROVE | refused `submit_po` |
| 4 | Linda approves; Kevin's signed decision stays the same | Overview at "Kevin retries", the curtain's decision card spotlit: "funded after Linda approved", the same PO fingerprint and signed response as the refused attempt, and the director's server-held key named as a separate signature | `approve_po`, funded `submit_po` |
| 5 | Received, released, paid | Plant twin at "QC release": 700 kg counted in, the $5,150.00 invoice, the contract paying the smallest of escrow, pro rata escrow and invoice | `confirm_receipt`, `record_invoice`, `qc_release` |
| 6 | The lot keeps the record | Lots & recall, the "Prove it" panel spotlit, with the caveat that the seeded history's roots were anchored together on Nov 3; "Open it" opens `?page=lots&prove=1` in a new tab with the check running | the last `anchor_batch` of each plant |

**See every proof** (the summary, `?judge=summary`) lists the proofs in this order, each opening like a step with "← Every proof" to come back: 21 of 21 attack scenarios stopped (the arena on the bank-details email, `?attack=15`); a short delivery paid pro rata (attack 19); group buy PO-G-2001 (two plants, Lakeview stays out); 7 of 7 reconciliation checks; PO-1047 in Circle testnet USDC, on the first contract version; attested answers; HQ changing a limit in plain words (the $3,000 draft and `npm run policy`, unsigned); the recall drill; the captioned tour. Below them, folded, every recorded transaction judge mode links (38). `proofLinks()` reads both the core stops and the proofs, so moving a step out of the core path never drops its evidence; `web/src/judge.test.ts` checks it.

The curtain's decision card (`DecisionCard` in `web/src/Curtain.tsx`) is built from the recording only: `npm run web:data` joins each `submit_po`'s `decision` argument to the attested answer with the same chat id and response SHA-256 (`scripts/lib/decisionEvidence.ts`), and a missing or unverified link shows the failed check instead of a green mark. The contract's outcome leads in its own colour (amber refused, blue funded), so a verified signature never reads as permission to spend.

History: steps 1 and 2 were added Nov 1 (Tony, OPEN_QUESTIONS #47) for the premise; steps for v2 settlement, the signed decision and the lot passports Nov 3, thirteen steps in about six minutes. On Nov 4 the premise stops stayed (the workbook as step 1's prelude), the plain-words limit change moved to the proofs, and the attacks, group buy, USDC, reconciliation and attestation moved under "See every proof" with all their links. A step may carry an `open` link beside its chain links: a page of the site a judge can run a check on, opened in a new tab so judge mode keeps its place. The spotlight fits its subject between the header and the guide's bottom sheet on a phone (`web/src/Spotlight.tsx`), and Back and Next stay pinned at the sheet's foot. Nov 5 (the first-use review, `docs/reviews/2026-11-05_first-use.md`): nothing moves unless the judge presses something (step 1's workbook gives way on Next instead of after four seconds), the run's own Back/Next panel is hidden while the judge card is up, Kevin's limits and the plain-words example sit inside the card, terminal commands fold under "From a terminal", "Show the page" folds the card on a phone, and the spotlight follows its subject for two seconds while the page above it loads.

**Wording after Astra's README and judge-mode pass (Nov 2, `docs/astra/2026-11-01_ReadmeJudge.md`):** Linda's step says her reply is simulated and signed with the director key the server holds; the attacks step names the mock ERP among what stopped the attacks (fifteen then, twenty-one since Nov 3) and labels its three links as other cases (the selected email never reached the chain); the reconciliation step says the USDC order is a separate settlement; the attestation step says a signature proves where an answer came from, not that it is right; the summary is "Selected transaction proofs".

Every link comes from the recordings the pages already read (`web/src/data/demo-run.json`, `arena.json`, `group-buy.json`, `usdc.json` and `lot-anchors.json`, which `npm run web:data` exports from `data/usdc/` and `data/lots/`). `web/src/judge.test.ts` checks each one is a well-formed testnet explorer URL whose hash appears in a recording under `data/`, and that the titles carry the proof points as recorded.

**The test count** on the summary card is the last full green run's: `scripts/lib/test-count-reporter.ts` writes it to `data/runtime/test-count.json` (gitignored) after `npm test` or `npm run check` passes with no file filter, and `web/vite.config.ts` reads it at build time. A build on a machine where the suite has not run names the command instead of a number.

## Not built

- The attested-answers proof shows the curtain's attestation chips and the re-verification command; the six recorded, signed answers on Talk to Kevin (`web/src/data/ask.json`, `npm run ask`, recorded Oct 31) are not yet linked from the step.
- The spotlight is a dimmed page with a cut-out; it does not block clicks on the page.
- Linda's phone in the replay shows only the recorded reply; NO says what the recording holds instead. Live mode keeps the existing Up next phone on the Overview.

## Nov 7 README alignment

The README opens on the acquisition handover and PO-1042. Step 3 emphasizes that the model signed APPROVE while the contract still required Linda’s authorization. Step 4 identifies the supplied fingerprint as a trust boundary. The contract relies on Kevin to bind that fingerprint to the submitted terms. The [quantity boundary test](../contracts/spend-policy/src/tests/settlement.rs) demonstrates that v2 accepts a changed quantity under the same approved fingerprint.

The attack summary counts scenarios stopped across the app, mock ERP and contract. Some are held before any transaction, and the short delivery releases a reduced payment successfully. The recall drill uses seeded lot history.
