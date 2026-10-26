# Build analysis — 2026-10-25

Written by Claude at Tony's request six days before the build window. Inputs: the whole repo (brief, specs, `PLAN.md`, `RISKS.md`, all 22 research files), the live hackathon pages re-read today, a re-verification of the riskiest NEAR assumptions against current docs and live RPC, and a competitive sweep of agent-payment products and prior hackathon projects. Every claim below carries its source in the research files it updates (19, 20, 21, 06, 08, 10, 11) or is marked as judgement.

No code was written. Nothing here changes a Tony decision; the changes that need him are listed at the end as new open questions.

---

## 1. Verdict

The idea is strong and the research is unusually complete. The two things most likely to sink the entry are not technical: **the plan is still two to three times what one interrupted person can ship**, and **the spine carries risk it does not need** (two contracts with a cross-contract funding hop, two token deployments). Everything else is a matter of sharpening: the "why NEAR" argument has a soft spot a judge will press on, the supplier agents are too passive to earn the `agents` tag convincingly, and the repo's `docs/` folder will confuse an AI judge unless it is pruned on Nov 13.

What the re-checks found: no hackathon rule changed; the `security` track hint now reads "agent security, function call keys, TEE attestation", which is this design; NEAR itself shipped a business treasury product on Oct 20 with approval thresholds but no agent, so the differentiator is the agent plus policy layer, not the treasury; and nobody found has shipped spend policy, per-PO director approval, QC-released escrow and record anchoring together on any chain.

---

## 2. What changed since Oct 22 (verified today)

| Item | Finding | Action |
|---|---|---|
| Hackathon rules, dates, prizes, judges, form | Unchanged. Judging starts Nov 16 00:00 UTC. The only AI-judge instruction is still "write the README for a machine reader". | None |
| Track hints in HACKATHON.md | `security`: "agent security, function call keys, TEE attestation". `realworld`: "stablecoins, NEAR Intents, meta transactions". `business`: "humans set constraints". `swarms`: "sub-accounts". | Quote these in the README track lines |
| NEAR Business (launched Oct 20) | NEAR's own self-custodial treasury: payroll, vendor payments, approval thresholds by tier, invite-only. No AI agent. | Position Day One as the agent-plus-policy layer a treasury like that lacks; do not pitch "a treasury" |
| Polosukhin, Oct 24 interview | "Businesses are the next buyers of privacy"; procurement and legal work are a large share of item cost that verifiability could cut; agents holding slashable NEAR deposits. | Supports the thesis; one line in "Why NEAR" |
| Qureshi, Oct 7 | Card products (Rain, Visa, Ramp, Stripe) already offer "sub-cards, spending limits, and restrictions". | The pitch must say what on-chain adds beyond a cap (section 4.3) |
| OutLayer | Hackathon now links outlayer.ai, not outlayer.fastnear.com. Custody is mainnet-only per its pages. | Research 11 updated; skip decision stands |
| NEAR Intents | Still no testnet. Confidential Intents GA since July. | Roadmap only, as planned |
| `rpc.testnet.near.org` | No longer in NEAR's provider table; `*.near.org` endpoints marked deprecated. Still answers today. | Primary `test.rpc.fastnear.com`; second fallback `near-testnet.drpc.org` |
| near-api-js | 7.4.0 is now latest (7.3.1 in our docs). Meta-tx API unchanged. | Pin 7.4.0 on Nov 1 |
| near-workspaces-rs | Marked "deprecating" by NEAR; near-sandbox + near-api is the path. | Already our choice; pin near-sandbox 0.3.16 |
| GLM 5.3 Flash | A third-party report (not on NEAR) says it ignored `response_format` json_schema while tool calls worked. Unverified for NEAR AI Cloud. | Day-1 smoke test must try both; extraction via a tool call is the fallback |
| Circle testnet USDC | Contract and faucet listing re-confirmed. No independent report of a successful NEAR claim exists. | First claim is the test (PLAN human task 6) |
| Node | Node 26 becomes Active LTS on Oct 28. | Pin 24.22.x; do not switch mid-hackathon |

---

## 3. What is strong (keep, do not re-litigate)

- The hero beat. Refused by the chain → approved by text from the director's own account → escrow → paid on QC release. It answers every judge group at once and no competitor found does it.
- Keys scope *what*, the contract decides *how much*. Research 03 and 04 settled this correctly, including the 1-yocto consequence (Kevin's key can never move tokens).
- Replay mode with real transaction hashes, a committed transcript, a claims-to-code table, and a keyless `verify`. This is exactly how 2026 AI-judging pipelines score.
- Honesty built in: fictional data, "audit-friendly", testnet labels, limitations section, staff-key custody stated plainly.
- The market. A plant purchaser who never sees the chain is a user no other entry will bring. Polosukhin's Oct 24 remarks on procurement cost and business privacy land directly on it.

---

## 4. Weaknesses, ranked

### 4.1 Scope versus capacity (dominant risk)

Week 1 as written: monorepo; Drizzle ledger with hash chain, triggers, projections and a rebuild test; seed data for 3 facilities, 33 materials, 12 vendors, 7 records and 30 days of history; a Playwright renderer with handwriting fonts, per-glyph jitter, grain and stamps; a three-model vision bake-off; two Rust contracts with about 20 sandbox tests; an LLM client with three adapters and a fixture recorder; the extraction pipeline with validation, flags, confirm and genealogy; setup and deploy scripts; a test token; a chain client with a transaction log; Kevin's forecast, RFQ, ranking and PO draft; the relayer and staff keys; the phone mock; packing-slip matching; receipt, release and refund; anchoring and verify; five staff screens; live recording; replay; the transcript test; the curtain view; a second USDC deployment; CI. That is four to six person-weeks of work scheduled for seven interrupted days. Week 2 then adds supplier agents, the three-facility view, the import wizard, the 2D map, attestation, the HQ view, the README, the 3D twin, the bookkeeper pack, transfer suggestions, group purchasing, the 5am brief, policy commands, the trust ramp, an MCP server and a NEAR Auth spike.

The plan already knows this: it carries an 11-item cut list and three buffer days. The problem is that the *spine itself* is oversized, so the cut decision on Nov 10 may arrive with the spine still unfinished.

**Change.** Define a "minimum submittable" inside Tier 0 and reach it by **Nov 5**, two days before the Nov 7 checkpoint:

1. One contract on testnet: refuse, approve, fund, release, refund, anchor. Tests pass in WSL.
2. One token (DTUSD).
3. A demo script that runs the loop live and records fixtures; replay mode that replays them.
4. A transcript with explorer links; a README draft with the five steps.

Everything else in Tier 0 (rendered batch records with handwriting, vision bake-off, forecast, packing-slip vision match, five screens, phone mock, USDC proof, CI) is built *after* that, in the order of the video. The reasoning: a flawless loop with plain screens and typed batch records scores above a beautiful extraction demo with a half-working escrow.

Specific trims inside Tier 0, each recoverable later if time allows:
- Render batch records as clean typed HTML → JPEG first (one hour). Handwriting fonts, jitter and smudges come on Nov 3–4 only if extraction is already working.
- Forecast: compute the shortfall from the seeded formula and usage with no LLM, and have Kevin explain it in one sentence. No horizon modelling.
- Packing-slip match: in the spine the dock screen is a form that Tommy confirms; the vision match of the slip is a Tier 1 upgrade.
- Build the fixture recorder with the *first* chain call on Nov 4, not on Nov 7. Replay is a property of the chain client, not a feature at the end.

### 4.2 Two contracts and two tokens in the spine

`CONTRACTS.md` keeps `spend-policy` and `po-escrow` separate, funds escrow with `ft_transfer_call` from the policy contract, parses the PO out of `msg` in the escrow's `ft_on_transfer`, and rolls back counters in an `on_escrow_funded` callback. Research 04, 08 and `RISKS.md` #17 all name "merge into one contract" as the fallback, decided on Nov 4. The merge should be the default, decided now:

- The hop is the riskiest code in the spine (a cross-contract protocol with refund semantics, two callbacks and a rollback), and it is on the critical path to the hero beat.
- The merge removes one deployment, one account, the `add_policy` allowlist, the `msg` protocol, the funding callback, the rollback path and about six integration tests. The escrow becomes `budget → escrowed[po_id] → ft_transfer(supplier)` with one payout callback.
- The "rules versus money" legibility argument is weak. A judge reads one 400-line contract faster than two contracts plus the protocol between them, and the README's claims table points at method names either way.
- Separation of duties survives intact: Kevin's key reaches `submit_po` and `anchor`; the director's reaches `approve_po`; receiving and QC reach `confirm_receipt` and `qc_release`; none can move tokens.

The second deployment of the same wasm initialised with Circle USDC, for PO-1047, doubles accounts and setup again to prove something the README can state in one sentence ("token-agnostic; the token account is an init parameter"). Make PO-1047 **optional**: run it only if Tony's first faucet claim lands by Nov 4 and the merged contract is already on testnet. Otherwise drop it and say so in Limitations. Never scale amounts.

### 4.3 "Why NEAR" has a soft spot

The current lead is "enforced, not logged: the limit lives in a contract, not in a database". A judge (Qureshi first) will answer: `set_agent_policy` is owner-only and Acme can change it any time, so it *is* Acme's database row, moved to a chain; and Ramp, Visa and Stripe already issue sub-cards with limits. The competitive sweep sharpens this further: Coinbase Spend Permissions is an on-chain per-token allowance on Base; Circle's Arc Portal advertises agent spend limits; Payman offers per-transaction, daily and monthly caps with human approval above a threshold, off-chain.

What those do not do, and Day One does:
1. **The counterparty can verify.** A small supplier shipping to a newly acquired plant with unknown credit can see the PO's funds locked in escrow before it ships, from its own agent, without trusting Acme. A card limit is invisible to the supplier.
2. **Approval is bound to one PO and signed by a named person.** Spend Permissions and Arc cap a wallet; AP2 mandates are credentials a processor chooses to honour. Here the director's YES is a transaction only her key can produce, and Kevin's identical retry is what spends.
3. **Policy changes are themselves public events.** HQ cannot quietly raise or lower a limit after the fact; the plant, the supplier and the auditor see the same history.
4. **One audit trail** for approvals, payments, batch records and lot genealogy, with contents off-chain.
5. **No bank integration for the plant.** Day one, not after a treasury onboarding.

**Change.** Reorder the README's "Why NEAR" to lead with 1 and 2, then accounts-and-keys, then 3 and 4. Add 3 to the build: `set_agent_policy` already emits `agent_policy_set`; show the policy history in the HQ view and the curtain ("Jordan set Kevin's limit to $2,500 on Nov 3 (tx)"). Add 1 to the build by making the supplier agent check escrow state before it "ships" (section 4.4). Use Polosukhin's Oct 24 framing without quoting him: verifiability removes procurement and legal cost; businesses are the next privacy buyers.

### 4.4 Supplier agents are too passive for the `agents` tag

In Tier 1 each supplier agent anchors a quote hash from its own account and receives the payout. A judge who asks "what do the supplier agents actually do on-chain?" gets "they post a hash and get paid". Gershuni and Polosukhin will ask exactly that.

**Change** (cheap, because the accounts and keys already exist): make the supplier an active counterparty with two more signed transactions.
- `accept_po(po_id)` from the supplier's account before escrow can be funded, so funding is a two-party handshake.
- `mark_shipped(po_id, supplier_lot)` from the supplier's account after it has read the escrow state with a view call, which is the "supplier verifies funds before shipping" beat from 4.3. The supplier lot it posts is what Tommy's packing slip must match.

Both are single no-deposit methods on the merged contract and two short tests. They turn the `agents` row of the track matrix from "quote hash" into "RFQ, quote, accept, ship, paid, all from the supplier's own account".

### 4.5 Plan v2 ordering

Muse's three promoted features are gated correctly but ranked oddly for a 14-day solo build:
- **Bookkeeper pack** (QuickBooks-shaped CSV plus duplicate-invoice and price-drift alerts) is half a day of queries over data the spine already has, and it is the single best answer to Mumtaz's "would a real plant use this". Keep, and move it to Nov 8.
- **Spreadsheet import wizard** is a full day of UI (column mapping, a flag queue, idempotent posting) that appears in neither the video nor the five README steps. Move it below the 2D map and attestation; build it only if the Nov 10 cut decision is a clear go.
- **Cross-plant transfer suggestions** overlap the discrepancy story and need a seeded surplus pair. Reduce to one line in the forecast output ("Plant A has 60 kg of MCC above safety stock; a transfer covers 20% of this order") or cut.

Muse's reply (bridge message 14, Oct 25): agrees on the contract merge; agrees the USDC proof should not gate Nov 8 work but wants it kept as a Nov 7 stretch item rather than dropped, since a real stablecoin settlement is the strongest `realworld` evidence; disagrees on the wizard, because a messy spreadsheet is Tony's lived pain point and the upload → flags → confirm moment fits in 15 seconds of video. Muse's compromise: wizard stays first but hard time-boxed to Nov 8 with no Nov 9 polish, and it drops below the bookkeeper pack automatically if it slips. Both positions are recorded in `OPEN_QUESTIONS.md` #22 and #24 for Tony.

Also: `FEATURES_V2.md` still uses Muse's retired names (Summit Ridge, Sam Whitaker, Ruth Alvarez). Rewrite the three user stories with the repo's names before Nov 8 or the AI judge finds two fictional worlds.

### 4.6 The `docs/` folder is a liability for AI judges

The published repo will contain 22 research files, the brief, `BRIEF_ASSESSMENT.md`, `HANDOFF_FROM_MUSE.md` (which records a merged contract, a mock tUSDC, 3D-first and different names), `FEATURES_V2.md`, `LESSONS.md`, `OPEN_QUESTIONS.md`, and a `PLAN.md` with dozens of unchecked boxes. The 2026 AI-judging pipelines score down repos whose docs describe components the code does not contain. This is that failure mode, moved from the README into `docs/`. Research 19 also quotes the submission API in detail.

**Change** for Nov 13 (half a day, already partly in the plan as "delete every folder and reference for features not built"):
- Move Phase 0 material to `docs/phase0/` with a one-paragraph `docs/phase0/README.md`: "planning before Nov 1; the code is the source of truth where they differ".
- Delete `HANDOFF_FROM_MUSE.md` and `BRIEF_ASSESSMENT.md` from the public tree (they stay in git history).
- Turn `PLAN.md` into a status table: shipped / cut, one line each.
- Keep the research files; they are evidence of care, and the AI judges read sources.

### 4.7 The human-task chain and unattended runs

Eleven [H] prep items remain, and most of Nov 1–4 depends on them: the two top-level accounts (Nov 4 setup script), testnet NEAR (Nov 4), the NEAR AI key and credit (Nov 1 smoke test, Nov 2 bake-off), the Anthropic console link (bake-off control), the Discord questions, the first USDC claim (Nov 7 proof), the mainnet payout account and the X account (Nov 13–14). With a newborn, the realistic risk is that two or three of these slip a week.

**Change.** Add a "blocks" column to the [H] list in `PLAN.md` naming the first day each item blocks, and have Muse nudge in that order. Decide `OPEN_QUESTIONS` #19 now: the private remote exists, so scheduled "continue-plan" runs from Nov 1 are possible. Recommend: unattended runs allowed for code, tests, docs and replay; live testnet runs only in a session Tony opened. Wall-clock, not Claude's speed, is the schedule risk.

### 4.8 Privacy tag rests on an untested model

The `privacy` tag needs both extraction and reasoning on a Private TEE model. GLM 5.3 Flash is untested on handwriting, is a reasoning model (latency and output tokens), and may not honour `response_format` (unverified third-party report). `SPEC.md` promises a draft within 30 seconds.

**Change.** The Nov 1 smoke test tries json_schema *and* a forced tool call for extraction on each candidate, and records latency. If extraction must fall back to Claude, the honest tag line is already written in research 10; decide by Nov 2 as planned and do not let it drift.

### 4.9 Smaller items

- `PLAN.md` cut list says "cut from the bottom first" above a list where item 11 is the 2D map and item 1 is the NEAR Auth spike. Read literally it cuts the map first. Fixed today: "cut from the top".
- `.env.example` and `ARCHITECTURE.md` name `rpc.testnet.near.org` as the fallback. It is deprecated; add `near-testnet.drpc.org` as a second fallback on Nov 1.
- Playwright and the handwriting fonts must be dev dependencies of a separate `tools/render` workspace so `npm ci` at the root stays light for judges. Rendered JPEGs are committed.
- `SPEC.md` §4 ("no staff screen contains wallet, token, gas, key, NEAR, blockchain or transaction") is testable: a unit test that greps the staff UI strings. Twenty minutes, and it is the kind of enforced claim AI judges reward.
- The sustainability paragraph is thin for Garg. Add the go-to-market in one sentence: sold to PE platform operations teams that run the same playbook across add-on deals; priced per plant per month; the purchasing seat is the wedge; suppliers paid on delivery prefer Day One buyers, which is the network effect. Cite PitchBook (72.9% add-ons by count) and McKinsey's Great Ownership Transfer (about six million SMB transitions by 2035) as the two primary sources; research 22 and the new sources are listed in research 20.
- `RISKS.md` misses: Claude Code usage limits during a 14-day sprint; NEAR AI Cloud needing a payment method; X video limits (about 140 s on standard accounts, unverified); the OBS encoder depending on the GPU; Node 26 LTS arriving Oct 28.
- The demo video has eleven beats in 115 seconds and a voice-over by a parent of a newborn. Record the voice-over in beats, burn captions, and keep a 30 fps export as the fallback.

---

## 5. The field, and the objections to prepare for

Nobody found has shipped the combination. Closest prior art, to acknowledge in the README's related-work line rather than hide:
- **Porthmos** (2026 Shenzhen fintechathon, Base Sepolia): agent proposes supplier payments, contract checks caps and allowlists, milestone escrow released on signed proofs, approval tiers. Closest in shape.
- **Circle's 2025 AI-escrow experiment**: PDF contract → USDC escrow on Base → AI verifies the deliverable, human approves.
- **dareskro** (XRPL Commons, Oct 24–25, 2026): AI proposes, human signs on a hardware device, a named oracle releases escrow.
- **NEAR Business** (Oct 20): treasury with approval tiers, no agent.

Objections and the honest answers:
- *"Coinbase Spend Permissions or Circle Arc already cap agent spend."* They cap a wallet, not a purchase order. Neither binds approval to one PO signed by a named director, escrows per PO, or releases on a QC event.
- *"Ramp/Visa cards and Coupa already do agentic B2B payments."* For enterprises, with limits the supplier cannot verify, after the invoice, and nothing fits a 40-person acquired plant.
- *"Stablecoin B2B is tiny and SMBs do not trust agents with money."* True: real stablecoin B2B payments were about $226B in 2025, a rounding error of global payments, and 82% of SMBs cite an AI barrier (Bluevine 2026). Day One's answer is that the plant never sees the chain; the chain is the acquirer's control plane.
- *"This is just Acme's database on a chain."* Answered by 4.3: the supplier verifies escrow, approval is per-PO and signed, policy changes are public events.

Do not claim: a manufacturing-specific succession statistic (none exists), an SMB survey on letting agents spend (none exists), or x402 volume narratives.

---

## 6. Improvements that are cheap and high value

In rough order of value per hour:

1. **Merge the contracts and make the USDC proof optional** (4.2). Saves a day and the riskiest code path.
2. **Supplier `accept_po` and `mark_shipped`** (4.4). Two methods, two tests, one more video line ("Northgate's agent checked the money was there, then shipped").
3. **Policy history in the HQ view and the curtain** (4.3). The events exist; it is one query and one panel.
4. **Trust ramp from seed history**: Kevin's limit was $1,000 on day one and HQ raised it to $2,500 after five clean POs, as two `set_agent_policy` calls in the seeded history. Nearly free, and it makes "earn trust like a new hire" visible. Currently cut-list item 3.
5. **Kevin as an MCP server** with read tools and `draft_po` (two hours with the MCP TypeScript SDK). Makes "another agent can hire Kevin" literal for Polosukhin, Gershuni and the AI judges. Currently cut-list item 2; move it above the 3D twin.
6. **Staff-vocabulary test** (4.9).
7. **Bookkeeper pack on Nov 8** (4.5).
8. **README related-work line** naming Porthmos, Circle's experiment and NEAR Business, and what Day One adds.

---

## 7. Proposed `PLAN.md` changes (for Tony's yes; see `OPEN_QUESTIONS.md` #21–25)

- Nov 2–4: one merged contract, `spend-policy`, with escrow inside; `po-escrow` crate not created. Decision moves from Nov 4 to now.
- Nov 5: "minimum submittable" checkpoint (4.1) ahead of the Nov 7 spine checkpoint.
- Nov 7: PO-1047 USDC proof becomes a stretch item that never gates Nov 8 work (Claude: conditional on the first faucet claim by Nov 4; Muse: keep it as a Nov 7 stretch regardless).
- Nov 8: supplier agents with `accept_po` and `mark_shipped`; then either the bookkeeper pack first (Claude) or the import wizard hard time-boxed to Nov 8 with the bookkeeper pack next (Muse). Tony decides in #24.
- Nov 9: policy history panel added to the HQ view task.
- Nov 10: transfer suggestions reduced to a forecast line.
- Cut list reordered: NEAR Auth spike, 3D twin, group purchasing, natural-language policy, 5am brief, import wizard, transfer suggestions, Kevin as MCP server, trust ramp, attestation panel, supplier agents, 2D map. Cut from the top.
- Nov 13: `docs/` pruning task (4.6) made explicit.

Applied today without a decision: the cut-list wording fix, the dated addenda in research 06, 08, 10, 11, 19, 20 and 21, and this file.
