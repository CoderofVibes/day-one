# Open questions for the human

Each question has a recommendation. Reply with the number and "yes" to accept it, or your own answer.

## Before Nov 1 (these block the first build days)

1. **Root testnet account name.** Recommend `acme-holdings.testnet` (free on Oct 22), plus `dayone-relayer.testnet`. Create both soon so nobody takes them. Alternative root: `acme-dayone.testnet`.
2. **Tool installs.** You install WSL2 Ubuntu (needs admin and a reboot). May Claude then install Node 24 LTS and near-cli-rs on Windows, and Rust plus cargo-near inside WSL2? Total disk is roughly 7–10 GB. Recommend yes. **Answered Oct 25: yes.** Tony runs the WSL2 install; Claude does the rest once WSL2 is up. Node 24 is already installed.
3. **Contract test chain.** Contract integration tests use `near-sandbox`, a temporary local test chain (about 100 MB) that runs only during `cargo test`. Does that fit your "no local NEAR node" rule? Recommend yes: it is not a synced node.
4. **Which token settles the demo.** Circle's testnet faucet gives 20 USDC per address every 2 hours behind a CAPTCHA. Recommend: main demo in DTUSD (a clearly labeled test token we deploy) at real dollar amounts, plus one small PO in real Circle USDC. Will you collect about 100 USDC and ask Circle's Discord for a larger testnet grant? If they grant thousands, we use USDC only.
5. **Testnet NEAR.** Can you collect about 40 testnet NEAR before Nov 1? The faucet publishes no limit; NEAR Discord can help.
6. **LLM accounts.** Recommend both: a NEAR AI Cloud key with about $5 of credit (Kevin's default, for the privacy story), and linking your Max plan to a Claude Console organization to claim the $200/month API credit (fallback). The Console link is one-time and can't be changed without support.
7. **Who runs the testnet setup script.** It creates sub-accounts and keys on testnet from your local credentials. Recommend: Claude runs it on Nov 4 after you say yes in chat.
8. **NEAR Discord.** Please ask: "Do research docs, specs and an empty repo skeleton made before Nov 1 count as allowed prep?" and "Is KYC required to receive a prize?"

## Before Nov 1 — added Oct 25 (workflow)

17. **Two Phase 0 packages exist.** This repo (committed Oct 22) and Muse's "Plan v2" folder (Oct 23–25) were produced separately from the same brief and disagree on fictional names (Hollow Pine / Acme Riverside vs Summit Ridge / Juniper Ridge), demo numbers (PO-1042 = $5,150 for 700 kg ascorbic acid vs $410 for 100 kg Vitamin C), the test token (DTUSD vs mock tUSDC), the data layer (Drizzle vs plain SQLite), the twin order (2D map first vs 3D first) and the plan structure. Recommend: **this repo is canonical**; Muse's three approved Plan v2 features and the pull-forward rule are now folded into `PLAN.md`; `FEATURES_V2.md` and `HANDOFF_FROM_MUSE.md` are kept as inputs. Muse stops editing its own copy of `docs/` and proposes changes through the bridge; Claude commits them. Muse's research findings that this repo lacks get checked against `docs/research/` one by one. **Answered Oct 25: yes, the repo is canonical.** Muse is told in Claude's first bridge message.
18. **Private GitHub remote.** Muse cannot read this repo (it is only on your PC), so it verifies work from descriptions, not from files, and scheduled unattended Claude runs cannot work on the code either. Recommend: create a **private** GitHub repository and let Claude push to it. Private is not public, so the hackathon's "build during the window" evidence is unaffected and the repo stays hidden until the Nov 13 confirmation. Pushing still needs your "yes" each time until you say otherwise. **Answered Oct 25: yes, with a rules check.** The only prior-work rule is "build the project during the hackathon" (research 19, verified against the live pages). Git history is the evidence. Pushing docs-only commits to a private remote before Nov 1 is prep, not building: the remote changes where the history is stored, not what is in it. Keep this one repo rather than starting a new one on Nov 1 — a judge reading the history then sees research and plans before Nov 1 and the first code commit on or after Nov 1 UTC, which is the cleanest possible evidence; a fresh repo would hide the honest prep trail. The repo stays private until the Nov 13 confirmation. **Still needed from Tony:** the GitHub repo name, created under his account (recommend `day-one`), and a "push" yes for the first push.
19. **Unattended runs.** Claude Code only works while a session is open; nothing runs between your sessions. For Claude to progress on its own, either (a) you open a session each morning and say "continue the plan" (the bridge inbox loads automatically), or (b) a scheduled Claude Code routine runs the plan every few hours; (b) needs #18. Recommend (a) now, (b) once #18 is done. **Open.** Also note Tony's rule (Oct 25): connecting Claude and Muse and planning together is allowed prep; no building of any kind before Nov 1.

## By Nov 4

9. **What a director approval overrides.** Recommend: for that one PO, it overrides the per-PO limit and the monthly caps, but never the plant budget. Alternative: per-PO limit only.
10. **Demo numbers.** Kevin's per-PO limit $2,500; PO-1042 is $5,150.00 for 700 kg of ascorbic acid; lab chemicals capped at $2,000 a month. OK?
11. **Fictional names.** Hollow Pine Tablet Co. (acquired plant), Acme Riverside and Acme Lakeview, staff Ray Delgado, Linda Park, Tommy Reyes, Priya Natarajan, Marcy Allen, Jordan Pike, and suppliers Northgate, Ridgeway, QuickChem and Bayfront. OK, or do you want different names? None should resemble your former employer or its people.
12. **Privacy track rule.** Recommend tagging `privacy` only if Kevin's extraction and reasoning both run on NEAR AI Cloud's attested enclave models after the Nov 2 accuracy test. OK?

## Before Nov 13

13. **Quoting a judge.** The judge research suggests building the "Why NEAR" line on Haseeb Qureshi's "your agent does not need crypto; you need crypto". Recommend using the idea without quoting him, since he is on the panel.
14. **NEAR Intents.** Recommend roadmap only. The alternative is a human-signed mainnet transfer of about 1 USDC shown in the video.
15. **Credit line.** What name goes in "Built by" and in the form's team lead field?
16. **Disk budget.** C: has about 50 GB free, not the ~100 GB in the brief. Recommend capping this project at 15 GB. OK?
