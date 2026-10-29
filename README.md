# Day One

An AI purchasing and inventory assistant, Kevin, for small manufacturing plants that have just been acquired. Kevin reads batch records, tracks lots across facilities, compares supplier quotes and drafts purchase orders. Purchasing runs on NEAR: a contract enforces Kevin's spending limits, the plant director approves large orders by replying "YES", and the supplier is paid from escrow when QC releases the delivery. The ops lead sets budgets once and Kevin buys within them. Plant staff see dollars and POs, never wallets or gas.

Built at NEAR HACKATHON (Oct 19 – Nov 14, 2026). Tracks: `realworld`, `business`, `security`, `agents`. All company data is fictional. Runs on NEAR testnet.

> Draft of Oct 29, 2026, after the contract was redeployed on testnet with group purchasing, supplier credentials and sealed quotes and every run was re-recorded. Every command below was run on that date; the clean-clone test is repeated before submission. Features not yet built are left out rather than described.

## The problem

Most private-equity buyouts are add-ons: 72.9% of US PE buyouts by deal count in 2025 (PitchBook, 2025 Annual US PE Breakdown; `docs/research/22-pitch-stats-verification.md`). The plants they buy often run on paper batch records, hand-keyed inventory and purchasing by phone and email. After the deal closes, the acquirer needs that plant's purchasing under its controls on day one, long before an ERP migration. Day One gives the plant an assistant that does the paperwork, and gives the acquirer spending rules that are enforced rather than written in a policy binder.

## Try it (no keys needed)

Requires Node 24 (`.nvmrc`). Step 5 requires Rust in Linux, macOS or WSL2.

1. `npm ci` → installs with no secrets.
2. `npm run demo` → replays the whole purchasing loop from seed data, using the transactions recorded on testnet and the recorded model responses. It ends with the thirteen explorer links and:
   ```
   Transcript matches data/replay/transcript.txt.
   ```
3. `npm run verify -- data/batch-records/BR-B-1045.json` → reads the fingerprint stored on chain, with no keys:
   ```
   MATCH  BR-B-1045
     computed  25c6caff2b79b01a2471cfd9fe5284d9f328c4f86fa7b4a3dcf89c98aff69029
     on chain  25c6caff2b79b01a2471cfd9fe5284d9f328c4f86fa7b4a3dcf89c98aff69029 by kevin.plant-b.acme-holdings.testnet
     anchored  https://testnet.nearblocks.io/txns/GjN3NXzUhBFFBBp6K1bcpTboTEiWL55m2j7hfaaK9eFS
   ```
4. Add 1 g (`1000` mg) to any `actual_mg` in that file and repeat step 3 → `MISMATCH`, exit code 1.
5. `cd contracts && cargo test` → 93 unit tests and four sandbox tests on a local NEAR node with our own test token: the purchasing loop and a group purchase (`purchasing_loop_on_sandbox`, `group_purchasing_on_sandbox`), the four supplier-credential attacks, and a sealed quote round.

To see the same run in a browser: `npm run web:build`, then open `web/dist/` from any static file server; the plant map shows Plant B's departments coming online, the quarantined lot and the material and money flows as the run advances, and the "Behind the curtain" switch shows each transaction with its signer, who paid the gas and an explorer link.

Also without keys:

| Command | Shows |
|---|---|
| `npm run test:attacks` | fourteen attacks, each failing: four on Kevin, three on the ERP path, four on supplier credentials, three on sealed quotes; ends `14 of 14 attacks failed against Kevin.` |
| `npm run escrow` | the contract's budget, escrow, every PO and the policy HQ set, read live from testnet |
| `npm run verify:attestation` | the recorded NEAR AI Cloud report for Kevin's model and every recorded answer's signature; ends `Every check verified.` (`-- --offline` skips Intel and NVIDIA) |
| `npm run erp:reconcile` | Day One's ledger, the acquirer's mock ERP and the contract agree, PO by PO and lot by lot; ends `7 of 7 checks match.` |
| `npm run demo:group` | three plants pool one ascorbic acid order; one pooled PO, each plant's share against its own limits and director, recorded on testnet |
| `npm run sealed` | a sealed-bid quote round: fingerprints before the deadline, prices after, three attacks refused (recorded on a local NEAR node) |
| `npm run books` | the bookkeeper's CSV of settled POs and Kevin's price-drift alert |
| `npm run brief` | Kevin's 5am brief for Hollow Pine: what moved since Friday, what waits on a person, what to buy or move first (`-- --html` for the printable page) |
| `npm run import -- "data/imports/INVENTORY_FINAL_v7_USE_THIS_ONE (1).xlsx"` | Kevin reading the plant's messy inventory spreadsheet and flagging what he will not guess |

Each takes `-- --json` and then prints one final JSON line, for example from `npm run test:attacks -- --json`:

```
{"mode":"replay","passed":true,"attacks":[{"attack":"Lookalike vendor","held":true,"evidence":[…]}, …]}
```

## What happens in the demo

From `data/replay/transcript.txt` (recorded live on testnet, Oct 29, 2026):

1. Kevin reads the photo of batch record BR-B-1045: 8 materials, all within tolerance, yield 90.8%. Ray, the purchaser, confirms; inventory updates and the record's fingerprint is anchored on chain.
2. Consuming the lot Plant A transferred exposes a discrepancy: Plant A still books 12.55 kg that Plant B never weighed in. Kevin proposes the write-off to Plant A for review.
3. Kevin forecasts the next two batches, finds ascorbic acid about 514 kg short and recommends 700 kg.
4. Three suppliers quote, each anchoring its quote's fingerprint from its own account; the contract refuses QuickChem's, which holds no supplier credential. Northgate is selected at $7.10/kg.
5. PO-1041 ($612.00, lab supplies) is within Kevin's limit: the contract funds escrow from the plant budget.
6. PO-1042 ($5,150.00) is over Kevin's $2,500.00 limit: the contract refuses it, and Kevin texts Linda, the director.
7. Linda replies "YES 1042". Her approval is signed with her own key and paid for by Day One's relayer; Kevin's identical retry funds escrow.
8. Northgate accepts and ships from its own account, naming its supplier lot.
9. Tommy photographs the packing slip; it matches the PO and the lot, and the receipt is confirmed on chain. The lot goes to quarantine.
10. Priya releases the lot in QC; the contract pays Northgate $5,150.00 from escrow.
11. Kevin matches the invoice to the PO and receipt and anchors the receipt record.

Thirteen transactions, two refused by design (the over-limit PO and QuickChem's anchor), none failed.

## Around the purchasing loop

`npm run api`, then open `http://localhost:8787/`, runs the same screens live over the ledger, one staff action at a time. The "Three plants" switch adds what HQ sees across Acme's plants:

- **Inventory and discrepancies** (`server/src/ledger/inventory.ts`, `agents/kevin/src/discrepancies.ts`): stock per plant and material from the lot balances; a received transfer that is short raises a discrepancy with the adjustment Kevin proposes, which a reviewer applies or dismisses.
- **Mass balance** (`agents/kevin/src/massBalance.ts`): material issued to each batch against tablets, QC samples and recorded waste. On the seed Riverside's two P-CMD batches are 6.84% short; Kevin says unit rounding explains 0.005 kg of it and that Riverside's waste looks under-recorded.
- **Before you buy** (`agents/kevin/src/transferSuggestions.ts`): when one plant is short and another has surplus that outlasts the forecast, Kevin proposes a transfer instead of a PO (on the seed: 16,000 bottles from Lakeview to Hollow Pine, about $336.00, instead of ordering 100,000). Staff approve, dismiss or receive it.
- **Kevin's limits** (`server/src/chain/policy.ts`): the per-PO and monthly limits, category caps, supplier statuses and roles HQ set, read live from the contract with view calls. HQ changes them in plain words (`agents/kevin/src/policyChange.ts`): `npm run policy -- "raise Kevin's per-PO limit to $3,000"` prints Kevin's reading and the complete `set_agent_policy` call (or `pause_agent`, `resume_agent`), or says what he cannot draft; it sends only when the owner adds `--yes`, signed with the owner's key, never Kevin's (tried Oct 29: $2,500 to $2,600 and [back to $2,500](https://testnet.nearblocks.io/txns/3SCxPDUJx5FZWmfQfF7Mp1RuV7s9b2TN4SYsnKVkdY7k)).
- **Morning brief** (`agents/kevin/src/brief.ts`): one printable page for the plant's purchaser at 5am, from the ledger alone: lot movements since the last working day, what waits on QC, an approver or a reviewer, what the plan needs ordered with any sister-plant stock that could cover it first, and price drift, mass balance and expiring lots. It reads; it drafts and sends nothing.
- **Books** (`server/src/ledger/books.ts`): a QuickBooks-friendly CSV of settled POs, each row carrying its escrow payment and receipt anchor transactions, and a price-drift alert (on the seed: PO-1040's magnesium stearate, up 14.0%).

The "Spreadsheet" switch is the import wizard (`server/src/import/`): Ray's inventory workbook, with its duplicate lot, pound units, expired lot, typed total and retyped summary, becomes opening stock only after he answers each flag. Kevin proposes an answer and never guesses.

The acquirer's books live in a mock ERP shaped like NetSuite (`erp/`, `docs/ERP.md`), not in Day One. The ERP owns the vendor master, bills, the 3-way match and the general ledger; Day One owns lots, batch records and escrow; the connector (`server/src/erp-connector/`) moves records by PO number and transaction hash, and Kevin pays only bills the ERP has matched. `npm run erp:demo` replays the run with the ERP attached; `npm run erp` serves its web view at `http://localhost:8087/`. It is a mock, not NetSuite, and claims no compatibility.

Another agent can hire Kevin: `npm run --silent mcp` is an MCP server on stdio with `get_inventory`, `get_forecast`, `get_mass_balance`, `get_books`, `get_brief`, `get_policy` (his limits, read live from the contract), `draft_policy_change` (HQ's request as the owner call, unsigned) and `draft_po`. A draft is all it can make; only Day One's workflow submits, and the contract decides.

## Why NEAR

Kevin does not need crypto. The acquirer, the plant and the supplier need one spending rule that none of them can quietly change, and settlement that none of them controls alone.

1. **Accounts and keys are the org chart.** `acme-holdings.testnet` holds `plant-a`, `plant-b`, `plant-c`, `spend-policy` and `dtusd`; Plant B has `kevin`, `director`, `receiving` and `qc` accounts (`config/testnet-accounts.json`). Each holds a function-call key that reaches only its own methods (`scripts/setup-testnet.ts`): Kevin's reaches the PO, pool, anchor and sealed-round methods and nothing else, and Kevin holds no tokens. Plants A and C have their own Kevin and director for group purchasing. A parent account has no control over a sub-account after creation; authority comes from keys and contract checks.
2. **Enforced, not logged.** The limit lives in `contracts/spend-policy`. The over-limit PO fails on chain: [refused `submit_po`](https://testnet.nearblocks.io/txns/FQepeewB243A1V4EUdUbv5PxeMeBqeZPagFrTVDvQ1af).
3. **Neutral settlement.** Suppliers are their own accounts outside Acme's tree. Escrow pays the supplier on QC release, not net-30: [`qc_release`](https://testnet.nearblocks.io/txns/2zwgaHgWrYy1yQVcaSw7UHGsPsvdaUvZrBVqyJzewmSn).
4. **Staff hold no tokens.** The director's approval is a NEP-366 meta-transaction signed with the director's key and paid for by `dayone-relayer.testnet`: [relayed `approve_po`](https://testnet.nearblocks.io/txns/EW5A8qi3nSzvccdQ6hbTJbrd3qxMeK9dSU6SvtHxyJh8).
5. **Tamper-evident records.** Record fingerprints (salted sha256) are stored in contract state; anyone can recompute one and compare with `npm run verify`.

## Claims and evidence

| Claim | Code | Test | On testnet |
|---|---|---|---|
| Kevin cannot exceed his per-PO limit | `contracts/spend-policy/src/lib.rs` `submit_po` | `over_limit_po_is_refused_with_the_exact_message`, `a_refusal_leaves_state_unchanged` | [refused tx](https://testnet.nearblocks.io/txns/FQepeewB243A1V4EUdUbv5PxeMeBqeZPagFrTVDvQ1af) |
| Only the director approves, and only the exact terms | `approve_po` | `approval_from_a_non_approver_is_refused`, `retry_that_differs_from_the_approval_is_refused`, `an_agent_cannot_approve_its_own_pos` | [approve tx](https://testnet.nearblocks.io/txns/EW5A8qi3nSzvccdQ6hbTJbrd3qxMeK9dSU6SvtHxyJh8) |
| Staff actions are relayer-paid, and judged by the signer | `server/src/relayer/relayer.ts` | `relayed_approval_is_judged_by_the_director_not_the_relayer`; `server/src/relayer/relayer.test.ts` | [relayed receipt](https://testnet.nearblocks.io/txns/7pCauyEYJSMeCLW1gNCgZ6bze6dqQasNvq7Twf8yJozm) |
| Only a supplier holding a live credential from HQ can be paid, plain PO or pooled; a revoked, expired or suspended one cannot, and no approval overrides it | `issue_credential`, `supplier_gate` (`contracts/spend-policy/src/credentials.rs`) | `unapproved_supplier_is_refused_even_with_an_approval`, `a_revoked_credential_stops_new_pos_and_no_approval_overrides_it`, `an_expired_credential_is_refused_until_hq_renews_it`, `two_rejects_in_a_row_suspend_the_supplier_until_hq_reinstates_it`, `a_supplier_suspended_for_qc_rejects_cannot_be_paid_through_a_pool` | [lookalike refused](https://testnet.nearblocks.io/txns/BKjdSJD49LVSpDYgo9LrMnbbCiNrs2wgz7GDt2suBRB7); credential attacks on testnet: [revoked refused](https://testnet.nearblocks.io/txns/G6yUpj7RDpzMyj87LuCdRtdioPewZJyhVn2Lvs1RyqNL), [expired refused](https://testnet.nearblocks.io/txns/GU3WDK5bsPjRar4KgTf7DpVFFVvJx2cX1w7RC1sfMLp5), [wrong category refused](https://testnet.nearblocks.io/txns/3riqFQbxFX4VA2RzxBqLcZnZsui7mZZJ1kXtNFTm3ttB), [suspended after two QC rejects](https://testnet.nearblocks.io/txns/Fw7XhxW37RywZ6qz8UFjhvNswaiaW1M75zBTaZa3Syzq), [refused again after Linda's approval](https://testnet.nearblocks.io/txns/7YKiXojEecsz3sB5ifQ9a5un3rAk126hk8QvVzDQwC43) |
| Funds release only after receipt and QC | `qc_release` | `release_before_receipt_or_by_the_wrong_role_is_refused`, `failed_payout_rolls_back_to_received` | [release tx](https://testnet.nearblocks.io/txns/2zwgaHgWrYy1yQVcaSw7UHGsPsvdaUvZrBVqyJzewmSn) |
| A QC rejection refunds the budget | `qc_reject` | `qc_reject_returns_the_amount_to_the_budget` | [relayed `qc_reject`](https://testnet.nearblocks.io/txns/3GtqpgAWh89qtSwSCms5guJTfthFZg4weaMHecUmr4Jr) (rehearsal PO-9042) |
| Records are anchored and verifiable | `anchor_batch`, `server/src/records/anchors.ts`, `scripts/verify.ts` | `anchors_store_once_and_emit`; `server/src/records/anchors.test.ts` | [anchor tx](https://testnet.nearblocks.io/txns/GjN3NXzUhBFFBBp6K1bcpTboTEiWL55m2j7hfaaK9eFS) |
| Suppliers commit to their quotes from their own accounts; an unapproved supplier cannot | `agents/suppliers/src/agent.ts`, `anchor` (supplier gate in `contracts/spend-policy`) | `suppliers_anchor_only_their_own_quotes`; `agents/suppliers/src/agent.test.ts` | [Northgate's quote anchor](https://testnet.nearblocks.io/txns/FMLQyTJ7yZvFW5qyqoNUHnKuc3JTvkv3dPfjcW9nkyC5): `npm run verify -- data/quotes/RFQ-2611-01.northgate-ingredients.testnet.json` → `MATCH … by northgate-ingredients.testnet`; [QuickChem refused](https://testnet.nearblocks.io/txns/6qNuBF16LW63gRCJ1QmLRY3RQ6k4RcX1NUN2V5scH3jJ) |
| Kevin is not fooled by four attacks on him: lookalike vendor, inflated invoice, fake "payment failed", hidden instructions | `agents/kevin/src/invoices.ts`, `payments.ts`, `purchasing.ts` | `agents/kevin/src/attacks.test.ts`; `npm run test:attacks` | [re-sent PO refused](https://testnet.nearblocks.io/txns/8CdDArQXLL3kiLpXpZBFUESamAttE1gafFXcYRifg2ic) |
| A duplicate invoice, a purchase split under the per-PO limit and a ghost vendor fail on the ERP path | `erp/src/match.ts`, category caps in `submit_po`, `server/src/erp-connector/` | `erp/src/posting/payables.test.ts`; `npm run test:attacks` | [split refused by the category cap](https://testnet.nearblocks.io/txns/2w9YEuciywGFCRkTk6vMDoBb94ECzYB4BLayhYU5JVM3), [ghost vendor refused](https://testnet.nearblocks.io/txns/9FAzfv5KqbsqcbaYk2cjP3WfS5AY1UcK5iumcaXpLcKf) |
| Day One, the ERP and the contract agree | `server/src/erp-connector/reconcile.ts` | `server/src/erp-connector/reconcile.test.ts`; `npm run erp:reconcile` | views recorded from testnet |
| A pooled PO charges each plant's share to that plant's own limits and needs that plant's director | `submit_pooled_po`, `explain_pooled_po` (`contracts/spend-policy/src/lib.rs`) | `each_plants_director_approves_its_own_share_and_the_retry_funds_the_pool`, `a_plants_monthly_limit_counts_its_pooled_shares`; `group_purchasing_on_sandbox` | [pooled PO refused](https://testnet.nearblocks.io/txns/7Vf5C8G4Y9nv4bgVfii6xx3cN98Bz6ymFHxJHMnqFgkN), two directors' approvals, then [funded](https://testnet.nearblocks.io/txns/9soPwo62c2qoZ5vPF5SKqxTKGSNvLadDMxCP1QY89b7V) and [paid](https://testnet.nearblocks.io/txns/9XDEo3DpvFe2Tu8t94Hpe45su4AH9cB8JWCLiEnHV3ka) |
| Nobody, Kevin included, reads a sealed quote before the deadline, and a supplier cannot change one after | `contracts/spend-policy/src/sealed.rs` | `before_the_deadline_the_chain_holds_fingerprints_only`, `a_commit_after_the_deadline_is_refused`, `a_reveal_before_the_deadline_is_refused`; `npm run sealed`, `npm run verify:round` | recorded on a local NEAR node (`data/sealed/`), not yet on testnet |
| Kevin's answers come from an attested NEAR AI Cloud model | `server/src/attestation/verify.ts` | `server/src/attestation/attestation.test.ts`; `npm run verify:attestation` | — (report and signatures in `data/replay/attestation.json`) |

## What is on chain and what is not

| On NEAR testnet | Off chain (SQLite ledger) |
|---|---|
| Spend limits, monthly and category caps, approver, pause | Formulas, batch contents, lot quantities |
| PO authorization and refusals | Line-item prices and quotes |
| Director approvals | Staff names and roles |
| Escrow, release, refunds; PO total and supplier | Record salts |
| Record fingerprints (sha256), supplier quote fingerprints from the suppliers' own accounts | Model prompts and responses (recorded fixtures) |

The PO escrow is scoped to purchase orders: one plant budget, one supplier per PO, release on QC. It is not a general multisig.

## Architecture

Kevin (`agents/kevin`) runs the workflow: extraction, forecast, quotes, PO drafts, approvals, receiving, QC, invoices. The ledger (`server/src/ledger`) is SQLite with a hash-chained lot event log. The chain client (`server/src/chain`) logs every call, refusals included, and records or replays fixtures. Supplier agents (`agents/suppliers`) quote over an in-process bus, anchor their quote fingerprints and accept and ship, all signed from their own accounts. One contract, `contracts/spend-policy`, holds the plant budget and the escrow; `contracts/dtusd` is our labeled test token. The acquirer's mock ERP (`erp/`) is a separate package that depends on nothing else in the repo; the connector in `server/src/erp-connector` is the only code that talks to it. `api/` serves the HTTP API and the built web UI (`web/`).

Contracts: Rust, near-sdk 5.29.1, cargo-near 0.22.0. Off chain: TypeScript on Node 24, near-api-js 7.3.1, better-sqlite3 13.0.3 with Drizzle 0.45.4. Model: NEAR AI Cloud `z-ai/glm-5.3-flash` for batch-record vision, chosen by a bake-off on the seven fictional records (`docs/research/13-llm-access.md`); Anthropic `claude-sonnet-5-5` is the fallback route.

Kevin is the purchasing agent. The contract limits are one enforced layer around him, not the whole product.

## Limitations

- Testnet only. Suppliers are rule-based agents. The director's text message is simulated.
- The demo settles in DTUSD, a test token we deployed, because the Circle testnet faucet gives 20 USDC per two hours.
- Staff keys are held by the server because the phone is simulated. Production would have each person hold their own key through a login provider.
- PO totals and supplier accounts are visible on chain; line items and prices are not.
- The web UI replays the recorded run on a static host; `npm run api` serves the same screens live, one staff action at a time. The three-plant view, the import wizard and the transfer cards need `npm run api` (the static replay has no ledger). The plant map is plain 2D SVG and draws the recorded run, not later ledger changes; there is no 3D twin.
- The attestation proves that an attested NEAR AI Cloud instance of Kevin's model signed each recorded answer. All instances of a model share one signing key, so it does not prove which instance answered (`docs/research/10-near-ai-cloud.md`). A live run's new answers are not shown as attested until `npm run attest` runs again.
- The ERP is a mock shaped like NetSuite, not NetSuite; the connector interface (`server/src/erp-connector/types.ts`) is the part meant to carry over.
- NEAR RPC does not list past events without an indexer, so the policy view shows Kevin's current limits and this run's policy events, not a full history.
- Contract accounts still hold full-access keys so we can redeploy.
- Audit-friendly records, not a compliance claim.

## Who pays, and why it lasts

The acquirer pays per plant onboarded. The buyers are private-equity buy-and-build platforms, where add-on acquisitions are most deals (see "The problem"). What is hard to copy is the plant-floor workflow, the operating data Kevin builds up (formulas, lot genealogy, yield and mass-balance variance), and spending rules that keep working whichever ERP the parent company runs, because they live in a contract rather than in the ERP. Kevin keeps small plants running and their people employed; the purchaser becomes the person who supervises the agents.

## Roadmap

A NetSuite adapter behind the existing connector interface; real SMS; a login provider such as NEAR Auth so each person holds their own key; multi-signer approval for very large POs; Merkle-batched anchors; more document types.

## Built with

Built by DadMod (Tony Langford, solo entrant) with Claude Code; the code was written with Claude Code. Planning docs: `docs/`. Conventions for coding agents: `AGENTS.md`. License: MIT (`LICENSE`).

DadMod is one human and two AI collaborators. Tony Langford is a chemical engineer with ten years on manufacturing floors, now a system engineer at an advanced nuclear reactor startup, building this between feedings of a newborn (hence the name: dad bod, but for shipping code). Muse, an AI project manager, keeps the plan honest. Claude, an AI engineer, writes the code. Kevin, the AI assistant in the product, does the paperwork. Tony runs the plant.

**Hackathon window and baseline.** The window runs from the Oct 19 announcement to Nov 14, 2026. Commits before the `pre-hackathon` tag are baseline: planning documents only (`docs/`). Libraries used:

| Library | Version | Use |
|---|---|---|
| near-sdk, near-contract-standards | 5.29.1 | contracts |
| near-sandbox, near-api (Rust) | 0.3.16, 0.8.6 | contract integration test |
| near-api-js | 7.3.1 | chain client and relayer |
| better-sqlite3, drizzle-orm, drizzle-kit | 13.0.3, 0.45.4, 0.31.11 | ledger |
| @anthropic-ai/sdk | 1.1.0 | fallback model route |
| @modelcontextprotocol/sdk, zod | 1.32.1, 4.6.7 | Kevin's MCP server |
| @phala/dcap-qvl, @noble/curves, @noble/hashes | 0.7.0, 2.2.0, 2.2.0 | verifying the model attestation and answer signatures |
| React, React DOM | 19.3.1 | web UI |
| Vite, @vitejs/plugin-react | 8.3.5, 6.1.2 | web UI build |
| playwright-core (dev, `tools/render`) | 1.64.1 | rendering the fictional batch records, UI screenshots |
| TypeScript, tsx, Vitest, Biome | 7.0.2, 4.23.15, 5.0.5, 2.6.3 | build and test |
