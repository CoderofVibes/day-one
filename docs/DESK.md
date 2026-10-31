# Kevin's desk

Built Oct 31, in Tony's interactive session, from an outside product and design review he brought in. The goal is for someone on the floor to see two things at a glance: Kevin did the tedious part, and exactly what still needs them. The desk is the top of the Overview, for Hollow Pine (the plant the recorded run is about).

Code: `web/src/desk.ts` (the model: pure, tested in `desk.test.ts`), `web/src/KevinDesk.tsx` (the component), `web/src/desk.css` (its look). The Overview mounts it (`web/src/pages/Overview.tsx`). The replay and the live app hand it whose turn it is and the decision's buttons (`web/src/App.tsx`).

## What it shows

**Needs you.** This is the one decision that needs a person now, answered in three lines:

- **Why you.** Why a person is needed here and Kevin can't do it alone.
- **What you decide.** The choice itself, with its numbers.
- **What happens next.** What follows each answer.

The buttons use the person's own words ("Approve PO-1042", "Release lot ASC-261116-01", "Confirm BR-B-1045"). In the live run, a reply to Linda's text reads as Approve or Decline. When the scan folder holds records, Ray's card holds the scan queue itself. When nobody is needed, the card says what Kevin is doing and offers the next step. When the order closes, it reads "All clear".

Small asks that wait beside the decision sit under the card: Ray's mail drafts to sign, and the correction Riverside has to review.

**Handled for you.** This lists what Kevin has done, newest first, read from the run's recorded lines, the morning review and the scan folder. Each entry is marked as one of:

- **Done.** Finished, and nothing waits on it.
- **Decided.** A person decided and Kevin carried it out.
- **Draft.** Prepared, and waiting on a signature.
- **Suggested.** A recommendation, with what became of it, such as "became PO-1042".
- **Held.** A request Kevin refused to act on, such as the new-bank-details email.

Every entry opens the recorded words behind it, its record links and "Show on the plant". Staff words only: an account that an email named stays behind the curtain (`staffWords`).

**The order's track.** PO-1042 shows each stage from draft to paid: drafted, over the limit or approved, money set aside, shipped, received, QC release, paid. From the moment Linda approves, the payment's condition is pinned under the track: "Pays Northgate Ingredients only, and only when QC releases the lot". After payment it reads as met.

**Before we buy.** The question is "Does Acme already own it?" for the run's ascorbic acid. Kevin compares each other plant's stock with its own reorder point and with any correction pending on it. Riverside's 12.55 kg is on the books only, and Lakeview does not stock ascorbic acid. Then come the order Kevin placed and what pooling would change. Riverside is short too, and in the recorded group purchase PO-G-2001 pooling got $6.65/kg instead of $7.10. Each option carries a verdict (no / yes / worth asking) and a reason. It shows on Kevin's card while he is buying and on Linda's card when she decides. Every figure comes from the ledger snapshot, the recorded lines or `group-buy.json`.

## Show on the plant

Every decision and many handled entries name a place: the presses, the purchasing office, the receiving dock, the lot in quarantine, the escrow, accounting. "Show on the plant" tells the twin under the desk to fly there and open the Inspector on that object, using the same id as the Inspector's `?inspect=`. For Priya, that object is lot ASC-261116-01 in the quarantine cage, the same code as on her card. If an object is not drawn at that step, the twin falls back to the department. The prop is `PlantView`'s `focus`.

## Purchasing's order desk

The same desk opens the Purchasing page for Hollow Pine (`web/src/OrderDesk.tsx`), as a compact queue on the left and the selected order on the right.

- **The queue** has three groups: an order a person decides on now (labelled with who: "needs Linda", "needs Priya"), orders in flight, then the last six closed. PO-1042 and PO-1041 take their state from the run's recorded lines (`orderRows` in `desk.ts`), because the ledger snapshot holds the run's end. Other orders come from the ledger up to the clock's day.
- **An order that needs a person** opens the Overview's own decision card, with the same buttons, limit meter and "Before we buy". Approving on Purchasing is the same action as approving on the Overview.
- **Any other order** shows what happens next, or how it closed, and its track with the payment condition. On Kevin's and the supplier's steps, PO-1042's card carries the replay's Next button, so the whole order can be stepped through from this page.
- **"Show on the plant"** opens the Plant twin on the order (`?inspect=PO-1042`). The Inspector's "Open in Purchasing" leads back, so the record, the twin and the Inspector name the same object.
- On a narrow screen, the selected order comes before the queue.

## The 5am brief as a morning sheet

The brief page (`web/src/pages/BriefSheet.tsx`, ordering in `web/src/briefSheet.ts`) sets the same brief Kevin writes (`npm run brief`, `GET /api/brief`) as one paper page on the graphite. It has a serif greeting from the system's fonts (no download), the day in four numbers, then the sections in reading order: what needs a person (amber), what to buy or move, what is worth a look, and what moved since the last working day. A "Before you buy" move from another plant sits under the material it would stand in for, as "Or move it instead". Record ids in a line open their records. The footer says what the sheet is: written from the ledger, nothing ordered, signed or sent. Print still opens the printable page.

## Look

- **A graphite surface with paper-white cards, the same in both themes.** In the light theme it becomes the page's anchor. The paper card re-declares the light tokens and the graphite the dark ones, so the kit's links and pills inside follow without a second style.
- **Cyan marks focus only:** the decision in front of you, the stage the order is at now, and where it is on the plant. Status colours keep their meaning from `tokens.css`.
- **Type does the composition:** a 30 px decision title, small uppercase question labels, tabular figures. The primary button is solid ink, not a colour, so it reads as the action without competing with status colours.
- The desk adapts to its own width (container queries). It runs two columns down to about 640 px, and below 520 px each answer stacks under its question.

## Motion

Only three moments move, and `prefers-reduced-motion` turns them off:

1. **Limit.** On Linda's card, the order's bar fills to Kevin's $2,500 limit, runs past it in amber, the limit tick knocks, and the line "Over the limit, so it came to Linda" appears. Then her three answers rise in.
2. **Approval.** Her decision slides in at the top of "Handled for you" with a brief cyan wash. The track's approved stage pops, and the payment condition appears pinned.
3. **QC release and payment.** The line from QC release to Paid draws in gold, the paid stage pops, and the condition turns to "Condition met".

A routine success, such as PO-1041 placed inside the limits, lands with the same slide-in and its check mark draws.

## Judge mode

The first two steps now open on the desk. Step 1 is Kevin's handled work, at "Small PO", where PO-1041 links to its transaction. Step 2 is Linda's decision card at "Big PO", with the contract's verbatim refusal. The approval, the QC release in 3D, then the attacks, group buy, reconciliation, USDC, attestation and the recall drill follow as before (`docs/JUDGE_MODE.md`).
