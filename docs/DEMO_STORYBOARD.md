# Demo storyboard — "Kevin's Survival Guide to the Agentic Economy"

Target: **2:03**, 1080p60, recorded in OBS from the video page (`?video=1`), which plays the recorded testnet run on a fixed-step clock with these beats and captions (research 16). How to record: docs/RECORDING.md; the timeline is `web/src/video.ts` (1:57 until the UI design session adds the "New bank details" beat below; then about 2:05). Voice-over by the human. Kevin is the character; the tone is warm and plain, never jokey about the money.

Each beat carries a **judge tag**: the judge whose likely question it answers (research 21). The README and the video make the same claims.

---

## Shot list

| Time | Beat | On screen | Voice-over (draft) | Judge tag |
|---|---|---|---|---|
| 0:00–0:10 | **Before** | Clipboard batch record, a cursor keying grams into an ERP-like grid, a whiteboard of lot numbers | "For ten years this was my job. Read the batch record. Type every gram into the ERP. Hope the other plant typed theirs right." | Mumtaz, Garg: is this real? |
| 0:10–0:16 | Title | "Day One" + "He does the paperwork. You run the plant." Kevin labeled "AI assistant" | "This is Kevin. He's an AI assistant the new owners send in on day one." | — |
| 0:16–0:28 | **Batch record in** | Ray drags BR-B-1045 (scanned look) into the UI. Draft appears; one field highlighted; Ray clicks Confirm. Inventory number drops. | "Ray uploads the batch record. Kevin reads it, checks it against the formula, and asks before he changes anything." | Qureshi: 90% reliability |
| 0:28–0:36 | **One truth** | Map: Plant A shows a phantom 12.55 kg; Kevin's note proposing the adjustment | "Kevin catches what the other plant got wrong, and proposes a fix instead of overwriting it." | Lazzarin: what's verifiable |
| 0:36–0:46 | **Quotes** | Three supplier agents reply; QuickChem struck through "not qualified"; Northgate selected | "He asks the supplier agents for quotes. The cheapest one isn't qualified, so Kevin won't buy from them." | Gershuni: agent-to-agent |
| 0:46–0:56 | **The refusal** | PO-1042 $5,150.00 → "Over Kevin's $2,500 limit. Sent to Linda." Small inset: red Failed tx on testnet explorer | "Kevin isn't allowed to spend that much. Not by a setting in our app. The rule lives on NEAR, and the chain itself said no." | Qureshi, Illia: why a chain |
| 0:56–1:06 | **Approve by text** | Phone mock: Linda's thread, "Reply YES 1042", she taps YES. "Approved." | "Linda approves from her phone. That YES becomes a transaction signed by her own account. Kevin can't fake it, and Linda never touches a wallet." | Warwick: where are the keys |
| 1:06–1:16 | **Delivery** | The packing slip → "Matches PO-1042". Lot appears in quarantine (amber cage) on the map | "The truck shows up. Tommy checks in the packing slip, Kevin matches it to the PO, and the lot goes to quarantine." (Kevin matches the slip's details; reading the photo is not built) | Mumtaz: would a plant use it |
| 1:16–1:24 | **New bank details** (Tony, Oct 29; OPEN_QUESTIONS #41) | Marcy's accounts screen: a second Northgate invoice for PO-1042 lands, "remit to northgate-remit.testnet" (the attack suite's hidden-text invoice, `data/attacks/invoices.json`). Kevin holds it: "asks for payment to a different account; the order can only pay Northgate." Small inset: PO-1042 on the curtain, escrow $5,150.00, payee `northgate-ingredients.testnet`, fixed when it was funded | "Then an invoice arrives saying Northgate's bank details changed. Kevin holds it. And even if he hadn't, the money can only go to the account the order was funded for." | Warwick, Illia: where could the money go |
| 1:24–1:34 | **QC release → paid** | Priya taps Release. Money flow animates escrow → Northgate. Marcy's screen: "PO-1042 — paid $5,150.00" | "Priya releases the lot. The supplier is paid that second, not in net-30. Accounting sees it matched and paid." | Mumtaz, Lazzarin: stablecoin rails |
| 1:34–1:42 | **The numbers reconcile** (replaces "Plant comes online", Tony Oct 27) | HQ view: Hollow Pine P-CMD balances to the gram; Riverside shows "115.2 kg unaccounted over two batches, 6.84%: waste looks under-recorded" (the ledger holds two of §15's three batches); departments lit in the background | "Material in, batches out, waste claimed: it all has to add up. When a plant's waste doesn't, Kevin tells HQ, and pounds versus kilograms is no excuse." | Garg, Lazzarin: outcome, what's verifiable |
| 1:42–1:58 | **Behind the curtain** | Toggle flips. Every account in the run with what it signed and who paid its gas (Kevin: submit_po, anchor_batch; Linda, Tommy, Priya: gas paid by the relayer); tx log with the red refusal, the relayed approval, the payout. Optional cut-in: `npm run verify` on BR-B-1045 → MATCH (a terminal clip; not on the page) | "Here's what's underneath. Every person and agent is a NEAR account. Kevin's key can only ask; the contract decides. Staff hold zero tokens; Day One pays their gas. Records are fingerprinted on-chain, so nobody can quietly edit history." | Illia, Lazzarin, Warwick |
| 1:58–2:03 | Close | "Built at NEAR HACKATHON" · repo URL | "Kevin doesn't need crypto. The plant, the new owners and the supplier do: one rule none of them can quietly change." | Qureshi |

If Tier 2 ships, the plant map in 0:28–0:36 and 1:34–1:42 is the 3D twin. Nothing else changes.

**Oct 29 change (OPEN_QUESTIONS #41):** the "New bank details" beat (8 s) went in between Delivery and QC release, so the payout that follows shows the money going to the real Northgate. Nothing was trimmed: 1:55 became 2:03, under the 2:20 export limit. If a later beat has to grow, trim "Behind the curtain" first (its 16 s hold two things a judge can read in 12).

If the privacy track is tagged, add a 3-second inset at 1:48: "Kevin's reasoning runs in an attested enclave on NEAR AI Cloud ✓ verified".

---

## Recording checklist

- The recorded testnet run (Oct 29), played by the video page: every transaction on screen is real and linked, and testnet latency never shows. No reset is needed for the video.
- Explorer insets are real screenshots of the hashes in `data/replay/transcript.txt` (the three to use are in docs/RECORDING.md).
- No real names, no real company, no personal data on screen. Browser profile clean; no bookmarks or notifications.
- Captions burned in (many judges watch muted): the video page draws them.
- Export ≤ 2:20 so X accepts it without trimming.

---

## Team credit (end card or voiceover, approved by Tony, Oct 26)

> Built by DadMod: one nuclear-startup engineer running on newborn hours, a project manager that never sleeps, and an engineer that never gets tired of tests. Kevin is the only one of us allowed near the purchase orders.

## X post (draft, ≤280 characters)

> Day One: Kevin is an AI purchasing assistant for small plants that just got acquired. He reads batch records, gets quotes and drafts POs. Spending limits live on NEAR, approvals come by text, suppliers get paid on delivery. No wallets on the floor. Built at NEAR HACKATHON. 🧵

Attach the video. Reply in thread with the repo link and the refused-transaction explorer link. The human posts it; nothing is posted without explicit confirmation.

---

## Submission form drafts (human confirms on Nov 14)

- **Project name:** Day One: AI Purchasing for Acquired Plants
- **Team lead name:** Anthony Langford (Tony, Oct 27)
- **Email:** given by Tony Oct 27; kept out of the repo because it goes public. Tony enters it himself on Nov 14.
- **Team size:** 1
- **NEAR wallet address (payout):** `Tony's prize account` (Meteor Wallet, created by Tony Oct 27; agents never touch it)
- **Tracks:** `realworld`, `business`, `security`, `agents` (+ `privacy` and `swarms` only if their features exist on Nov 13)
- **Website field:** leave empty. HACKATHON.md says it is a spam honeypot and any value is rejected (research 19).
- **Description (draft, ≤2000 characters):**

> Small family manufacturers are being bought and folded into larger companies, and every deal hits the same wall: a plant that runs on paper batch records and hand-keyed ERP entries. Day One sends in Kevin, an AI purchasing and inventory assistant, on the day the deal closes.
>
> Kevin reads scanned batch records and checks them against the product formula, tracks every lot through quarantine and release across three facilities, flags when another plant's numbers don't match, forecasts what to reorder, collects quotes from supplier agents and drafts POs. Staff confirm his drafts and see only dollars and POs.
>
> Underneath, purchasing runs on NEAR testnet. A spend-policy contract holds the plant budget and enforces Kevin's limits: an over-limit PO is refused by the chain, not by our database. The ops director's "YES" text becomes a transaction signed by the director's own account and paid for by a relayer, so staff hold no tokens. Funds sit in a PO escrow and go to the supplier's account in a stablecoin when QC releases the lot. Fingerprints of batch records and lot movements are anchored on-chain so history can't be quietly edited, while formulas and prices stay off-chain.
>
> Kevin's function-call key can only ask. The contract decides. Every person and agent is a NEAR account in the acquirer's account tree; suppliers are their own accounts outside it.
>
> The repo runs the whole loop from a clean clone with no keys in replay mode, using recorded testnet transactions with explorer links. Contract tests cover refusals, approvals, escrow and anchoring. All company data is fictional.
