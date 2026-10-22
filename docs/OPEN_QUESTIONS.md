# Open questions for the human

Each question has a recommendation. Reply with the number and "yes" to accept it, or your own answer.

## Before Nov 1 (these block the first build days)

1. **Root testnet account name.** Recommend `acme-holdings.testnet` (free on Oct 22), plus `dayone-relayer.testnet`. Create both soon so nobody takes them. Alternative root: `acme-dayone.testnet`.
2. **Tool installs.** You install WSL2 Ubuntu (needs admin and a reboot). May Claude then install Node 24 LTS and near-cli-rs on Windows, and Rust plus cargo-near inside WSL2? Total disk is roughly 7–10 GB. Recommend yes.
3. **Contract test chain.** Contract integration tests use `near-sandbox`, a temporary local test chain (about 100 MB) that runs only during `cargo test`. Does that fit your "no local NEAR node" rule? Recommend yes: it is not a synced node.
4. **Which token settles the demo.** Circle's testnet faucet gives 20 USDC per address every 2 hours behind a CAPTCHA. Recommend: main demo in DTUSD (a clearly labeled test token we deploy) at real dollar amounts, plus one small PO in real Circle USDC. Will you collect about 100 USDC and ask Circle's Discord for a larger testnet grant? If they grant thousands, we use USDC only.
5. **Testnet NEAR.** Can you collect about 40 testnet NEAR before Nov 1? The faucet publishes no limit; NEAR Discord can help.
6. **LLM accounts.** Recommend both: a NEAR AI Cloud key with about $5 of credit (Kevin's default, for the privacy story), and linking your Max plan to a Claude Console organization to claim the $200/month API credit (fallback). The Console link is one-time and can't be changed without support.
7. **Who runs the testnet setup script.** It creates sub-accounts and keys on testnet from your local credentials. Recommend: Claude runs it on Nov 4 after you say yes in chat.
8. **NEAR Discord.** Please ask: "Do research docs, specs and an empty repo skeleton made before Nov 1 count as allowed prep?" and "Is KYC required to receive a prize?"

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
