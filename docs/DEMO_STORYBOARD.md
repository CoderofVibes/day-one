# Demo storyboard — "Kevin's Survival Guide to the Agentic Economy"

Target: **2:15**, 1080p60, recorded in OBS from the video page (`?video=1`), which plays the recorded testnet run (recorded Nov 4 UTC on `spend-policy-v2`) on a fixed-step clock with these beats and captions (research 16). How to record: docs/RECORDING.md; the timeline is `web/src/video.ts`; the script to read is docs/VOICEOVER.md. Voice-over by the human. Kevin is the character; the tone is warm and plain, never jokey about the money.

Each beat carries a **judge tag**: the judge whose likely question it answers (research 21). The README and the video make the same claims.

---

## Shot list

The voice-over column is the caption burned in on screen; docs/VOICEOVER.md has it laid out for reading aloud.

| Time | Beat (`from=`) | On screen | Voice-over | Judge tag |
|---|---|---|---|---|
| 0:00–0:10 | **Before** (`before`) | The paper batch record BR-B-1045 | "For ten years this was my job. Read the batch record. Type every gram into the ERP. Hope the other plant typed theirs right." | Mumtaz, Garg: is this real? |
| 0:10–0:16 | Title (`title`) | "Day One — He does the paperwork. You run the plant." | "This is Kevin. He's an AI assistant the new owners send in on day one." | — |
| 0:16–0:25 | **Kevin's desk** (`morning-review`) | Kevin's desk before Ray's day: what Kevin handled (ten messages read, the new-bank-details email refused, three drafts waiting for Ray's signature) beside the one thing that needs Ray | "Ray starts his day on Kevin's desk: what Kevin already handled, and what needs Ray. Overnight Kevin drafted replies for Ray to sign and refused a new-bank-details email." | Mumtaz: would a plant use it; Qureshi: who signs |
| 0:25–0:37 | **Batch record in** (`batch-record`) | Kevin's reading of BR-B-1045, then Ray's confirm; Plant B's line departments light up | "Ray uploads the batch record. Kevin reads it and checks it against the formula, and asks before he changes anything." | Qureshi: 90% reliability |
| 0:37–0:45 | **One truth** (`one-truth`) | Plant A's 12.55 kg that is not there, the proposed adjustment | "Kevin catches what the other plant got wrong, and proposes a fix instead of overwriting it." | Lazzarin: what's verifiable |
| 0:45–0:55 | **Quotes** (`quotes`) | Forecast, then three quotes; QuickChem excluded, not qualified; Northgate selected | "He asks the supplier agents for quotes. The cheapest one isn't qualified, so Kevin won't buy from them." | Gershuni: agent-to-agent |
| 0:55–1:05 | **The refusal** (`refusal`) | The desk: PO-1041 done inside the limit, then PO-1042's bar runs past Kevin's $2,500 limit into Linda's decision card | "Kevin isn't allowed to spend that much. Not by a setting in our app. The rule lives on NEAR, and the chain itself said no. So the order becomes one decision for Linda." | Qureshi, Illia: why a chain |
| 1:05–1:15 | **Approve by text** (`approve`) | The desk: Linda's approval lands and the order's track pins its payment condition | "Linda approves from her phone. In this replay her text is simulated and signed with the director's account. Kevin's account can't approve it, and Linda never touches a wallet." | Warwick: where are the keys |
| 1:15–1:23 | **Signed decision** (`signed`; Nov 4) | Behind the curtain, held at the top: PO-1042's decision card, "APPROVE: the response names this PO's fingerprint", "✓ Recorded signature check: verified", "Contract result: funded after Linda approved", the same fingerprint and signed response as the refused attempt | "Kevin's model signed its approval in a secure enclave, for this exact order. A signature isn't permission: it was refused until Linda said yes." | Illia, Lazzarin: is the AI's answer verifiable; Qureshi: who decides |
| 1:23–1:31 | **Delivery** (`delivery`) | Northgate ships; the packing slip photo; the lot in quarantine | "The truck shows up. Tommy checks in the packing slip, Kevin matches it to the PO, and the lot goes to quarantine." | Mumtaz: would a plant use it |
| 1:31–1:39 | **New bank details** (`bank-details`; OPEN_QUESTIONS #41) | Marcy's screen: the attack suite's hidden-text invoice for PO-1042, held; a curtain inset with the account the order was funded for | "Then an invoice arrives saying Northgate's bank details changed. Kevin holds it. Even if he hadn't, the money can only go to the account the order was funded for." | Warwick, Illia: where could the money go |
| 1:39–1:49 | **QC release → paid** (`paid`) | The desk: Priya's release, "Condition met", "PO-1042 is paid."; the payout flies to Northgate on the twin | "Priya releases the lot. The supplier is paid that second, for what was counted in, not in net-30. Accounting sees it matched and paid." | Mumtaz, Lazzarin: settlement rails |
| 1:49–1:57 | **The numbers reconcile** (`reconcile`) | Mass balance: Riverside's 115.2 kg (6.84%), Hollow Pine to the gram | "Material in, batches out, waste claimed: it all has to add up. When a plant's waste doesn't, Kevin tells HQ." | Garg, Lazzarin: outcome, what's verifiable |
| 1:57–2:08 | **Behind the curtain** (`curtain`) | Who signed what and who paid the gas, then the transaction log scrolling, with the refusal in red | "Underneath, everyone is a NEAR account. Kevin's key can only ask; the contract decides. Staff hold zero tokens; Day One pays their gas. Every lot's records are anchored on chain, so nobody can quietly edit history." | Illia, Lazzarin, Warwick |
| 2:08–2:15 | Close (`close`) | "Day One · Built at NEAR HACKATHON", team credit; the repo URL added in the edit once public | "Kevin does the purchasing work. The contract enforces the limits HQ sets, and every recorded payment traces to its order." | Qureshi |

**Nov 4 change (Tony; OPEN_QUESTIONS #51, #52):** the "Signed decision" beat (8 s) went in after Linda's approval, so the v2 contract's newest guarantee is in the take: the model's approval is authentic and checked by the contract, and it still did not authorize the purchase; Linda did. To fit, "Delivery" lost its first 2 s (the funded retry now sits on the new beat) and "Behind the curtain" went from 16 s to 11 s with three captions; its last caption now names the anchored lot records (the lot passports). "QC release → paid" says the supplier is paid for what was counted in (receipt-bound settlement). The close no longer says nobody can change the rule: HQ can, and the operator keeps deployment keys (Astra, `docs/astra/2026-11-04_Complexity.md`). 2:14 became 2:15, five seconds under the export limit.

**Earlier changes:** the "New bank details" beat (Oct 29, 8.5 s) and the "Morning review" beat (Oct 30, 9 s) went in with nothing trimmed; Kevin's desk replaced the floor cards on four beats (Oct 31, docs/DESK.md).

**The tour** (`?video=1&tour=1`, 2:41, docs/RECORDING.md §7) plays the same beats with the curtain on at the refusal, Linda's phone in the panel for her approval, camera keyframes on the "HQ & Escrow" and "Receiving & Warehouse" views, and three beats the take has no room for: **Group buy** (PO-G-2001, two plants at $4,745.00 each, Lakeview sat it out), **Real USDC** (PO-1047, $19.00 in Circle testnet USDC on a separate deployment of the first contract version) and **21 of 21 refused**, then the close. If the take must carry one of them, trim "Behind the curtain" or "The numbers reconcile" first.

---

## Recording checklist

- The recorded testnet run, played by the video page: every transaction on screen is real and linked, and testnet latency never shows. No reset is needed for the video.
- Explorer insets, if used, are screenshots of the hashes in `data/replay/transcript.txt` (the three to use are in docs/RECORDING.md).
- No real names, no real company, no personal data on screen. Browser profile clean; no bookmarks or notifications.
- Captions burned in (many judges watch muted): the video page draws them.
- Export ≤ 2:20 so X accepts it without trimming.

---

## Team credit (end card or voiceover, approved by Tony, Oct 26)

> Built by DadMod: one nuclear-startup engineer running on newborn hours, a project manager that never sleeps, and an engineer that never gets tired of tests. Kevin is the only one of us allowed near the purchase orders.

## X post (draft, ≤280 characters; rewritten Nov 4 to HACKATHON.md's demo-post rules)

> A small plant just changed hands. Its new owner needs purchasing to run on day one. Kevin, an AI agent, buys inside limits the owner sets on NEAR: over the limit, the contract refuses until the director says yes. Built at NEAR HACKATHON @NEARProtocol #NEARHackathon

265 characters. It leads with the user problem, names NEAR's concrete role and carries both required tags; @NearLegion and @NearBuilders are optional (they fit only if the post stays under 280). Attach the video (the rules say screenshots are not enough for a local-only demo, Q-012). Reply in thread with the repo link, the refused-transaction explorer link and one real question, for example "Plant people: what would you want an agent like this to never do?" The human posts it; nothing is posted without explicit confirmation.

---

## Submission form drafts (human confirms on Nov 14)

- **Project name:** Day One: AI Purchasing for Acquired Plants
- **Team lead name:** Anthony Langford (Tony, Oct 27)
- **Email:** given by Tony Oct 27; kept out of the repo because it goes public. Tony enters it himself. One email may send 2 submissions (HACKATHON.md, Nov 4), so the same one can serve Everstreet.
- **Team size:** 1
- **NEAR wallet address (payout):** `Tony's prize account` (Meteor Wallet, created by Tony Oct 27; agents never touch it)
- **Tracks:** `realworld`, `business`, `security`, `agents`, `swarms` (Tony, Nov 8, OPEN_QUESTIONS #53: swarms added for the recorded group buy and sealed round; privacy not added). The form shows display names: Real-World Money, Autonomous Business, AI Security & Defense, Agent Economy, AI Swarms.
- **Repository link:** the public URL of `github.com/CoderofVibes/day-one`, once Tony makes it public.
- **Demo post link:** the X post's URL, once posted.
- **Consent:** Tony ticks it himself.
- **Order (Tony, Nov 4):** Everstreet is submitted first, then Day One.
- **Website field:** leave empty. HACKATHON.md says it is a spam honeypot and any value is rejected (research 19).
- **Description (draft, ≤2000 characters; matches the README's opening, Nov 4):**

> Day One is built for the day a small manufacturing plant changes hands. Small family manufacturers are bought and folded into larger companies, and every deal hits the same wall: a plant that runs on paper batch records and hand-keyed inventory. The new owner sets spending rules once, and Kevin, an AI agent supervised by plant staff, takes on the plant's purchasing and inventory work inside them, without waiting for an ERP migration.
>
> Kevin reads batch records and spreadsheets, tracks stock and lots across three plants, flags when another plant's numbers don't match, forecasts what to reorder, compares quotes from supplier agents and prepares POs. Staff confirm his drafts and see only dollars, POs and decisions.
>
> Underneath, a NEAR testnet contract enforces his limits: an over-limit PO is refused by the contract, not by our database, and goes to the plant director. Above $2,500 the contract also checks Kevin's decision, signed by his model inside NEAR AI Cloud's enclave for that exact PO; a signature alone never authorizes a purchase. Funds wait in PO escrow and are paid to the supplier fixed on the PO after receipt and QC release, for the quantity counted into stock. Lot records are anchored as daily Merkle roots, so one lot's history can be proved against the chain. Staff hold no tokens; a relayer pays their gas.
>
> The repo replays every recorded testnet transaction from a clean clone with no keys; `npm run prove` checks every claim. 21 recorded attacks are each stopped by Kevin, the mock ERP or the contract. All plant data is fictional; the director's text reply is simulated, staff keys are held by the server, the ERP is a mock, and the main run settles in a labeled test token.
