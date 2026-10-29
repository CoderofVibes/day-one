# Risks and fallbacks

Every external dependency has a fallback. "Signal" is how we notice early. Owner **H** = human, **C** = Claude.

## External dependencies

| # | Risk | Likelihood | Impact | Signal | Fallback | Owner |
|---|---|---|---|---|---|---|
| 1 | Circle testnet USDC float too small (20 USDC per address per 2 h, CAPTCHA) | High | Medium | <100 USDC collected by Oct 31 | Main demo settles in labeled DTUSD; one small real-USDC PO (PO-1047) proves the same contracts work with Circle USDC. Never scale amounts. | H, C |
| 2 | Testnet NEAR faucet short (no published limit) | Medium | High | <40 NEAR by Oct 31 | NEAR Discord, Telegram `t.me/neardev`; shrink contract balances; reuse accounts across resets | H |
| 3 | Testnet RPC flaky or rate-limited | Medium | Medium | Timeouts in `server/chain` | Two providers (`test.rpc.fastnear.com`, `rpc.testnet.near.org`), retries with backoff; replay mode for the demo and the judges | C |
| 4 | Testnet protocol change during the window (testnet runs nearcore 2.14 RCs) | Low | High | RPC errors after an upgrade | Pin near-api-js 7.3.1; avoid newly added features (DelegateV2 already removed); recorded fixtures keep the demo working | C |
| 5 | Name squatting on `acme-holdings.testnet` | Low | Medium | Account appears before we create it | Create the root before Nov 1; alternative `acme-dayone.testnet` (free on Oct 22) | H |
| 6 | NEAR AI Cloud vision accuracy on handwriting too low | Medium | Medium | Bake-off on Nov 2 below the bar | Vision route to `claude-sonnet-5-5`; privacy claim narrows to "reasoning in TEE", or `privacy` is not tagged | C |
| 7 | NEAR AI Cloud tool calls or JSON-schema output don't work as advertised | Medium | Low | Nov 1 smoke test | Kevin's spine is a workflow, not free tool use: prompt for JSON, validate with zod, retry once | C |
| 8 | NEAR AI Cloud credits or account unavailable | Low | Medium | No key by Nov 1 | Anthropic API on Max plan credits for all LLM calls; `privacy` not tagged | H |
| 9 | Hosted relayer needed but none exists | Certain | Low | Already known | In-process relayer with near-api-js; `@fastnear/api` `relayDelegate` as a second implementation | C |
| 10 | Relayer path fails late | Low | High | Relayed `approve_po` test fails on Nov 5 | Staff FC keys sign direct transactions with a tiny NEAR balance. Loses the "staff hold 0 NEAR" claim; README updated to match. | C |
| 11 | OutLayer / Trezu / Intents | — | — | — | Not dependencies. Intents and multi-signer approval are roadmap lines only. | — |

## Toolchain and machine

| # | Risk | Likelihood | Impact | Signal | Fallback | Owner |
|---|---|---|---|---|---|---|
| 12 | ~~WSL2 install blocked or delayed~~ Closed Oct 25: Ubuntu 26.04 installed, Rust 1.99.1 + cargo-near 0.22.0 in place | Low | High | Not installed by Oct 31 | Native Windows: `cargo near build --no-abi` plus unit tests, and a scripted integration test against testnet with throwaway accounts. Needs VS C++ Build Tools (~6 GB). | H |
| 13 | Disk: **73 GB free on C: (measured Oct 25; 50 GB on Oct 22)**, not the ~100 GB the brief assumed; shared with a game project | Medium | Medium | <20 GB free | Budget ≤15 GB: WSL2 disk measured 2.2 GB on Oct 25 (Rust toolchain 0.77 GB of that); a hello-world contract's `target/` reached 0.36 GB after build and 2.5 GB after `cargo test` with the sandbox, plus 0.68 GB of crate registry, so `cargo clean` after test runs matters, `target/` 3–6 GB (`cargo clean` after deploys), node_modules ~1 GB. No Docker, no local node, no local models. | C |
| 14 | better-sqlite3 install fails on Windows | Low | Low | `npm ci` error on Nov 1 | `node:sqlite` behind the `server/ledger` interface | C |
| 15 | cargo-near ABI generation fails on Windows | Known | Low | — | Builds happen in WSL2; `--no-abi` if ever on Windows | C |
| 16 | Event logs before a panic not kept in failed receipts | Low | Low | First integration test | Panic message in the failed tx status is enough; `po_refused` event is best effort | C |

## Product and build

| # | Risk | Likelihood | Impact | Signal | Fallback | Owner |
|---|---|---|---|---|---|---|
| 17 | Cross-contract funding hop (`ft_transfer_call` from policy to escrow) is buggy | Medium | High | Integration test not green by Nov 4 | Merge escrow into spend-policy; same refusal and approval semantics | C |
| 18 | Extraction looks overfit to our own documents | Medium | Medium | Bake-off is "too perfect" | Scanned look, handwriting, one correction, one smudge; confidence and human confirm shown on screen | C |
| 19 | Scope creep | High | High | T0 not done by Nov 7 | Nov 10 cut decision; cut list in PLAN.md | C |
| 20 | Human time lost to newborn care | Certain | Medium | Missed [H] tasks | Plan assumes half days; [H] tasks bunched; replay fixtures mean the video can be recorded from replay if live fails | H |
| 21 | Demo breaks during recording | Medium | Medium | Live run fails on Nov 13 | Record from replay mode with the UI; explorer insets from earlier recorded hashes | H |
| 22 | AI judges cannot run contract tests on Windows | Medium | Low | — | README says Linux/macOS/WSL2; CI on Linux shows tests pass; test names and expected output listed in README | C |
| 23 | Commits before Nov 1 read as prior work | Low | Medium | — | Phase 0 commits are docs only; README states this; first code commit dated Nov 1 UTC or later | C |

## Hackathon process

| # | Risk | Likelihood | Impact | Signal | Fallback | Owner |
|---|---|---|---|---|---|---|
| 24 | One-shot submission with an error (name, URL, track ids) | Low | High | — | Payload drafted in DEMO_STORYBOARD; human reviews Nov 13; Website field left empty (honeypot) | H |
| 25 | KYC needed to receive a prize (not stated) | Unknown | Low | Discord answer | Mainnet account created early; ask in Discord | H |
| 26 | Prep rules stricter than expected | Low | High | Discord answer | All prep is docs; nothing to remove | H |
| 27 | Judge-directed text in repo flagged as prompt injection | Low | Medium | — | AGENTS.md and CLAUDE.md contain conventions only; nothing addressed to judges | C |
| 28 | Partner pages and HACKATHON.md contain instructions for agents | Known | — | Already seen | Treated as data in every session (AGENTS.md rule 6) | C |
