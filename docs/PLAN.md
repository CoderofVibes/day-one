# Plan — Oct 22 to Nov 14

## In progress

_(none)_

---

## How to use this plan

- Work top to bottom. Each task ends in a commit with the repo working.
- **[I]** = interruption-friendly: can run 30–60 minutes unattended and resume from git log.
- **[H]** = needs the human (accounts, keys, CAPTCHA, approvals, recording, posting).
- Tiers: **T0** spine, **T1** economy, **T2** polish (PROJECT_BRIEF §5). Nothing in T1 starts while a T0 item is broken.
- Plan for half of each day to be lost. Buffers are built in on Nov 7, Nov 12 and Nov 14.
- **Pull forward (Tony, Oct 23 and Oct 25).** When a day's work finishes early, start the next day's top task; do not wait for a go-ahead. Spine work first, then gated features whose gates are green. Hard gates never move: the Nov 2 vision decision, the Nov 7 spine checkpoint, the Nov 10 cut decision, the Nov 13 freeze, the Nov 14 submission, and every **[H]** confirmation item.
- **Unattended runs (Tony, Oct 25, OPEN_QUESTIONS #25).** A scheduled "continue-plan" session runs back to back (checked every 15 minutes, Tony Oct 28) (working since Oct 28; task set to Auto mode) and works through this plan with nobody at the keyboard, including testnet transactions. Only the hard rules in `AGENTS.md` (mainnet, making the repo public, posting, submitting) wait for Tony in chat.
- **Decisions of Oct 25** (OPEN_QUESTIONS #21–24): one merged contract; DTUSD for the demo and the Circle USDC order as a bonus; suppliers accept and ship from their own accounts; bookkeeper pack before the import wizard, both planned.
- **Autonomous by default.** Claude and Muse work through this plan without checking in between tasks. Questions for Tony go into `OPEN_QUESTIONS.md` with a recommendation; work continues on whatever does not depend on the answer. See `AGENTS.md`, "Team and working protocol".

---

## Prep: Oct 22–31 (no feature code)

### Done
- [x] Phase 0 research (21 files in `docs/research/`)
- [x] Planning docs in `docs/`
- [x] Skeleton, `AGENTS.md`, `CLAUDE.md`, `.env.example`, local git repo

### Human tasks [H] — in priority order
1. **Answer `docs/OPEN_QUESTIONS.md`**, at least the "before Nov 1" group, including #17–19 (which Phase 0 package is canonical, a private GitHub remote, unattended runs).
1b. ~~**Finish `wrangler login`**~~ Done Oct 25: relay deployed at `https://muse-claude-bridge.coderofvibes.workers.dev`, MCP server registered in Claude Code's user config, first message and the three canonical docs sent to Muse. **Still open:** restart the Claude desktop app so the bridge tools load; give Muse the URL and the token (token file is outside the repo, never in chat).
2. ~~**Create the two top-level testnet accounts**~~ Done Oct 27: `acme-holdings.testnet` and `dayone-relayer.testnet`, ed25519 full-access keys in Tony's Windows keychain, 10 test NEAR each from the faucet (verified by RPC).
3. ~~**Install WSL2 Ubuntu**~~ Done Oct 25: Ubuntu 26.04.1 LTS, user `tony`, no reboot was needed. build-essential installed by Tony Oct 27 (gcc 15.2.0, verified).
4. ~~**Install Node 24 LTS** and **near-cli-rs 0.30.1**~~ Done Oct 25: Node 24.22.1; near-cli-rs 0.30.1 at `C:\Users\antho\.cargo\bin\near.exe` (the npm route fails on this PC because Git's `tar` misreads `C:\` paths; the PowerShell installer works).
5. ~~**Collect testnet NEAR**~~ Done Oct 27: 40 NEAR in `acme-holdings.testnet` (faucet gives 5 per request), 10 in `dayone-relayer.testnet` (verified by RPC).
6. **Collect Circle testnet USDC** (bonus): first claim done Oct 27, 20 USDC in `acme-holdings.testnet`, delivery to NEAR proven (research 01). More claims optional: 20 per 2 hours; PO-1047 needs only $19.
7. ~~**NEAR AI Cloud**~~ Done Oct 27: key in `.env` (gitignored); verified with a free attestation call for `z-ai/glm-5.3-flash` (HTTP 200).
8. ~~**Anthropic API (fallback)**~~ Done Oct 27: Console org linked to the Max plan ($200/month credit), key in `.env`; verified with the free models list (HTTP 200, `claude-sonnet-5-5` available).
9. ~~**NEAR Discord**~~ Done Oct 27: prep question already asked by many; organizers say a blog post is coming (OPEN_QUESTIONS #8).
10. ~~**Payout account**~~ Done Oct 27: `Tony's prize account` in Meteor Wallet; recovery phrase kept offline by Tony.
11. ~~**X account**~~ Done Oct 27: Tony confirmed it can post video. Keep the export ≤2:20 (standard-account limit) as planned.
12. **Run `npm run setup:testnet` once in your session** (OPEN_QUESTIONS #31): adds the server's key to `dayone-relayer.testnet` with your keychain. Needed for the live relayed approval (Nov 5). About a minute.

### Claude tasks in prep (tooling only, once the human approves installs)
- [x] [I] In WSL2: rustup stable 1.99.1, `wasm32-unknown-unknown`, cargo-near 0.22.0 installed Oct 25. Disk recorded in RISKS.md.
- [x] [I] Verified Oct 25: `node -v` 24.22.1, `near --version` 0.30.1, `cargo near --version` 0.22.0. No project code.
- [x] [I] Oct 25: throwaway `cargo near new` contract in WSL scratch (deleted after): `cargo near build non-reproducible-wasm` 17 s, 102 KB wasm with ABI; `cargo test` 7 unit + 1 near-sandbox integration test passed. The sandbox runs in WSL, so CONTRACTS §7 integration tests are viable. Sizes in RISKS.md.
- [x] [I] Sent Muse the current `PLAN.md`, `FICTIONAL_DATA.md` and `OPEN_QUESTIONS.md` over the bridge (messages #2–#4, Oct 25), after the first reply (#1).

---

## Week 1 — the spine (T0)

### Organizer rules that add tasks (HACKATHON.md Q-001–Q-017, published Oct 28, read by Muse)
- Code counts from Oct 19 (Q-001). **Feature code starts Oct 28** (Tony, OPEN_QUESTIONS #30): the Nov 1–4 tasks run early under the pull-forward rule; the dated hard gates do not move.
- [x] Tag the last docs-only commit `pre-hackathon` before the first feature commit (done Oct 28, `2345975`); tag `hackathon-submission` on Nov 14 (Q-003). Local tags; push them with the repo.
- [ ] Add an MIT `LICENSE` file (done Oct 28) and the libraries table in the README (Q-005, Q-014). Nov 13 at the latest.
- [ ] Keep any hosted demo up to Nov 18, ideally Nov 25 (Q-012). Video stays the primary X demo; screenshots alone are not enough.

### Sun Nov 1 — monorepo and ledger
- [x] [I] Monorepo bootstrap: npm workspaces (`server`, `agents/kevin`, `web`), TypeScript, test runner, lint, `.nvmrc`, `engines`. One `npm test` that passes. Done Oct 28: TypeScript 7.0.2, Vitest 5.0.5, Biome 2.6.3, tsx 4.23.15; first module `server/src/money.ts` (base units ↔ dollars). `kevin` and `web` join `tsconfig.json` references when they get code.
- [x] [I] Ledger schema in Drizzle per DATA_MODEL; migrations committed; `appendLotEvent` with hash chain and transition rules; triggers blocking edits; `rebuildProjections` test. Done Oct 28: all 31 tables STRICT with enum CHECKs, `server/src/ledger/` (`schema.ts`, `db.ts`, `events.ts` incl. `verifyChain`), 13 tests.
- [x] [I] Seed data from FICTIONAL_DATA: facilities, materials, formulas, vendors, lots, 30-day history as events with fixed timestamps. Done Oct 28: `server/src/seed/` (`history.ts`: 6 POs, 8 summarized batches drawn FIFO; 4 Plant C transfers; the CCS rejection), 354 chained events, 41 tests. **Open for the extraction task (Nov 3):** the six §7 records other than BR-B-1045 (1041–1044, 1046, A-2207) still need their lot draws; when they post, Plant B ASC must still read 722.350 kg before BR-B-1045, so give 1041 and 1043 their own ASC lots in the seed when the renderer fixes their lot lines (Nov 2).
- [x] [H] Smoke-test NEAR AI Cloud with the key: one text call, one image call, one JSON-schema call (about $0.05). Done Oct 28 unattended (allowed by OPEN_QUESTIONS #25): all three pass on GLM 5.3 Flash; turn thinking off for extraction (research 13, "Smoke test").

### Mon Nov 2 — contracts and documents
- [x] [I] `contracts/` Cargo workspace in WSL2 with **one** contract, `spend-policy`, escrow included (CONTRACTS.md, decision #21). Unit tests: limits, caps, approvals, pause, anchors, refusal messages, escrow state machine. Done Oct 28: 38 unit tests, clippy clean, 246 KB wasm; `set_agent_policy` gained `name` and `plant`, refunds reverse the month's spend (CONTRACTS.md updated).
- [x] [I] Batch-record renderer: HTML templates + Playwright → JPEG for the 7 records in FICTIONAL_DATA §7, plus 1 packing slip. Clean typed look first; handwriting, jitter and smudges only once extraction works (BUILD_ANALYSIS §4.1). Renderer lives in its own dev-only workspace; rendered images are committed. Done Oct 28: ground truth in `server/src/seed/batchRecords.ts` (every line, lot, supplier lot, initials, yield and waste; 36 tests tie it to §3, §7, §11 and §15 and to the demo-start ledger), renderer in `tools/render` (playwright-core 1.64.1 driving the installed Edge, no browser download; not a root workspace), `npm run render:records` → `data/batch-records/*.jpg` + `*.truth.json` and `data/packing-slips/` (NG-PS-60417 and the short `-X` variant), byte-identical on re-render. Clean typed look with blue-ink handwritten values, the BR-B-1043 strike-through, the BR-B-1046 smudge and the BR-B-1044 margin note; scan grain, jitter and handwriting fonts wait for the bake-off. **For the extraction task:** only BR-B-1045 posts to the demo ledger; the other six are checked one at a time against the demo-start ledger plus `NEW_LOTS` (ASC-261026-01, ASC-261030-01, CAC-261030-01), not as a sequence.
- [x] [I] Vision bake-off: GLM 5.3 Flash vs Qwen3.8-27B vs `claude-sonnet-5-5` on the 7 records. Record field accuracy in `docs/research/13-llm-access.md`. **Decide the vision route.** Done Oct 28 (`npm run bakeoff`, research 13 "Bake-off result"): GLM 5.3 Flash and Qwen3.8-27B both 290/290 typed and 190/190 handwritten fields with the smudge flagged; Qwen shifted a whole record's columns in one of two runs. **Vision route: `nearai:z-ai/glm-5.3-flash`** (cheapest TEE model that passes, by the recorded rule; already the default). Claude was refused twice by Anthropic's structured-output limits (16 union-typed fields; then "compiled grammar is too large"), so the Claude fallback needs a smaller schema before anyone relies on it. Re-run when the scan effects go in. Schema and scorer: `server/src/extraction/`.

### Tue Nov 3 — escrow and extraction
- [x] [I] Sandbox integration tests for `spend-policy` with an FT wasm (the full minimum set in CONTRACTS §7): fund, refuse, approve, retry, receive, release, refund, anchor. Done Oct 28: `contracts/spend-policy/tests/sandbox.rs` runs the demo loop on a local node with our own DTUSD token (`contracts/dtusd`), checking token balance = budget + escrowed after every step, plus wrong-sender refund, failed payout rollback and withdrawal; anchoring and the remaining §7 cases are unit tests. A real relayed meta-transaction is tested with the relayer (Nov 5).
- [x] [I] `LlmClient` with `nearai`, `anthropic`, `replay` adapters; fixture recorder. Done Oct 28: `server/src/llm/` (`RoutedLlm` from `LLM_ROUTE_*`, `NearAiAdapter` on fetch with thinking off and a receipt over the exact bytes, `AnthropicAdapter` on `@anthropic-ai/sdk` 1.1.0 with low effort, JSON format and default refusal fallbacks, `RecordingLlm`/`ReplayLlm` keyed by request hash; replay is the default mode), 14 tests. One live GLM 5.3 Flash JSON call passed and replayed identically; the Anthropic adapter is tested against a mocked client only and gets its first live call in the bake-off.
- [x] [I] Extraction pipeline: transcribe → normalize units → validate against formula → flags → confirm → ledger events + genealogy. Done Oct 28 (mocks and bake-off transcriptions, no live call): `agents/kevin/src/extraction.ts` sends the page to the vision route, parses quantities (`625,115`, `723,200 tablets`, `55.8 lb`) and converts them with the units table, checks each material summed across its lots against the active formula scaled to the batch (±tolerance), each lot against the ledger (exists, right material, supplier lot, usable, enough on hand at the plant), and flags low confidence, unknown lot, unit mismatch, out of tolerance (blocking until Ray answers or acknowledges), correction and yield variance (for the record; new flag kind, migration 0005). Step 1 prints the DEMO_SCRIPT line word for word; Ray's confirm posts issued/consumed/returned per lot with `batch_inputs` genealogy, prints the step 2 line (ASC 722.4 kg → 310.0 kg) and stores a salted record fingerprint rebuilt from the ledger rows (`batchRecordProof` for `npm run verify`, `batchRecordAnchorItem` for `anchor_batch`). 17 tests drive GLM 5.3 Flash's real bake-off readings of all seven records; the BR-B-1045 test stand-in now runs this pipeline. **Left for the demo script:** the live anchor call and writing `data/batch-records/BR-B-1045.json`; `llm_calls` rows; forward genealogy (`batch_outputs`) waits for finished-goods lots, which the seed does not model.

### Wed Nov 4 — testnet
- [x] [I] `scripts/setup-testnet`, `scripts/deploy`; DTUSD token deployed; `spend-policy` on testnet; budget funded. Done Oct 28: `npm run setup:testnet` and `npm run deploy:testnet`, both idempotent; `dtusd.acme-holdings.testnet` (1,000,000 DTUSD at the treasury) and `spend-policy.acme-holdings.testnet` with Kevin's policy and a 25,000 DTUSD budget. The four supplier accounts exist with DTUSD storage; the contract now enforces the supplier list (unlisted: refused with no approval path; conditional: always needs the director). Approved to run unattended (OPEN_QUESTIONS #25 supersedes #7). Needs the two top-level accounts and testnet NEAR from Tony (prep tasks 2 and 5).
- [x] [I] `server/chain`: every call logged to `chain_tx`, including refusals with the panic message. The replay fixture recorder is part of the chain client from the first call. Done Oct 28: `server/src/chain/` (`ChainClient` writes a pending row, then success/refused/failed; `LiveTransport` on near-api-js with each signer's FC key; `RecordingTransport` and `ReplayTransport` for `data/replay/` fixtures, strict call order), 12 tests; checked live on testnet with an over-limit `submit_po` from Kevin (refused, panic message and `po_refused` event logged, tx `6vtp7awcZLFtxA5sygNa372JaJUaJyUiwvofa481z7jR`). Relayed calls are rejected until `server/relayer` exists (Nov 5).

### Checkpoint by end of Thu Nov 5 — minimum submittable (BUILD_ANALYSIS §4.1)
- [ ] **By end of day:** one contract on testnet (refuse, approve, fund, release, refund, anchor); DTUSD; a demo script that runs the loop live and records fixtures; replay that replays them; a transcript with explorer links; a README draft with the five steps. Everything else in week 1 comes after this, in the order of the video.

### Thu Nov 5 — purchasing loop
- [x] [I] Kevin workflow: forecast (shortfall computed from formula and usage, explained in one sentence; no LLM forecasting), RFQ (static quotes from seed in T0), ranking with qualification rules, PO draft and `po_hash`. Done Oct 28: `agents/kevin/src/forecast.ts` and `purchasing.ts` print DEMO_SCRIPT steps 4 and 5 word for word and draft PO-1042 at $5,150.00 (freight now a column, migration 0003) and PO-1041 at $612.00; a `production_plan` table (migration 0002) holds BR-B-1047 (Nov 17) and BR-B-1048 (Nov 19); 15 tests.
- [x] [I] `submit_po` within limit (PO-1041) and over limit (PO-1042 refused) on testnet. Done Oct 28: `agents/kevin/src/submit.ts` sends the draft's terms as Kevin through the chain client; funded → PO `funded` (step 6 line); a refusal ending "director approval required." → an `approvals` row for the approver in Kevin's on-chain policy with the §9 text, PO `awaiting_approval` (step 7 line); other refusals have no approval path. Checked live with throwaway ids: PO-T1041 funded (tx `8NCdN2WwhVMuFbMJX5AAkzrsMVUGHVoP3FPKb7oNPBEW`), PO-T1042 refused (tx `HBP1ifWVpdEkJb9biew9DHU7maw2AJdD21UhnCB3didj`), then HQ cancelled PO-T1041 so the budget is back to 25,000 DTUSD. Demo ids PO-1041 and PO-1042 are still unused on chain.
- [ ] [I] Relayer (`server/relayer`) + server-held staff FC keys; phone mock UI with "YES 1042"; `approve_po` relayed; Kevin's retry funds escrow. **Partly done Oct 28:** `server/src/relayer/relayer.ts` (delegate signed with the staff FC key, wrapped and paid by the relayer, allowlist by staff account and method, no deposits) wired into `LiveTransport` for `viaRelayer` calls; `agents/kevin/src/approval.ts` turns "YES 1042" into the relayed `approve_po` with the PO's terms and the refused tx, then Kevin's identical retry (steps 8–9), NO into `reject_po`; unnamed replies ask again. 9 tests, mocks only. **Left:** the live run waits on human task 12 (relayer server key, OPEN_QUESTIONS #31); the phone mock UI comes with the web screens.

### Fri Nov 6 — receipt, release, records
- [ ] [I] Packing-slip match; `confirm_receipt` and `qc_release` relayed; payout callback; `qc_reject` refund path. **Done in code Oct 28 (mocks only):** `agents/kevin/src/receiving.ts` matches the slip to the PO and to the supplier lot from `get_po` (vendor, PO number, material, quantity, lot; the NG-PS-60417-X short delivery is held with no chain call), sends `confirm_receipt` as Tommy through the relayer, posts lot `ASC-261116-01` received then quarantined; `decideQc` sends `qc_release` or `qc_reject` as Priya, reads `po_released` vs `payout_failed` from the callback's event (a failed payout leaves the lot in quarantine and the money held), a rejection refunds and returns the lot (rejected, then wasted with "Returned to …"); `receiptAnchorItem` gives the step-12 receipt anchor. 10 tests. **Left:** the live run waits on human task 12 like the approval; the step-12 "Invoice matched" clause waits for the accounting screen. The supplier's accept-and-ship step it depends on was pulled forward the same day (see Nov 8).
- [x] [I] Anchoring job (`anchor_batch`); `npm run verify` with MATCH/MISMATCH. Done Oct 28: `server/src/records/anchors.ts` (salted canonical fingerprints, lot event ranges anchored by their head hash with `prev` linking ranges, `anchorBatch` records rows only on success, `verifyAnchor`) and `scripts/verify.ts` (`--json` too); 5 tests. Checked live: test anchor `TEST-ANCHOR-2610-1` (tx `G7k2cBzGUnzH6tXEK3asVmyJ4xkX2EEs6R31Hy1m3NBm`) gives MATCH, one gram edited gives MISMATCH. Batch-record files in `data/batch-records/` come with the extraction task.
- [ ] [I] Purchaser, receiving, QC and accounting screens (plain, functional).
- [x] [I] **Attack suite** (Muse #34, for the `security` track; cut first if this day slips): `npm run test:attacks` shows each of four attacks failing, using existing fixtures: a lookalike vendor (refused by qualification, contract allowlist), an inflated invoice (amount above the PO, refused), a fake "payment failed, retry" message (Kevin does not re-pay), and hidden-text instructions in an invoice (Kevin ignores them and flags the document). Output is plain pass/fail lines that the README can quote. Done Oct 28: `npm run test:attacks` (`--json` too) prints PASS for all four, replaying a testnet and NEAR AI run recorded with `-- --record` (`data/replay/attacks-*.json`, `data/attacks/`). Kevin's layer: `requestQuotes` drops and names lookalike or impostor quotes (`lookalikeOf`), `agents/kevin/src/invoices.ts` reads an invoice on the reasoning route, screens its raw text for instructions and matches it to PO and receipt (also the step-12 "Invoice matched" clause), `payments.ts` answers a pay-again message from `get_po` and sends nothing. Chain layer, live: Kevin's key sending a PO to `northgate-lngredients.testnet` is refused with no approval path (tx `CHCktaMzsEpppfsCeH3uDY3T9KvsKYZegwetsDsJH7Wt`); re-sending PO-T1043 is refused as already submitted (tx `FWcSEZCP8iUkdJvbr6ypuRVePrt7JPmA3np4fiMtcmt4`); Kevin holds 0 DTUSD and his signing key reaches only `submit_po`, `anchor`, `anchor_batch`. 9 tests. **Re-record** once PO-1042 is released on testnet, so the pay-again claim targets a paid PO instead of the cancelled PO-T1043.

### Sat Nov 7 — spine complete
- [ ] [I] **CLI and machine-readable output** (Muse #34, from the judges' interest in agent-operable tools): the existing `npm run` commands (`demo`, `demo:live`, `verify`, seed and reset, show escrow state) each accept `--json` and print one final JSON line besides the readable text. No new CLI framework.
- [ ] [I] `npm run demo:live -- --record` end to end on testnet; fixtures committed.
- [ ] [I] Replay mode; transcript test; behind-the-curtain view as a transaction log with explorer links.
- [ ] [I] **Bonus, never a gate (decision #22):** USDC deployment and PO-1047 recorded in Circle testnet USDC, once Tony has collected some. Week 2 never waits for it.
- [ ] [I] GitHub Actions workflow (Linux) running `npm test` and `npm run test:contracts`; it runs once the repo is public.
- [ ] **Checkpoint: the T0 spine works on testnet and in replay.** Anything unfinished here takes priority over all of week 2.

---

## Week 2 — the economy (T1), then polish (T2)

### Sun Nov 8 — supplier agents
- [ ] [I] `agents/suppliers/`: rule-based `SupplierAgent` per vendor (**accept-and-ship pulled forward Oct 28:** `agents/suppliers/src/shipping.ts` reads `get_po`, declines when the escrow does not hold the agreed supplier and amount, then signs `accept_po` and `mark_shipped(po_id, supplier_lot)` from the supplier's own account; `chain_tx` kinds gained both (migration 0004); 7 tests; checked live: throwaway PO-T1043 funded by Kevin (tx `21J8YKB8PtHZEK3byWW8UStHz6E6o6w6wpCyFrP1zC6A`), accepted and shipped by Northgate (txs `DL5kuwxra5R3QwAvkeUcTpqMAHVRxKiofVuxC6PQbgek`, `EtbYwH7NDWsZXTRHuWaCnjBEHU6GMbfRDBYXMwQuYaSH`), then cancelled by HQ; budget back to 25,000 DTUSD, escrow 0. Left: quotes over the bus, anchored quote hashes, QuickChem exclusion) with its own account; RFQ over the bus; quote hashes anchored from supplier accounts; QuickChem excluded with a reason. **Active counterparty (decision #23):** the supplier signs `accept_po` before funding, reads the escrow with a view call, then signs `mark_shipped(po_id, supplier_lot)`; the packing slip must match that lot. Escrow pays the supplier's own account.
- [ ] [I] Three-facility view and the ASC-261009-01 discrepancy flow with a proposed adjustment.
- [ ] [I] **Mass balance** (Tony, Oct 27, OPEN_QUESTIONS #27): per batch and per plant-material-period reconciliation of issued, output, waste, QC samples and stock; flag unaccounted material over 0.5%. Seeded case: Riverside under-records waste on P-CMD (FICTIONAL_DATA §15). Shown on the HQ view with Kevin's one-line explanation that units are not the cause. A query over existing ledger data; about half a day.
- [ ] [I] **Bookkeeper pack** (Plan v2, `FEATURES_V2.md` §2; first of the Plan v2 features, decision #24). Gate: settlement works end to end on testnet. QuickBooks-friendly CSV export of settled POs from the accounting view, plus duplicate-invoice and price-drift alert queries shown there.

### Mon Nov 9 — map and privacy
- [ ] [I] 2D plant map (React + SVG) driven by `deriveTwinState(events, t)`: departments come online, quarantine distinct, money and material flows.
- [ ] [I] Attestation: fetch and verify the NEAR AI Cloud report and per-response signatures; show them behind the curtain; keyless `verify-attestation` for replay.
- [ ] [I] HQ policy view (read-only display of on-chain limits and spend), with the policy history from `agent_policy_set` events, including the seeded trust ramp ($1,000 on day one, raised to $2,500 after five clean POs).
- [ ] [I] **Spreadsheet import wizard** (Plan v2, `FEATURES_V2.md` §1; second, decision #24). Gate: ledger and seed path green since Nov 1. Messy CSV/XLSX → column mapping → junk, duplicate and unit-mismatch flags → purchaser confirms → opening inventory posts through the seed path. Anything outside the defined mess patterns goes to review, never guessed. Includes the second tab, "Sales by customer" (FICTIONAL_DATA §14, OPEN_QUESTIONS #28): customer SKUs to tablets to kilograms, and the retyped Summary mismatch flagged. If it slips past Nov 10, it moves to Nov 12.

### Tue Nov 10 — cut decision and README
- [ ] **Morning cut decision.** Spine flawless in live and replay, T1 done → start T2. Otherwise T2 is cut and the rest of the week is spine, README and demo.
- [ ] [I] README first full draft from `README_TEMPLATE.md`, with the claims table filled from real files, tests and tx hashes.
- [ ] [I] T2 (if go): 3D twin in `web/src/twin3d/` from the same `TwinState` and layout.
- [ ] [I] Kevin as a small MCP server: read tools plus `draft_po`, so another agent can hire Kevin (moved up, BUILD_ANALYSIS §6).
- [ ] [I] **Cross-plant transfer suggestions, forecast side** (Plan v2, `FEATURES_V2.md` §3). Gate: the forecast job works (Nov 5). Start with one line in the forecast output; the full proposal-and-approve flow only if time allows.

### Wed Nov 11 — T2
- [ ] [I] 3D twin continued, record-mode fixed-step clock.
- [ ] [I] **Transfer suggestions UI card** (Plan v2): one line per proposal (what, from where, what it saves) with approve/dismiss. Only if the Nov 10 forecast-side proposals exist.
- [ ] [I] Group purchasing across three plants: pooled RFQ, supplier bids, one PO allocated per plant (`swarms`).

### Thu Nov 12 — T2 and buffer
- [ ] [I] In order, as time allows: Kevin's 5am brief (printable), natural-language policy changes routed to `set_agent_policy` via an owner approval, NEAR Auth spike.
- [ ] [I] Re-record fixtures from a fresh live run; clean-clone test in a new folder on Windows and in WSL.
- [ ] [I] Delete every folder and reference for features not built.
- [ ] [I] Prune `docs/` for the public repo (BUILD_ANALYSIS §4.6): Phase 0 material to `docs/phase0/` with a short README; remove `HANDOFF_FROM_MUSE.md` and `BRIEF_ASSESSMENT.md` from the tree; turn this plan into a shipped/cut status table.

### Fri Nov 13 — freeze and publish
- [ ] [I] README final. Limitations and on-chain/off-chain table checked against code.
- [ ] [I] Final clean-clone test; secrets scan; no TODOs or stubs.
- [ ] [H] Record the demo video (DEMO_STORYBOARD); export ≤2:20 with captions.
- [ ] [H] **Confirm** making the repo public; Claude pushes only after confirmation.
- [ ] [H] Post on X (draft in DEMO_STORYBOARD).

### Sat Nov 14 — submit (deadline 3:59 PM PST)
- [ ] [H] Morning: review the submission payload drafted in DEMO_STORYBOARD; submit via the form. Leave Website empty. One submission only.
- [ ] Afternoon: buffer. No code changes after submission.

---

## Cut list (cut from the top: item 1 is cut first)

The three Plan v2 features sit behind their own gates and are cut before anything on this list if their gate is red on the day.

**Shared gate for all three Plan v2 features** (proposed by Claude, accepted by Muse and Tony, Oct 25): none of them starts until the full loop — refusal → approval → escrow → QC release → payment — has run end to end on testnet at least once (the Nov 7 spine checkpoint). Their individual gates apply on top.

1. NEAR Auth spike
2. 3D twin (2D map ships)
3. Group purchasing (`swarms` tag dropped)
4. Natural-language policy changes
5. HQ portfolio view beyond the read-only policy panel
6. Kevin's 5am brief
7. Cross-plant transfer suggestions beyond the one forecast line
8. Spreadsheet import wizard
9. Kevin as MCP server
10. Trust ramp and policy history panel
11. Attestation panel (`privacy` tag dropped)
12. Supplier agents with their own accounts (static quotes; `agents` tag weakens)
13. 2D map (behind-the-curtain log and plain screens only)
14. Mass balance (cut last of all; Tony wants it in the build)

(Reordered Oct 25 per BUILD_ANALYSIS §7. The bookkeeper pack is not on this list: it is half a day and runs on Nov 8.)

Never cut: refusal → approval → escrow → QC release → payment on testnet; anchoring + verify; replay mode; contract tests; honest README.
