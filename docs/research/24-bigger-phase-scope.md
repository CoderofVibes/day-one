# 24. Scope: morning review and the watched batch-record folder

Tony's two ideas for the "bigger" phase (Oct 28, relayed by Muse in bridge message 70; proposal only, nothing built). Tony reviews on Oct 29. "Great, then bigger" (OPEN_QUESTIONS #32) and "extras only if time" (#29) still apply: both come after the Nov 10 cut decision unless Tony moves them.

## 1. Watched batch-record folder

**What it is.** A folder (`data/inbox/batch-records/` in the demo) that Kevin watches. A scanned record dropped there runs through the extraction pipeline that already exists (`agents/kevin/src/extraction.ts`): transcribe, check against the formula and the ledger, raise flags. The result waits in a review queue; Ray confirms or answers flags. Nothing posts on its own.

**Fit.** Good. The new parts are small: a watcher (Node `fs.watch` plus a poll fallback, since Windows and network drives drop events), a queue table (file hash, status, extraction result, flags), a route to list the queue, and a "Waiting for you" list on Ray's screen. Confirm is the existing `POST /api/batch-records/:batchNo/confirm`. With the ERP integration (#32), the confirmed batch's consumption reaches the ERP through the connector as today.

**Size.** About one day: half a day for watcher, queue and dedupe by file hash; half a day for the screen and tests. Replay mode needs recorded vision answers for every file in the demo inbox (today only BR-B-1045 is recorded), so a re-record of the other six bake-off records into replay fixtures is part of it (a few cents on NEAR AI Cloud).

**Risks.** A half-written file picked up mid-copy (wait until the size is stable); the same scan dropped twice (hash); a photo that is not a batch record (the pipeline already returns a 422). No new trust surface: the files are the plant's own.

**Recommendation.** Build it first of the two, after the Nov 10 cut. It reuses the most, shows "Kevin already did the work" plainly, and has no privacy question.

## 2. Morning review (Kevin reads email and meeting notes overnight)

**What it is.** Overnight, Kevin reads the purchaser's mailbox and meeting notes, does what they imply in Day One (a supplier's price change, a late delivery, a "we need more citric for the Thursday run"), and leaves it as drafts for sign-off with the morning coffee.

**Relation to the 5am brief.** It is the 5am brief (PLAN Nov 12, T2) grown up: the brief reports what Kevin saw in the ledger; the morning review also acts on outside inputs. One item, not two. Recommend renaming the brief item to "Morning review" and building the brief as its first half.

**Fit.** Medium. Kevin's existing actions cover most outcomes: draft a PO (policy limits still enforced by the contract), flag a supplier, update an expected delivery. New: a mailbox source, a reader that turns a message into a proposed action with the reasoning route, and a sign-off screen. Every proposed action stays a draft until a person signs it; Kevin never sends email.

**Demo data.** A mock mailbox of 8–12 invented emails and two meeting notes (fictional data only, hard rule 4), including one with hidden instructions, so the attack suite gains a fifth Kevin attack ("an email tells Kevin to pay a new account": refused, flagged).

**Size.** Two to three days: mock mailbox and parser (half), reader on the reasoning route with recorded replay (one), sign-off screen (half), attack case and tests (half). Live model calls are cheap; replay must be recorded.

**Risks.** The sensitive one is access: real employee email. For the hackathon it is a fictional mailbox only, and the README states that a real deployment needs the employee's consent and read-only, per-folder access (an IMAP or Graph scope the company grants). Prompt injection through email is the main technical risk; the attack case covers it, and the contract still refuses anything over policy. Scope creep is the schedule risk.

**Recommendation.** Second, and only if the Nov 10 cut is a clear go. Build the ledger-only 5am brief first (half a day), then the mailbox half if time remains.

**Built Oct 30 (first slice, unattended run):** the mailbox (`server/src/seed/mailbox.ts`), the reader and the checks (`agents/kevin/src/morningReview.ts`), `npm run review` with its recording and attestation. Two things the scope did not foresee: the model invented a company or a price in about one short message in five, so every reading is checked against the raw text, read again on a miss, and then becomes a question; and the plant's schedule, not a PO, is what most messages touch (a batch moved, a batch resized). The attack case is attack 15 of `npm run test:attacks`. Left: the sign-off on Ray's screen.

## Order against the existing stretch list

After the Nov 10 cut: (1) watched folder, (2) 5am brief → morning review, then the rest of the T2 list as it stands (3D twin, Kevin as an MCP server, natural-language policy, NEAR Auth spike). Group purchasing, supplier credentials and sealed bids run in their own sessions (#33) and are not affected.
