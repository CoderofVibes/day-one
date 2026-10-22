# Product specification — Day One

**Day One** is an AI purchasing and inventory assistant, **Kevin**, that an acquiring company deploys to onboard a newly acquired small manufacturing plant. Kevin does the purchaser's manual work and runs purchasing on NEAR: spending limits enforced by a contract, POs escrowed in a stablecoin, settlement on delivery, and tamper-evident record fingerprints. Plant staff never see wallets, tokens or gas.

Related: `PROJECT_BRIEF.md` (why), `FICTIONAL_DATA.md` (the world), `ARCHITECTURE.md` (how), `CONTRACTS.md` (on-chain rules), `DEMO_SCRIPT.md` (the deterministic run).

---

## 1. Personas

| Persona | Who | What they want | What they must never see |
|---|---|---|---|
| **Purchaser** — Ray Delgado, Plant B | 10 years at the plant. Keys batch records into the ERP by hand, tracks lots to the gram, chases suppliers. | Stop retyping. Trust the numbers. Know what to order before it's urgent. | Wallets, tokens, gas, seed phrases |
| **Ops director** — Linda Park, Plant B | Approves big spends. Lives on her phone. | Approve or decline in one tap, with enough context to decide. | Same |
| **Receiving** — Tommy Reyes | Unloads trucks, checks packing slips. | Take a photo, done. | Same |
| **QC** — Priya Natarajan | Releases lots from quarantine after testing. | One button per lot; nothing ships or gets paid until she says so. | Same |
| **Accounting** — Marcy Allen | Matches invoices to POs and receipts. | Invoices already matched and paid, with a record she can show an auditor. | Same |
| **HQ integration lead** — Jordan Pike, Acme | Owns the post-acquisition integration. | Set Kevin's limits once; see every plant's status; trust the limits hold. | (May see the chain view) |
| **Judge** | Human or AI judge of the hackathon | See exactly what is on NEAR and verify it. | — |

**Kevin** is always labeled as an AI assistant. He speaks plant (POs, lots, lead times, net-30), drafts before he acts, and asks when unsure.

---

## 2. Core loop — user stories and acceptance criteria

Each step must pass its acceptance criteria in both **live mode** (testnet) and **replay mode** (recorded testnet transactions, no secrets).

### Step 1 — Batch record in
*As Ray, I upload a photo or PDF of a batch record so that I never key it into the ERP again.*

- Given BR-B-1045 (scanned-looking PDF), when Ray uploads it, Kevin returns a draft within 30 seconds listing every material, lot, quantity and unit, theoretical and actual yield, and waste.
- Every extracted field has a confidence level. Fields below threshold are highlighted and Kevin asks about them in plain words.
- Kevin validates each material against the product formula: quantities outside ±0.5% of target are flagged.
- Units are normalized to inventory units (g → kg) and the conversion is visible on hover.
- Inventory does **not** change until Ray confirms the draft.
- On confirm: lots are decremented, genealogy (batch ↔ input lots) is recorded, waste is recorded, and the record's fingerprint is queued for anchoring.
- BR-B-1043 (handwritten correction) yields the corrected value. BR-B-1046 (smudged) yields a low-confidence prompt.

### Step 2 — Lot lifecycle
*As Ray, I see each lot's state so I know what I can actually use.*

- Every lot is in exactly one state: `on_order → en_route → received → quarantine → released → in_use → consumed | wasted`.
- Only allowed transitions are possible; an invalid transition is rejected with a reason.
- Every transition is an event with who, when, and why; events are fingerprinted.
- Quarantined lots are not counted as available inventory and are visually distinct everywhere.
- Lot genealogy view: for any finished batch, list the input lots; for any input lot, list the batches it went into.

### Step 3 — Three facilities, one truth
*As Ray, I see shared inventory across Plants A, B and C and get told when another plant's numbers don't match mine.*

- Inventory views can filter by plant or show all three.
- Transfers between plants are first-class events with sent quantity, received quantity, and status.
- When received ≠ sent beyond tolerance, Kevin raises a discrepancy with both numbers and a proposed adjustment.
- The seeded `ASC-261009-01` discrepancy (200.000 kg sent vs 187.450 kg received, 12.550 kg phantom at Plant A) is detected when BR-B-1045 consumes the lot.
- Adjustments are proposed, not applied, until a human accepts them.

### Step 4 — Reorder
*As Ray, Kevin tells me what to order before I run out, and gets quotes from approved vendors.*

- Kevin forecasts need from actual usage and yield variance over the planning horizon (default 10 days), not from formula alone.
- When projected on-hand falls below the reorder point, Kevin proposes a reorder with quantity and reasoning.
- Kevin sends a request for quote to every supplier agent that supplies the material.
- Supplier agents respond with price, lead time and terms. Each response is a message from an agent with its own NEAR account.
- Kevin ranks quotes and **excludes unqualified vendors** with a stated reason, even when cheapest (QuickChem Direct).
- Kevin drafts the PO with lines, total, vendor and need-by date, and explains his choice in one or two sentences.

### Step 5 — Approval
*As Linda, I approve big POs from my phone with a "YES"; as Jordan, I know Kevin cannot spend past the limit no matter what.*

- Under the per-PO limit and within the monthly category cap: the PO is approved automatically by the contract.
- Over the limit: Kevin's attempt is **refused by the spend-policy contract**. The refusal is a visible on-chain result, not an off-chain check.
- Linda receives a phone-style message: vendor, material, quantity, total, why, and "Reply YES 1042 or NO 1042". A reply that does not name the PO is ignored with a prompt to resend.
- Linda's YES becomes a transaction signed with Linda's own key and paid for by the relayer. Kevin cannot produce it.
- After approval the PO proceeds; the approval is visible in the behind-the-curtain view with an explorer link.
- Unqualified vendors have no approval path. Conditional vendors always require approval.
- A NO or no reply leaves the PO pending; Kevin tells Ray.

### Step 6 — Settlement
*As Marcy, the invoice is matched and paid without me chasing anyone; as the supplier agent, I'm paid the moment the goods are accepted.*

- On approval, PO funds move into escrow in the stablecoin.
- Tommy photographs the packing slip; Kevin matches it to the PO (vendor, material, quantity, supplier lot). Mismatches are flagged.
- Receipt moves the lot to `quarantine`. Priya's QC release moves it to `released` and triggers escrow release to the supplier agent's account.
- If QC rejects the lot, escrow is refunded and the lot becomes `wasted` (returned to vendor).
- Staff see "PO-1042 — paid $5,150.00". The behind-the-curtain view shows the escrow and release transactions.

### Step 7 — Records
*As Marcy and Jordan, we can prove a record wasn't changed after the fact.*

- Fingerprints (hashes) of confirmed batch records, lot events, approvals and receipts are anchored on NEAR.
- Contents stay off-chain. Nothing on-chain reveals prices, formulas or supplier lots beyond what settlement requires.
- A "verify" action recomputes a record's fingerprint and shows the matching on-chain anchor with an explorer link.
- Changing any byte of a stored record makes verify fail visibly.

### Step 8 — Plant map and behind the curtain
*As Jordan and as a judge, I see plants come online and every NEAR action behind them.*

- Three plants; Plant B's departments start grey and light up the first time Kevin processes a record for them.
- Material and money flows animate between plants, suppliers and escrow; quarantined lots are visually distinct.
- A toggle switches to **behind the curtain**: accounts (as an account tree), function-call keys and what they allow, current limits, and a chronological transaction log including refused attempts, each with an explorer link.
- The same log is printed as text by the demo script for readers who cannot see the UI.

---

## 3. Track-fit matrix

Tag a track only if its row is true on Nov 13.

| Track | Feature that earns the tag | Artifact a judge sees | Tier |
|---|---|---|---|
| `realworld` | Stablecoin settlement of real-business POs; relayer-paid staff actions | Escrow and release transactions; staff UI showing only dollars | 0 |
| `business` | Procurement run by an agent within constraints set by humans | Policy settings in HQ view; auto-approve under limit; contract-enforced limits | 0 |
| `security` | Spend limits enforced on-chain; function-call keys scoping the agent | A refused over-limit transaction on the explorer; Kevin's key permissions listed | 0 |
| `agents` | Kevin and supplier agents with their own accounts transacting | RFQ, quote, escrow and payment between agent accounts | 1 |
| `privacy` | Kevin's inference runs in an attested TEE on NEAR AI Cloud; only fingerprints on-chain | Attestation panel behind the curtain; on-chain/off-chain table | 1 |
| `swarms` | Supplier agents bid on pooled volume across three plants | One pooled PO, several bids, allocation across plants | 2 |

---

## 4. Non-functional requirements

- **Runs from a clean clone** with one install command and one demo command, no secrets, in replay mode.
- **Live mode** needs only the variables in `.env.example`.
- **Deterministic demo:** seeded data, fixed clock option, recorded LLM responses available in replay mode.
- **Plain language:** no staff-facing screen contains the words wallet, token, gas, key, NEAR, blockchain or transaction. The behind-the-curtain view is the only exception.
- **Accessible text:** every animated view has a text equivalent.
- **Honest labels:** testnet, fictional data, and simulated suppliers are labeled in the README and the behind-the-curtain view.

---

## 5. Out of scope

Rebuilding an ERP; real ERP, email, chat or SMS integrations; real suppliers; mainnet operation; compliance claims; multiple document types beyond batch records and packing slips. These appear as roadmap in the README.
