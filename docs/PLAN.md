# Plan — Oct 22 to Nov 14

## In progress

_(One line here when a session is interrupted mid-task: what, where, next step.)_

---

## How to use this plan

- Work top to bottom. Each task ends in a commit with the repo working.
- **[I]** = interruption-friendly: can run 30–60 minutes unattended and resume from git log.
- **[H]** = needs the human (accounts, keys, CAPTCHA, approvals, recording, posting).
- Tiers: **T0** spine, **T1** economy, **T2** polish (PROJECT_BRIEF §5). Nothing in T1 starts while a T0 item is broken.
- Plan for half of each day to be lost. Buffers are built in on Nov 7, Nov 12 and Nov 14.
- **Pull forward (Tony, Oct 23 and Oct 25).** When a day's work finishes early, start the next day's top task; do not wait for a go-ahead. Spine work first, then gated features whose gates are green. Hard gates never move: the Nov 2 vision decision, the Nov 7 spine checkpoint, the Nov 10 cut decision, the Nov 13 freeze, the Nov 14 submission, and every **[H]** confirmation item.
- **Unattended runs (Tony, Oct 25, OPEN_QUESTIONS #25).** A scheduled "continue-plan" session runs every 3 hours from Nov 1 and works through this plan with nobody at the keyboard, including testnet transactions. Only the hard rules in `AGENTS.md` (mainnet, making the repo public, posting, submitting) wait for Tony in chat.
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
2. **Create the two top-level testnet accounts early** (name squatting): `acme-holdings.testnet` and `dayone-relayer.testnet`. Command in research 05. Needs near-cli-rs (step 4).
3. ~~**Install WSL2 Ubuntu**~~ Done Oct 25: Ubuntu 26.04.1 LTS, user `tony`, no reboot was needed. **Still open:** run `sudo apt-get install -y build-essential` in the Ubuntu window (needs your password) so Rust has a C linker.
4. ~~**Install Node 24 LTS** and **near-cli-rs 0.30.1**~~ Done Oct 25: Node 24.22.1; near-cli-rs 0.30.1 at `C:\Users\antho\.cargo\bin\near.exe` (the npm route fails on this PC because Git's `tar` misreads `C:\` paths; the PowerShell installer works).
5. **Collect testnet NEAR:** target 40 NEAR into `acme-holdings.testnet` (faucet; ask NEAR Discord or Telegram if short).
6. **Collect Circle testnet USDC:** faucet.circle.com, "Near Testnet", 20 USDC per address every 2 hours, CAPTCHA. Register the account with the USDC contract first (research 01). Target 100 USDC. **Ask in Circle's Discord** for a larger testnet grant. After the **first** claim, tell Claude which account you used, so Claude can confirm on-chain that the balance landed in Circle's contract (`3e22…b8af`); the faucet's delivery to NEAR is the one thing not yet proven (research 01, re-verified Oct 25).
7. **NEAR AI Cloud:** create an account, an API key, and add about $5 of credit.
8. **Anthropic API (fallback):** link a Console organization to the Max plan to claim the $200/month API credit; create a dedicated workspace with a spend limit and an API key.
9. **NEAR Discord:** ask what counts as prep (OPEN_QUESTIONS).
10. **Mainnet payout account:** create it; note whether acquiring NEAR needs exchange KYC.
11. **X account:** confirm it can post video.

### Claude tasks in prep (tooling only, once the human approves installs)
- [x] [I] In WSL2: rustup stable 1.99.1, `wasm32-unknown-unknown`, cargo-near 0.22.0 installed Oct 25. Disk recorded in RISKS.md.
- [x] [I] Verified Oct 25: `node -v` 24.22.1, `near --version` 0.30.1, `cargo near --version` 0.22.0. No project code.
- [x] [I] Oct 25: throwaway `cargo near new` contract in WSL scratch (deleted after): `cargo near build non-reproducible-wasm` 17 s, 102 KB wasm with ABI; `cargo test` 7 unit + 1 near-sandbox integration test passed. The sandbox runs in WSL, so CONTRACTS §7 integration tests are viable. Sizes in RISKS.md.
- [x] [I] Sent Muse the current `PLAN.md`, `FICTIONAL_DATA.md` and `OPEN_QUESTIONS.md` over the bridge (messages #2–#4, Oct 25), after the first reply (#1).

---

## Week 1 — the spine (T0)

### Sun Nov 1 — monorepo and ledger
- [ ] [I] Monorepo bootstrap: npm workspaces (`server`, `agents/kevin`, `web`), TypeScript, test runner, lint, `.nvmrc`, `engines`. One `npm test` that passes.
- [ ] [I] Ledger schema in Drizzle per DATA_MODEL; migrations committed; `appendLotEvent` with hash chain and transition rules; triggers blocking edits; `rebuildProjections` test.
- [ ] [I] Seed data from FICTIONAL_DATA: facilities, materials, formulas, vendors, lots, 30-day history as events with fixed timestamps.
- [ ] [H] Smoke-test NEAR AI Cloud with the key: one text call, one image call, one JSON-schema call (about $0.05).

### Mon Nov 2 — contracts and documents
- [ ] [I] `contracts/` Cargo workspace in WSL2 with **one** contract, `spend-policy`, escrow included (CONTRACTS.md, decision #21). Unit tests: limits, caps, approvals, pause, anchors, refusal messages, escrow state machine.
- [ ] [I] Batch-record renderer: HTML templates + Playwright → JPEG for the 7 records in FICTIONAL_DATA §7, plus 1 packing slip. Clean typed look first; handwriting, jitter and smudges only once extraction works (BUILD_ANALYSIS §4.1). Renderer lives in its own dev-only workspace; rendered images are committed.
- [ ] [I] Vision bake-off: GLM 5.3 Flash vs Qwen3.8-27B vs `claude-sonnet-5-5` on the 7 records. Record field accuracy in `docs/research/13-llm-access.md`. **Decide the vision route.**

### Tue Nov 3 — escrow and extraction
- [ ] [I] Sandbox integration tests for `spend-policy` with an FT wasm (the full minimum set in CONTRACTS §7): fund, refuse, approve, retry, receive, release, refund, anchor.
- [ ] [I] `LlmClient` with `nearai`, `anthropic`, `replay` adapters; fixture recorder.
- [ ] [I] Extraction pipeline: transcribe → normalize units → validate against formula → flags → confirm → ledger events + genealogy.

### Wed Nov 4 — testnet
- [ ] [I] `scripts/setup-testnet`, `scripts/deploy`; DTUSD token deployed; `spend-policy` on testnet; budget funded. Approved to run unattended (OPEN_QUESTIONS #25 supersedes #7). Needs the two top-level accounts and testnet NEAR from Tony (prep tasks 2 and 5).
- [ ] [I] `server/chain`: every call logged to `chain_tx`, including refusals with the panic message. The replay fixture recorder is part of the chain client from the first call.

### Checkpoint by end of Thu Nov 5 — minimum submittable (BUILD_ANALYSIS §4.1)
- [ ] **By end of day:** one contract on testnet (refuse, approve, fund, release, refund, anchor); DTUSD; a demo script that runs the loop live and records fixtures; replay that replays them; a transcript with explorer links; a README draft with the five steps. Everything else in week 1 comes after this, in the order of the video.

### Thu Nov 5 — purchasing loop
- [ ] [I] Kevin workflow: forecast (shortfall computed from formula and usage, explained in one sentence; no LLM forecasting), RFQ (static quotes from seed in T0), ranking with qualification rules, PO draft and `po_hash`.
- [ ] [I] `submit_po` within limit (PO-1041) and over limit (PO-1042 refused) on testnet.
- [ ] [I] Relayer (`server/relayer`) + server-held staff FC keys; phone mock UI with "YES 1042"; `approve_po` relayed; Kevin's retry funds escrow.

### Fri Nov 6 — receipt, release, records
- [ ] [I] Packing-slip match; `confirm_receipt` and `qc_release` relayed; payout callback; `qc_reject` refund path.
- [ ] [I] Anchoring job (`anchor_batch`); `npm run verify` with MATCH/MISMATCH.
- [ ] [I] Purchaser, receiving, QC and accounting screens (plain, functional).

### Sat Nov 7 — spine complete
- [ ] [I] `npm run demo:live -- --record` end to end on testnet; fixtures committed.
- [ ] [I] Replay mode; transcript test; behind-the-curtain view as a transaction log with explorer links.
- [ ] [I] **Bonus, never a gate (decision #22):** USDC deployment and PO-1047 recorded in Circle testnet USDC, once Tony has collected some. Week 2 never waits for it.
- [ ] [I] GitHub Actions workflow (Linux) running `npm test` and `npm run test:contracts`; it runs once the repo is public.
- [ ] **Checkpoint: the T0 spine works on testnet and in replay.** Anything unfinished here takes priority over all of week 2.

---

## Week 2 — the economy (T1), then polish (T2)

### Sun Nov 8 — supplier agents
- [ ] [I] `agents/suppliers/`: rule-based `SupplierAgent` per vendor with its own account; RFQ over the bus; quote hashes anchored from supplier accounts; QuickChem excluded with a reason. **Active counterparty (decision #23):** the supplier signs `accept_po` before funding, reads the escrow with a view call, then signs `mark_shipped(po_id, supplier_lot)`; the packing slip must match that lot. Escrow pays the supplier's own account.
- [ ] [I] Three-facility view and the ASC-261009-01 discrepancy flow with a proposed adjustment.
- [ ] [I] **Bookkeeper pack** (Plan v2, `FEATURES_V2.md` §2; first of the Plan v2 features, decision #24). Gate: settlement works end to end on testnet. QuickBooks-friendly CSV export of settled POs from the accounting view, plus duplicate-invoice and price-drift alert queries shown there.

### Mon Nov 9 — map and privacy
- [ ] [I] 2D plant map (React + SVG) driven by `deriveTwinState(events, t)`: departments come online, quarantine distinct, money and material flows.
- [ ] [I] Attestation: fetch and verify the NEAR AI Cloud report and per-response signatures; show them behind the curtain; keyless `verify-attestation` for replay.
- [ ] [I] HQ policy view (read-only display of on-chain limits and spend), with the policy history from `agent_policy_set` events, including the seeded trust ramp ($1,000 on day one, raised to $2,500 after five clean POs).
- [ ] [I] **Spreadsheet import wizard** (Plan v2, `FEATURES_V2.md` §1; second, decision #24). Gate: ledger and seed path green since Nov 1. Messy CSV/XLSX → column mapping → junk, duplicate and unit-mismatch flags → purchaser confirms → opening inventory posts through the seed path. Anything outside the defined mess patterns goes to review, never guessed. If it slips past Nov 10, it moves to Nov 12.

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

(Reordered Oct 25 per BUILD_ANALYSIS §7. The bookkeeper pack is not on this list: it is half a day and runs on Nov 8.)

Never cut: refusal → approval → escrow → QC release → payment on testnet; anchoring + verify; replay mode; contract tests; honest README.
