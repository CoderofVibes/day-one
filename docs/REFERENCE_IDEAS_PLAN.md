# Plan: what to take from other builds (Nov 3)

**Inputs.** Grok's notes (Nov 3, "reference ideas from other NEAR HACKATHON builds") and its build tracker (Nov 2 sweep, 131 builds, 15 with medium or high overlap). Both came to Claude from Tony in chat on Nov 3. This plan reads only those two notes. No rival repository's code, contracts, tests, prompts or UI were opened, and none will be: every item below is designed from Day One's own data model and written from scratch (Grok's rule 1, a clean-room build).

**Status:** proposal. Nothing here is in `PLAN.md` until Tony picks it (OPEN_QUESTIONS #50).

## 1. What the notes get wrong about Day One

The tracker treats several things as gaps that Day One already ships. Building them again would waste days:

| Grok's idea | Already in the repo |
|---|---|
| CI that runs tests and the demo | `.github/workflows/ci.yml`: `npm run check`, `demo`, `test:attacks`, `usdc`, `web:data -- --check`, and the contract's clippy, unit and sandbox tests |
| One command from a clean clone with no secrets | `npm run clean-clone` (Windows) and `scripts/clean-clone.sh` (Linux): every keyless README step, `failures: 0` |
| Scripted attack suite with checked verdicts | `npm run test:attacks`: 15 attacks, each with its testnet transaction or recorded answer, PASS asserted, `--json` |
| Sealed supplier quotes | Commit-and-reveal sealed rounds recorded on testnet (`npm run sealed`, `verify:round`, CONTRACTS §10) |
| Supplier registry | Supplier credentials issued, revoked, expired and suspended by HQ, enforced in the contract (four recorded attacks) |
| TEE-attested AI | Every answer Kevin gives is signed in NEAR AI Cloud's enclave; `npm run attest` checks 15 enclave items, Intel's collateral and NVIDIA's verdict |
| Pre-window disclosure | `pre-hackathon` tag, README "Hackathon window and baseline" |

The tracker is right on three gaps: the repo has no **reviewer entry point** (and the builder's `CLAUDE.md` would mislead a judge's agent), the **contract does not know what arrived or what was invoiced** (the ERP's three-way match is not a payment condition, OPEN_QUESTIONS #48), and the **attested answers are checked off chain only**. It is also right that nobody else has inventory, lots, recall, ERP data, history or a plant twin: every item below feeds those.

## 2. The plan, in build order

Each item starts with the line Grok asked for: how Day One's version differs. Effort is in sessions at the repo's real pace.

### A. Reviewer front door (1 session, no contract change)

*Differs:* it proves a plant's purchasing loop end to end (stock → PO → limit → approval → escrow → receipt → QC → payment → lot), not a spending firewall.

- **A judge's agent gets its own page.** Today a judge's Claude Code opening the public repo reads `CLAUDE.md`, which tells it to continue our build plan. Add a short "Reviewing Day One?" block at the top of `AGENTS.md` and `CLAUDE.md` that sends reviewers to the README, `PROOF.md` and one command, and a root `llms.txt` written for reviewers in our own words.
- **`npm run prove`**: one keyless, network-free command (about two minutes) that runs `check`, `demo`, `test:attacks`, `sealed`, `usdc`, `demo:group`, `verify` on a record plus a tampered copy, `verify:attestation -- --offline`, `erp:reconcile` and `web:data -- --check`, then prints a Markdown scorecard (one line per claim, PASS or FAIL) and `--json`. CI runs it. It writes nothing.

### B. `PROOF.md`, generated (half a session, no contract change)

*Differs:* each row is one of Kevin's plant moments, and a last column says what the row does not prove.

- A script writes `PROOF.md` from the recorded fixtures: claim → code file → test name → testnet transaction with explorer link. `--check` fails CI when it is stale; `--live` re-reads every transaction from testnet RPC.

### C. Lot passports: recall you can verify (2 sessions, no contract change)

*Differs:* nobody else tracks lots. One proof covers the material's whole life and the money that paid for it.

- Each working day Kevin anchors one Merkle root over that day's records (receipts, QC decisions, batch records, settlement references) with the contract's existing `anchor_batch`. This builds the README's "Merkle-batched anchors" roadmap item.
- For any lot, a **lot passport** lists the supplier, the PO, the escrow payment, the receipt, the QC decision, every batch that used it and every finished lot it went into. Each entry carries its Merkle path.
- The browser checks each path against the root on chain with a read-only view call, with no keys. On the Lots & recall page, "Prove it" marks each entry green; a "tamper one field" toggle turns it red. A `verify:lot` command does the same check from the command line.
- One live testnet run anchors the roots; replay needs nothing.

### D. Inventory-grounded attacks 16–18 (1 session plus one testnet recording)

*Differs:* only an agent that knows the plant's stock, lots and recalls can be attacked this way.

- **Over-order.** A message asks Kevin for ten times what the forecast needs. Kevin's plan refuses, and the category cap would stop it anyway (the contract's refusal is recorded).
- **Reorder from a supplier under recall.** Kevin blocks it, and the contract refuses the PO because the supplier's credential is suspended.
- **Wrong hands.** The QC lead confirms a delivery that is the receiving lead's to confirm, and a QC release is sent before anything was received. The contract refuses both (role and status errors recorded on testnet). Kevin's own key cannot even try: its method list has no receipt or release call (`near account list-keys`).
- These join the arena and the tour. Attack 19 (short shipment invoiced in full) waits for E.

### E. Pay for what reached stock: receipt-bound settlement (3–4 sessions, contract change, needs Tony)

*Differs from a PO-to-invoice matcher:* the match is driven by what the plant counted into stock. A short delivery settles part of the order and refunds the rest, and the lot is written on the payment.

- `confirm_receipt` takes the received quantity, the receipt record's hash and its lot ids. A new `record_invoice` (Kevin's key) takes the invoice's hash and amount.
- `qc_release` pays the smallest of three amounts: the invoice, the agreed unit price times the accepted quantity, and the escrow. The rest goes back to the plant's budget. An invoice above that amount holds the payout with a reason for HQ.
- Lot ids on the receipt link the payment to C's lot passports, so a recall shows which payment bought the lot.
- This reverses the scope line in OPEN_QUESTIONS #48 ("the ERP match is not a payment condition"). The ERP stays the books. The contract enforces the quantity and amount rule itself; it never calls the ERP.

### F. Enclave-signed buy decisions, checked by the contract (half-session spike, then 2 sessions, contract change, needs Tony)

*Differs:* the signed decision is a reorder computed from stock and forecast. It sits beside the spending policy instead of replacing it, and the curtain shows it on the PO.

- Research 10 found that each answer's signature is ECDSA secp256k1 (EIP-191) over `<model>:<sha256 request>:<sha256 response>`. NEAR contracts can recover that signer with `env::ecrecover`.
- HQ registers the attested signing address after `npm run attest` verifies the enclave (an owner-only call). `submit_po` can then carry the decision proof. The contract recovers the signer, checks it is registered, and checks that the PO's fields are what the signed answer decided. A per-plant policy flag sets "signed decision required above $X".
- **Spike first:** is the signing address stable across the model's replicas? Can the request and response hashes be rebuilt exactly? Does verification fit in the gas budget? If any answer is no, keep verification off chain and say so in the README.

### G. Sealed rounds ranked on the plant's own history (half a session, optional)

*Differs:* Kevin ranks suppliers on the plant's twelve months of receiving: on-time rate and QC rejects. The award reason names both.

## 3. Not doing

- **Intents 1Click supplier payouts.** There is no testnet (research 02: `intents.testnet` has no code), so a payout would mean mainnet and Tony's funded account (hard rule 1). It stays on the roadmap.
- **Copying another build's mechanics** (second-price auctions, DAO votes, letters of credit). They would make Day One look like a clone and pull it off its strengths.

## 4. Timing (11 days to Nov 14)

1. **Nov 3–5:** A, B, then C. No contract change and no re-record.
2. **Nov 5–6:** D (attacks 16–18), one testnet recording.
3. **If Tony says yes to E and F:** the F spike first, then E and F in **one contract version**, built and tested by Nov 8. One reset, redeploy and full re-record by Nov 10, folded into the final re-record `PLAN.md` already plans, plus attack 19. This leaves Nov 11–13 for the README, the video take and the freeze.
4. G only if a day is free.

**Risk.** The redeploy changes every recorded transaction and README link. It was done in one session on Oct 29 with `reset:testnet` → `setup:testnet` → `deploy:testnet` → re-record. If E or F slips past Nov 8, ship A–D and leave E and F as a roadmap item. Do not redeploy late.

## 5. Credit

E's idea of enforcing the match in a contract, and F's idea of checking an enclave signature on chain, appear in other public builds. If either ships, a one-line "inspired by public hackathon work" note goes in the README's related-work section, and no competitor is named in the demo or the pitch (Grok's rule 5). This file is a planning note and moves to `docs/phase0/` at the freeze.
