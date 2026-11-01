# Judge mode, Linda's phone and the Plant twin page

Built Oct 31 on `upgrade/judge` (brief §5.12, §5.9 item 1, §5.6 "Plant map → Plant twin"). The tour itself is in docs/RECORDING.md §7.

## Addresses

| Address | What opens |
|---|---|
| `?judge=1` | Judge mode at step 1: the recorded replay, dark, the curtain on, the stepper docked at the bottom (a bottom sheet on a phone). Always the replay, even when the API runs |
| `?judge=<n>`, `?judge=summary` | Step n, or the summary card with every proof link |
| `?page=approve&po=1042` | Linda's phone alone, 390×844 (the whole screen on a phone); `&curtain=1` shows "Approved on testnet ✓", `&replied=1` opens on her recorded YES |
| `?page=map` | The Plant twin page |
| `?video=1&tour=1` | The tour (docs/RECORDING.md §7) |

The header's pine-green **Judge mode** button opens it from 1440 px; under that it is in the header's menu. On the live UI it reloads into `?judge=1`.

## The first shift (Nov 1)

The front door (OPEN_QUESTIONS #45 and #46; Astra's design, `docs/astra/2026-11-01_FirstShift.md`). On a bare first visit to the replay, Kevin introduces himself on a quiet screen: a green line that moves as each of three captions lands, Ray's desk fading in behind (`web/src/FirstShift.tsx`, `KevinPresence.tsx`). "Show me around" starts the walkthrough, "Open my desk", Skip or Escape go straight to the Overview at 5:00 AM; "Read introduction" shows all three captions at once. Any query or hash (a page, a plant, `?inspect=`, `?judge=1`, `?video=1`, `?page=approve`) skips it, and so does a returning visitor (`day-one:first-shift:v1`, the old guide's closed flag, or a saved clock); blocked storage counts as a first visit. "Meet Kevin · first shift" in the header menu replays it.

The walkthrough uses judge mode's spotlight (`web/src/Spotlight.tsx`) and the same page-and-step routing, with its own script (`web/src/shiftScript.ts`): six stops of Ray's morning with the curtain off (the mail Kevin reviewed, the batch record that needs him, its place on the plant, the three drafts, his spending limits, Acme's books), then three behind the curtain with their testnet links (the refused PO-1042, Linda's own-key approval and the escrow paying on QC release, 15 of 15 attacks refused). About two minutes with the intro. It ends on "Start your shift" (the desk at 5:00 AM) or "See every proof" (judge mode below). It only opens pages: nothing is signed, confirmed or stepped. `web/src/shiftScript.test.ts` holds the first-open rule and keeps the chain out of Ray's stops.

## The steps

`web/src/judge.ts` holds them as data; `web/src/JudgeMode.tsx` draws them.

| # | Step | Page, recorded step | Proof links |
|---|---|---|---|
| 1 | Kevin handled the paperwork | Overview at "Small PO", Kevin's desk spotlit; the curtain flips on after 1.5 s | PO-1041's `submit_po` |
| 2 | One decision needs Linda | Overview at "Big PO", the decision card spotlit (the limit meter, why her, what she decides, what happens after) | refused `submit_po` |
| 3 | Linda approves by text | Overview at "Linda texts", her phone over it | `approve_po`, funded `submit_po` |
| 4 | Escrow released on QC | Plant twin at "QC release" | `confirm_receipt`, `qc_release` |
| 5 | 15 of 15 attacks refused | Attack arena | three refused transactions; the summary lists all |
| 6 | Group buy PO-G-2001 | Group purchasing | both directors' `approve_po`, `submit_pooled_po`, `qc_release` |
| 7 | 7 of 7 reconciliation | Reconciliation | none: the checks read contract views |
| 8 | Real USDC, PO-1047 | Spending limits, PO-1047's card over it | the five calls on `spend-policy-usdc` |
| 9 | Attested answers | Talk to Kevin, the curtain's enclave block; a card with `npm run verify:attestation` | none |
| 10 | Recall drill, and the tour | Lots & recall; Play the tour (T) | none |

Every link comes from the recordings the pages already read (`web/src/data/demo-run.json`, `arena.json`, `group-buy.json`, and `usdc.json`, which `npm run web:data` exports from `data/usdc/`). `web/src/judge.test.ts` checks each one is a well-formed testnet explorer URL whose hash appears in a recording under `data/`, and that the titles carry the proof points as recorded.

**The test count** on the summary card is the last full green run's: `scripts/lib/test-count-reporter.ts` writes it to `data/runtime/test-count.json` (gitignored) after `npm test` or `npm run check` passes with no file filter, and `web/vite.config.ts` reads it at build time. A build on a machine where the suite has not run names the command instead of a number.

## Not built

- Step 9 shows the curtain's attestation chips and the re-verification command; the six recorded, signed answers on Talk to Kevin (`web/src/data/ask.json`, `npm run ask`, recorded Oct 31) are not yet linked from the step.
- The spotlight is a dimmed page with a cut-out; it does not block clicks on the page.
- Linda's phone in the replay shows only the recorded reply; NO says what the recording holds instead. Live mode keeps the existing Up next phone on the Overview.
