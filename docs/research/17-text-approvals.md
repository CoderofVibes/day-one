# 17. "Text" approvals (phone-style SMS UI → relayer-paid director transaction)

**Question:** How should the ops director's "YES" work in the demo? It is an in-app, phone-style SMS UI whose reply triggers a relayer-paid, signed transaction from the director's account. Should we simulate SMS or use real SMS (e.g. Twilio), what would real SMS cost and need, and which UI patterns make the phone mock convincing?

**Answer:** Simulate the SMS in-app. Do not send real SMS. The phone mock posts the director's reply to `POST /api/sms/inbound` with the same shape as a Twilio inbound webhook (`From`, `Body`). The server parses `YES <PO number>`, builds `approve_po(po_id, supplier, amount, category, po_hash)` on the spend-policy contract, signs it as a NEP-366 delegate action with the director's server-held function-call key, and submits it through our in-process relayer (task 6). The director's account is the predecessor, and the relayer pays gas. Real SMS would cost pennies per message, but in the US it needs A2P 10DLC (or toll-free) registration that takes days and blocks unregistered traffic. It also needs a public webhook URL and API secrets. All of that breaks "clean clone, one command, no secrets", so it belongs on the roadmap. The demo's money shot is the curtain view showing that a text message became a NEAR transaction Kevin could not send himself.

**Confidence:** high on the recommendation and the transaction path (consistent with tasks 3, 4 and 6, which verified the NEP-366, predecessor and FC-key details). Medium on exact Twilio fees: the pricing page was read today, but 10DLC registration fees come from Twilio support pages and third-party summaries that differ slightly.

**Decision recommended:** Build `web/src/phone/` as a CSS-only phone frame with a messages thread and reply chips. Build `server/sms/` with one inbound handler that is Twilio-compatible in shape but local-only. Require the reply to name the PO ("YES 1042"), so a stray "yes" can never approve the wrong PO. List "real SMS via Twilio (A2P 10DLC registered)" as a roadmap item in the README with the cost line below.

## Details

### End-to-end flow (consistent with research 04 and 06)

1. Kevin calls `spend-policy.submit_po(...)` for PO-1042 at $8,400. The contract **panics** (over Kevin's per-PO limit). The failed tx hash goes into `chain_tx` with `status = refused` (task 18).
2. The server creates an `approvals` row (`state = requested`, `po_id`, `po_hash`, `refused_tx_hash`) and pushes an outbound "SMS" to the phone mock over SSE/WebSocket:
   > **Day One · Kevin (AI assistant):** PO-1042 needs your OK. $8,400.00 to Northbeam Excipients for MCC 25 kg × 12. Over Kevin's $5,000 limit. Reply **YES 1042** to approve or **NO 1042** to decline.
3. The director taps the **YES 1042** chip, or types it. The phone posts `{"From": "+1 555 0142", "Body": "YES 1042"}` to `/api/sms/inbound`.
4. The server validates three things: the sender is the director's registered number, the PO number matches an open approval, and the approval has not expired. It then calls `relayer.approve(directorAccount, approve_po(...))`:
   - `createSignedMetaTransaction` with the director's FC key, scoped to `spend-policy` and method `approve_po` only.
   - `relayMetaTransaction` from `dayone-relayer.testnet`.
5. The contract checks `predecessor_account_id() == director` and stores the one-time approval. Kevin's identical retry of `submit_po` succeeds, and the contract funds escrow via `ft_transfer_call`.
6. The phone receives: "Approved. PO-1042 is funded and will pay Northbeam on receipt + QC release." The staff UI shows "PO-1042 — approved by Dana (ops director)". **No hashes appear on the phone.** The curtain view shows the three transactions **red → green → green** with explorer links.

### Why the reply must name the PO

Real approve-by-text systems (bank fraud alerts, two-factor flows) use a code or reference in the reply so an answer can only match one request. "YES 1042" binds the reply to one PO. A bare "YES" with several open approvals would be ambiguous, and an AI judge reading the handler will notice. Also accept "Y 1042" and "yes 1042", and reply with a help text on anything else ("Reply YES 1042 or NO 1042").

### Key custody: be honest in the README

The director's function-call key is held by the server in the demo, because the phone is simulated. A production design would keep the director's key on their own device, for example a passkey-backed wallet or a NEAR social-login wallet signing the delegate action, with only the relayer server-side (task 7). README line: *"In the demo the director's approval key lives on the server because the phone is simulated. It is still a separate key that can only call `approve_po`, and Kevin's keys cannot call it at all."* That keeps the security story intact: the agent cannot approve itself.

### Replay mode (no secrets)

In replay mode the inbound handler skips signing and returns the recorded approval tx hash from `data/replay/*.json`. The phone UI is identical. The curtain view labels these transactions "recorded on testnet (replay)" next to the explorer links.

### Phone mock: UI patterns that read as real in a video

- **Frame:** a CSS-only device about 390×844 CSS px with 48 px corner radius, a 10 px dark bezel, a pill-shaped camera cutout, and a status bar showing time, signal, Wi-Fi and battery glyphs (inline SVG). Make it a generic phone, not a pixel copy of iOS (no Apple glyphs, no "iMessage" label). Avoid any trademark look-alike.
- **Placement:** in the demo layout the phone sits docked at the right edge of the purchaser's screen at about 80% scale. It slides in from the bottom when a text arrives, then drops back. In the video, a 1.5 s zoom on the phone makes the beat legible.
- **Lock-screen banner first:** a notification banner ("Day One · Kevin: PO-1042 needs your OK") slides down over a lock screen with a blurred wallpaper. A tap opens the thread. This is the single most recognisable "it's a text" cue.
- **Thread:** incoming bubbles are light grey and left-aligned; outgoing bubbles are brand-blue and right-aligned. Add a timestamp separator ("Today 9:41 AM"), a "Delivered" label under the last outgoing bubble, and a three-dot typing indicator for about 800 ms before Kevin's follow-up.
- **Sender identity:** a contact name "Day One (Kevin)" with an "AI assistant" subtitle, per the brief's "clearly labeled as AI" rule. The number uses the NANPA fictional range 555-0100–0199.
- **Reply chips:** quick-reply chips "YES 1042", "NO 1042" and "Call me" above a fake keyboard. In the video, the tap on the YES chip should be big and slow.
- **Physicality:** a 150 ms shake/haptic animation on arrival and a subtle send "whoosh" (no audio needed). Respect `prefers-reduced-motion`.
- **Do not show crypto on the phone.** There are no hashes, wallets or gas there. The proof lives in the curtain view, and the edit cuts to it right after the YES.
- **Libraries:** none needed (about 150 lines of CSS/JSX). Device-frame packages exist but add dependencies for something trivial.

### Real SMS: what it would cost and need (roadmap only)

| Item | Twilio US (read 2026-10-22) |
|---|---|
| Outbound / inbound SMS (long code, 10DLC) | $0.0083 per segment each way |
| Carrier pass-through fees (outbound) | ~$0.0035–$0.005 per segment depending on carrier |
| Phone number | $1.15/month |
| A2P 10DLC brand registration | one-time; about $4 (sole proprietor) up to ~$46 (standard brand incl. secondary vetting), per Twilio support pages |
| Campaign vetting + monthly campaign fee | ~$15 one-time vetting; ~$1.50–$10/month depending on campaign type |
| Lead time | Registration review takes days to weeks; **unregistered 10DLC traffic is blocked** (error 30034) |
| Also required | a public HTTPS webhook (tunnel or cloud host), `TWILIO_AUTH_TOKEN` + signature validation, a real phone, opt-in/STOP handling |

**Why roadmap:** the money cost is trivial (under $25 to stand up), but registration lead time and secrets are not. A judge's clean clone cannot receive an SMS, so the simulated phone is what every judge experiences anyway. Because the inbound handler already speaks Twilio's webhook shape, "real SMS" in the roadmap is honestly "point a registered number's webhook at `/api/sms/inbound` and add signature validation".

## Open questions for the human

- Director's fictional name and title for the UI (placeholder "Dana Ruiz, Ops Director"). It must be invented.
- Should the video include a 3-second shot of a real phone? Recommendation: no. The simulated phone plus the curtain view is clearer and avoids any real number appearing on screen.

## Sources

- https://www.twilio.com/en-us/sms/pricing/us — $0.0083/segment in and out, $1.15/month number, carrier fees by carrier, "subject to registration onboarding fees", pricing current as of Oct 2026 (accessed 2026-10-22)
- https://support.twilio.com/hc/en-us/articles/1260803965530 — A2P 10DLC brand/campaign fee figures ($46 standard brand incl. secondary vetting, $15 campaign vetting, monthly campaign fees), as summarised by search (accessed 2026-10-22)
- https://pages.twilio.com/10DLC-HelpArticles-WW — unregistered messages fail with error 30034 (accessed 2026-10-22)
- https://telnyx.com/resources/what-is-10dlc.md — unregistered 10DLC traffic blocked since 2025-02-03 (accessed 2026-10-22)
- https://www.bandwidth.com/blog/how-to-register-with-10dlc-to-avoid-unnecessary-costs-in-2022/ — corroborating brand vetting (~$41.50) and $10 campaign fees, updated Feb 2026 (accessed 2026-10-22)
- `docs/research/04-spend-policy-design.md`, `docs/research/06-relayers-meta-tx.md`, `docs/research/03-function-call-keys.md` — `approve_po` signature, predecessor check, in-process relayer with near-api-js 7.3.1, FC keys cannot attach deposits (internal, 2026-10-22)
