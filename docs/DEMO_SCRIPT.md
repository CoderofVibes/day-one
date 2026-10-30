# Demo script — deterministic run

One script drives the whole core loop from seed data. It runs in **replay** mode by default, with no secrets and no accounts, using recorded testnet transactions and recorded LLM responses. The same script in **live** mode runs against testnet and NEAR AI Cloud and is how the fixtures are recorded.

Related: `SPEC.md` (acceptance criteria), `FICTIONAL_DATA.md` (numbers), `DATA_MODEL.md` §9 (fixtures), `DEMO_STORYBOARD.md` (the video).

---

## 1. Commands (targets; added to AGENTS.md only once they work)

| Command | Mode | Needs |
|---|---|---|
| `npm ci` | — | Node 24 LTS |
| `npm run demo` | replay | nothing |
| `npm run demo -- --ui` | replay | nothing; also serves the web UI on localhost and steps through the same run |
| `npm run demo:live` | live | `.env` from `.env.example`, testnet accounts, funded budget |
| `npm run verify -- <record>` | verify | network (public RPC) |
| `npm test` | — | nothing (server and ledger tests) |
| `npm run test:contracts` | — | Linux, macOS or WSL2 with Rust (NEAR sandbox has no Windows binary) |
| `npm run reset:testnet -- --yes` | live | `.near-credentials`, Acme's keychain key; cancels open POs, returns the budget to the treasury and deletes the contract account (its anchors go with it); no flag = dry run |

---

## 2. Steps and expected output

The demo clock starts at `2026-11-09T13:00:00Z`. Each step prints a plain-language line for staff and an indented `chain:` line for the behind-the-curtain view. Expected text below is the contract; the transcript in `data/replay/transcript.txt` must match it.

| # | Step | Expected staff-facing output | Expected chain output |
|---|---|---|---|
| 0 | Load seed | `Loaded 3 facilities, 54 materials, 18 vendors, 7 batch records, 118 days of history.` (days since the first seeded batch, Jul 14; FICTIONAL_DATA §17) | `chain: spend-policy budget 25,000.00 DTUSD, escrowed 0.00 DTUSD` |
| 1 | Upload BR-B-1045 | `Kevin read BR-B-1045 (VC500, 800,000 tablets). 8 materials, all within tolerance. Yield 90.8%.` | — |
| 2 | Ray confirms | `Inventory updated. Ascorbic acid at Plant B: 722.4 kg → 310.0 kg (reorder point 500 kg).` | `chain: anchored BR-B-1045 0x… (tx …)` |
| 3 | Discrepancy | `Plant A still shows 12.55 kg of lot ASC-261009-01, but Plant B weighed in 187.45 kg of the 200 kg sent. Proposed adjustment sent to Plant A for review.` | — |
| 4 | Forecast | `Two more VC500 batches in the next 10 days need about 824 kg. Short about 514 kg. Recommend ordering 700 kg.` | — |
| 5 | Quotes | `3 quotes. QuickChem Direct $5.90/kg excluded: vendor not qualified. Northgate $7.10/kg, 7 days — selected. Ridgeway $7.35/kg, 5 days — runner-up.` | `chain: anchor quote RFQ-2611-01 ✗ REFUSED "Only a registered purchasing agent or an approved supplier can anchor records." (tx …)` for QuickChem, then `chain: anchor quote RFQ-2611-01 ✓ signed by northgate-ingredients.testnet (tx …)` and the same for Ridgeway (supplier agents, Oct 28; in the recording from the next `demo:live -- --record`) |
| 6 | Small PO | `PO-1041 to Bayfront Lab Supply, $612.00 — approved automatically and funded.` | `chain: submit_po PO-1041 ✓ (tx …) · escrow funded 612.00 DTUSD` |
| 7 | Big PO | `PO-1042 to Northgate Ingredients, $5,150.00 is over Kevin's $2,500.00 limit. Sent to Linda for approval.` | `chain: submit_po PO-1042 ✗ REFUSED "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required" (tx …)` |
| 8 | Linda texts | `Linda: YES 1042` → `Approved by Linda Park.` | `chain: approve_po PO-1042 ✓ signed by director.plant-b…, paid by dayone-relayer.testnet (tx …)` |
| 9 | Kevin retries | `PO-1042 sent to Northgate Ingredients. Funds held until delivery passes QC.` | `chain: submit_po PO-1042 ✓ (tx …) · escrow funded 5,150.00 DTUSD` |
| 9b | Supplier ships | — | `chain: accept_po PO-1042 ✓ signed by northgate-ingredients.testnet (tx …)`, then `mark_shipped` the same way |
| 10 | Delivery | `Tommy photographed the packing slip. Matches PO-1042: 700 kg ascorbic acid, supplier lot NG-24-8812. Lot ASC-261116-01 is in quarantine.` | `chain: confirm_receipt PO-1042 ✓ signed by receiving.plant-b…, relayed (tx …)` |
| 11 | QC release | `Priya released lot ASC-261116-01.` | `chain: qc_release PO-1042 ✓ (tx …) · 5,150.00 DTUSD → northgate-ingredients.testnet` |
| 12 | Paid | `PO-1042 — paid $5,150.00. Invoice matched to PO and receipt.` | `chain: anchored receipt PO-1042 0x… (tx …)` |
| 13 | Real USDC proof (separate run: `npm run usdc`, recorded Oct 29) | `PO-1047 (pH buffer ×2, $19.00) settled in Circle USDC.` | `chain: full cycle on the USDC deployment, 19.00 USDC → bayfront-labsupply.testnet (txs …)` |
| 14 | Summary | `Plant B: 6 of 9 departments online.` | `chain: 10 transactions, 1 refused by design, 0 failed.` (11 with step 13), then the explorer links |

**Video-only beat (storyboard "New bank details", Oct 29; OPEN_QUESTIONS #41):** between steps 10 and 11 the video page shows a second Northgate invoice for PO-1042 asking for payment to `northgate-remit.testnet`, and Kevin holding it for Marcy. It is the attack suite's recorded hidden-text invoice (`data/attacks/invoices.json`, replayed by `npm run test:attacks`), not a step of this run: it prints nothing in the transcript and sends nothing to the contract, which is the point. Step 11's payout then goes to `northgate-ingredients.testnet`, the account fixed on the funded PO.

Exact numbers come from `FICTIONAL_DATA.md` and must be recomputed by code, not hard-coded in the script. The replay test asserts that the printed transcript equals the committed one.

If the human chooses real USDC for the main demo (OPEN_QUESTIONS), every `DTUSD` above becomes `USDC` and step 13 is dropped.

---

## 3. README quickstart (≤5 steps)

These are the steps the README shows. Each has its expected output inline so a judge who does not run code can still compare.

1. **Install:** `npm ci` → installs with no install scripts, no secrets.
2. **Run the demo:** `npm run demo` → the transcript above, ending with `11 transactions, 1 refused by design`. Every tx hash links to testnet.nearblocks.io.
3. **Verify a record on-chain:** `npm run verify -- data/batch-records/BR-B-1045.json` → `MATCH` with the anchoring tx link.
4. **Tamper with it:** change one quantity by 1 g in that file and run step 3 again → `MISMATCH`.
5. **Run the contract tests:** `npm run test:contracts` (Linux, macOS or WSL2) → all tests pass, including `over_limit_po_is_refused` and `director_approval_then_retry_succeeds`.

---

## 4. Live recording procedure (Nov 7, re-run Nov 12)

1. `npm run reset:testnet -- --yes`, `npm run setup:testnet`, `npm run deploy:testnet`, `npm run rehearse`, then `npm run demo:live -- --record`.
2. The script writes `data/replay/chain/*.json`, `data/replay/llm/*.json`, `data/replay/attestation/report.json` and `data/replay/transcript.txt`.
3. Commit the fixtures. Run `npm run demo` (replay) and confirm the transcript is identical apart from fields marked volatile (none should be).
4. Spot-check three tx hashes on testnet.nearblocks.io: the refused `submit_po`, the relayed `approve_po`, the `qc_release` payout.
