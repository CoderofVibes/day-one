# Demo script — deterministic run

One script drives the whole core loop from seed data. It runs in **replay** mode by default, with no secrets and no accounts, using recorded testnet transactions and recorded model responses. The same script in **live** mode runs against testnet and NEAR AI Cloud and is how the fixtures are recorded (last recorded Oct 29, after the testnet redeploy).

Related: `SPEC.md` (acceptance criteria), `FICTIONAL_DATA.md` (numbers), `DATA_MODEL.md` §9 (fixtures), `DEMO_STORYBOARD.md` (the video), `AGENTS.md` (every command with the day it was verified).

---

## 1. Commands

| Command | Mode | Needs |
|---|---|---|
| `npm ci` | — | Node 24 (`.nvmrc`) |
| `npm run demo` (`-- --json`) | replay | nothing; ends with `Transcript matches data/replay/transcript.txt.` |
| `npm run web:build`, then open `web/dist/` from any static server | replay | nothing; the same run step by step in the browser, with the plant map, the 3D twin and the behind-the-curtain view |
| `npm run api` | replay | nothing; serves the built UI at `http://localhost:8787/` running live, one staff action at a time, with the three-plant view, the books and the watched folder |
| `npm run demo:live` (`-- --record` rewrites the fixtures) | live | `.env` from `.env.example`, keys in `.near-credentials/`, PO-1041 and PO-1042 unused on the contract |
| `npm run verify -- <record.json>` | verify | network (public RPC), no keys |
| `npm run check` | — | nothing (Biome, `tsc -b`, Vitest) |
| `cd contracts && cargo test` | — | Linux, macOS or WSL2 with Rust and cargo-near (the NEAR sandbox has no Windows binary) |
| `npm run reset:testnet -- --yes` | live | `.near-credentials`, Acme's keychain key; cancels open POs, returns the budget to the treasury and deletes the contract account (its anchors go with it); no flag = dry run |

The group purchase (`npm run demo:group`), the sealed round (`npm run sealed`), the attack suite (`npm run test:attacks`), the USDC order (`npm run usdc`) and the watched folder (`npm run inbox`) are separate recorded runs with their own commands in `AGENTS.md`.

---

## 2. Steps and expected output

The demo clock starts at `2026-11-09T13:00:00Z`. Each step prints a plain-language line for staff and an indented `chain:` line for the behind-the-curtain view. The text below is the contract; `data/replay/transcript.txt` holds the recorded run, and `npm run demo` fails when the replay no longer matches it.

| # | Step | Expected staff-facing output | Expected chain output |
|---|---|---|---|
| 0 | Load seed | `Loaded 3 facilities, 54 materials, 18 vendors, 7 batch records, 118 days of history.` (days since the first seeded batch, Jul 14; FICTIONAL_DATA §17) | `chain: spend-policy budget 25,000.00 DTUSD, escrowed 0.00 DTUSD` |
| 1 | Upload BR-B-1045 | `Kevin read BR-B-1045 (VC500, 800,000 tablets). 8 materials, all within tolerance. Yield 90.8%.` | — |
| 2 | Ray confirms | `Inventory updated. Ascorbic acid at Plant B: 722.4 kg → 310.0 kg (reorder point 500 kg).` | `chain: anchored BR-B-1045 0x… ✓ (tx …)` |
| 3 | Discrepancy | `Plant A still shows 12.55 kg of lot ASC-261009-01, but Plant B weighed in 187.45 kg of the 200 kg sent. Proposed adjustment sent to Plant A for review.` | — |
| 4 | Forecast | `Two more VC500 batches in the next 10 days need about 824 kg. Short about 514 kg. Recommend ordering 700 kg.` | — |
| 5 | Quotes | `3 quotes. QuickChem Direct $5.90/kg excluded: vendor not qualified. Northgate $7.10/kg, 7 days — selected. Ridgeway $7.35/kg, 5 days — runner-up.` | `chain: anchor quote RFQ-2611-01 ✗ REFUSED "Only a registered purchasing agent or an approved supplier can anchor records." (tx …)` for QuickChem, then `chain: anchor quote RFQ-2611-01 ✓ signed by northgate-ingredients.testnet (tx …)` and the same for Ridgeway (each supplier agent signs from its own account) |
| 6 | Small PO | `PO-1041 to Bayfront Lab Supply, $612.00 — approved automatically and funded.` | `chain: submit_po PO-1041 ✓ (tx …) · escrow funded 612.00 DTUSD` |
| 7 | Big PO | `PO-1042 to Northgate Ingredients, $5,150.00 is over Kevin's $2,500.00 limit. Sent to Linda for approval.` | `chain: submit_po PO-1042 ✗ REFUSED "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required." (tx …)` |
| 8 | Linda texts | `Linda: YES 1042 → Approved by Linda Park.` | `chain: approve_po PO-1042 ✓ signed by director.plant-b.acme-holdings.testnet, paid by dayone-relayer.testnet (tx …)` |
| 9 | Kevin retries | `PO-1042 sent to Northgate Ingredients. Funds held until delivery passes QC.` | `chain: submit_po PO-1042 ✓ (tx …) · escrow funded 5,150.00 DTUSD` |
| 9b | Supplier ships | — | `chain: accept_po PO-1042 ✓ signed by northgate-ingredients.testnet (tx …)`, then `mark_shipped` the same way |
| 10 | Delivery | `Tommy photographed the packing slip. Matches PO-1042: 700 kg ascorbic acid, supplier lot NG-24-8812. Lot ASC-261116-01 is in quarantine.` | `chain: confirm_receipt PO-1042 ✓ signed by receiving.plant-b.acme-holdings.testnet, paid by dayone-relayer.testnet (tx …)` |
| 11 | QC release | `Priya released lot ASC-261116-01.` | `chain: qc_release PO-1042 ✓ (tx …) · 5,150.00 DTUSD → northgate-ingredients.testnet` |
| 12 | Paid | `PO-1042 — paid $5,150.00. Invoice matched to PO and receipt.` | `chain: anchored receipt PO-1042 ✓ (tx …)` |
| 13 | Real USDC proof (separate run: `npm run usdc`, recorded Oct 29) | `PO-1047 (pH buffer ×2, $19.00) settled in Circle USDC.` | `chain: full cycle on the USDC deployment spend-policy-usdc.acme-holdings.testnet, 19.00 USDC → bayfront-labsupply.testnet (5 txs)` |
| 14 | Summary | The plant map ends at `Plant B: 6 of 9 departments online.` (the web UI, `web/src/twin/model.ts`; the transcript prints no staff line here) | `chain: 13 transactions, 2 refused by design, 0 failed.`, then `Explorer links:` and one testnet.nearblocks.io link per transaction, in order: `anchor_batch`, three `anchor` (the quotes), `submit_po` ×2, `approve_po`, `submit_po`, `accept_po`, `mark_shipped`, `confirm_receipt`, `qc_release`, `anchor_batch` |

**Video-only beat (storyboard "New bank details", Oct 29; OPEN_QUESTIONS #41):** between steps 10 and 11 the video page shows a second Northgate invoice for PO-1042 asking for payment to `northgate-remit.testnet`, and Kevin holding it for Marcy. It is the attack suite's recorded hidden-text invoice (`data/attacks/invoices.json`, replayed by `npm run test:attacks`), not a step of this run: it prints nothing in the transcript and sends nothing to the contract, which is the point. Step 11's payout then goes to `northgate-ingredients.testnet`, the account fixed on the funded PO.

Exact numbers come from `FICTIONAL_DATA.md` and are recomputed by code, not hard-coded in the script. The replay test asserts that the printed transcript equals the committed one.

The main run settles in DTUSD, our labeled test token, because the Circle testnet faucet gives 20 USDC per two hours (OPEN_QUESTIONS #4 and #22; README "Limitations"). Step 13 is the one order that settles in real Circle testnet USDC, on a second deployment of the same contract code.

---

## 3. README quickstart (≤5 steps)

These are the steps the README shows under "Try it". Each has its expected output inline so a judge who does not run code can still compare.

1. **Install:** `npm ci` → installs with no install scripts, no secrets.
2. **Run the demo:** `npm run demo` → the transcript above, the thirteen explorer links, then `Transcript matches data/replay/transcript.txt.`
3. **Verify a record on-chain:** `npm run verify -- data/batch-records/BR-B-1045.json` → `MATCH` with the computed and on-chain fingerprints and the anchoring tx link.
4. **Tamper with it:** add 1 g (`1000` mg) to any `actual_mg` in that file and run step 3 again → `MISMATCH`, exit code 1.
5. **Run the contract tests:** `cd contracts && cargo test` (Linux, macOS or WSL2) → 93 unit tests and four sandbox tests on a local NEAR node, including `over_limit_po_is_refused_with_the_exact_message`, `purchasing_loop_on_sandbox` and `group_purchasing_on_sandbox`.

---

## 4. Live recording procedure (done Oct 29; again on Nov 12 if the demo changes)

1. `npm run preflight` → every check ✓ (keys, RPCs, gas, PO-1041 and PO-1042 unused, budget, policy, supplier credentials). If the PO ids are used: `npm run reset:testnet -- --yes`, `npm run setup:testnet`, `npm run deploy:testnet`.
2. `npm run rehearse` → PASS on a throwaway PO (the relayed steps, a refused quote, a QC reject and the refund).
3. `npm run demo:live -- --record` → rewrites `data/replay/demo-chain.json`, `demo-llm.json`, `demo-salts.json` and `transcript.txt`, the record proof `data/batch-records/BR-B-1045.json`, and one quote proof per anchored quote in `data/quotes/`.
4. `npm run attest` → NEAR AI Cloud's report for Kevin's model and one signature check per recorded answer, written to `data/replay/attestation.json`; `npm run web:data` → `web/src/data/demo-run.json` for the static UI.
5. Commit the fixtures. `npm run demo` must end with `Transcript matches data/replay/transcript.txt.`; `npm run verify -- data/batch-records/BR-B-1045.json` → `MATCH`.
6. Spot-check three tx hashes on testnet.nearblocks.io: the refused `submit_po`, the relayed `approve_po`, the `qc_release` payout.

Each of the other recorded runs has its own `--record` command in `AGENTS.md` (`demo:group`, `sealed`, `test:attacks`, `record:credentials`, `usdc`, `inbox`); `npm run attest` runs again after any run that records new model answers.
