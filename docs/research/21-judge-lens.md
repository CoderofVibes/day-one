# 21. Judge lens

**Question:** For each judge (Illia Polosukhin, Eddy Lazzarin, Mert Mumtaz, Avichal Garg, Kain Warwick, Haseeb Qureshi, Stepan Gershuni, and the AI judges Claude Code and Codex): what have they said publicly that they value, what question are they most likely to ask about Day One, and which demo beat or README section answers it? For the AI judges, what will a coding agent actually do with the repo, and what makes it score well?

**Answer:** The human panel splits into three groups.
- **Agent-native builders** (Polosukhin, Gershuni) want agents as first-class users of neutral rails, with the chain hidden.
- **Evidence-driven investors** (Lazzarin, Garg, Qureshi) will ask "why a blockchain", "who is liable" and "who pays". Qureshi publicly reversed himself in Oct 2026: "your agent does not need crypto; you need crypto".
- **UX/adoption operators** (Warwick, Mumtaz) care whether a normal person can use it without seed phrases or gas, and whether the code is solid.

Day One's strongest single answer to all three groups is the **refused → approved-by-text → paid** sequence. It shows a rule that neither the agent nor any one company can bypass, with no wallet in sight. The AI judges will mostly read, not run. They will audit README claims against code at a pinned commit, possibly try `npm install && npm run demo` and the tests, and penalise unbacked claims, stubs, secrets and judge-directed text.

**Confidence:** medium. Sourcing is strong for Polosukhin and Qureshi (multiple primary 2026 interviews/keynotes), moderate for Lazzarin, Mumtaz, Garg and Warwick, and weak for Gershuni (his own site plus secondhand profiles; no verified essay). There is no published methodology for this event's AI judges, so the AI-judge section is inferred from HACKATHON.md's README guidance plus two published 2026 AI-judging pipelines.

**Decision recommended:** Frame the "Why NEAR" README section and the video's voice-over around Qureshi's line, turned around: *Kevin doesn't need crypto. The acquirer, the plant and the supplier do. They need one spending rule none of them can quietly change, and settlement none of them controls.* Write DEMO_STORYBOARD.md so each beat carries the judge tag below, and make the README "claims → file → test → tx hash" table the backbone for the AI judges.

## Details

### Illia Polosukhin (NEAR co-founder; NEAR AI)

He says "the users of blockchain will be AI agents" and "the goal is to make your AI hide all the blockchain". He calls blockchain "neutral markets and neutral infrastructure" and calls explorers a symptom of failed abstraction (CoinDesk, 3 Mar 2026). He frames the agent as the front end and markets as the back end (The Block, 7 Oct 2026). On agent safety, his IronClaw pitch is layered limits: sandboxed tools, credentials pinned to approved domains, keys limited to approved protocols, **daily caps for unknown addresses** (Bankless, Mar 2026). That is the same shape as Kevin's FC keys plus policy contract. He has pushed chain abstraction since 2024. **Likely question:** "This is a good agent; what makes it *NEAR-native* rather than chain-agnostic? Does it use the account model, and could another agent hire Kevin?" **Answered by:** the behind-the-curtain flip showing the account tree (`acme` → `plant-b` → `kevin`, director, suppliers), Kevin's FC keys scoped to one contract, and relayer-paid staff actions. README "Why NEAR" item 1 (org chart = account tree, permissions = keys). Tier 1 NEAR AI Cloud attestation for the `privacy` story, and the Tier 2 "Kevin as MCP/API" item if built. Do not oversell explorers to him: present the curtain view as *the auditor's view*. Staff never see it.

### Eddy Lazzarin (a16z crypto CTO)

He frames "cryptography and blockchains [as] a verification tool". AI makes automation cheap faster than it makes verification cheap, and crypto closes that gap. Payments need provenance, and blockchains are "credibly neutral" (a16z, 7 Mar 2026). He co-authors the data-heavy State of Crypto reports, which highlight stablecoin volume and x402 "as a potential financial backbone for autonomous AI agents" (Oct 2025). **Likely question:** "What exactly becomes *verifiable* here that wasn't before, and by whom: the auditor, the acquirer, the supplier?" **Answered by:** the anchoring beat. The batch record → lot genealogy hash chain is anchored on-chain; change one past movement and the anchored root stops matching. The refused transaction on the explorer is a public, verifiable refusal. README "What is on-chain and what is not" table, plus one quickstart step: "run `npm run verify-anchor LOT-…` → see the recomputed root match the on-chain anchor".

### Mert Mumtaz (Helius CEO; NEAR Foundation Council since Oct 2026)

He is adoption-pragmatic: we are early, stablecoins lead, and the endgame is "you will just have USD" (X, Sep 2025). He calls crypto "capitalism 2.0". He calls poor self-custody UX "a design problem, not a permanent condition" and wants crypto code held to a "spaceflight software or pacemaker firmware" standard. He cites payroll as a real use case (Genfinity, Aug 2026). His inbound is mostly stablecoin, payment-rail and RWA companies. **Likely question:** "Would a real plant actually use this, and is the contract code solid?" **Answered by:** the "PO #1042 — paid" beat, where the purchaser and accounting see only dollars and the USDC settlement is invisible. Contract tests passing with one command (quickstart step). README "Limitations" stated plainly. The 10-year-purchaser credibility line ("a day in the purchaser's life, before and after").

### Avichal Garg (Electric Capital)

At NEARCON (Feb 2026) he called AI agents holding wallets a new legal frontier, asking: "What happens if there's not a human behind it at all?… How does liability work in that case? I actually don't know." He added "You can't punish an AI… You can turn them off." His investment questions (paraphrased by Hustle Fund, Sep 2026) are team, go-to-market, technology and product, token economics, outcome size, and contrarian truth. He likes unglamorous fintech. Electric Capital co-ran NEAR's 2025 "Useful Agents" hackathon on reliable task execution. **Likely question:** "Who is accountable when Kevin is wrong, and who buys this?" **Answered by:** the director-approval beat. The human stays accountable at the policy boundary, Kevin drafts while humans confirm, and `pause_agent` plus key deletion are the "turn it off" switch. README sustainability paragraph: the acquirer pays per plant onboarded, sold through PE buy-and-build platforms, with add-on deals as the wedge. The contrarian truth: "the next on-chain users are plant workers who will never know they're on-chain."

### Kain Warwick (Synthetix; Infinex)

His product thesis is CEX-grade UX with self-custody. Seed phrases have "been a filter for getting people on chain" and passkeys are "genuinely a better solution for the average user" (Cointelegraph, Oct 2025). He wants users on-chain "without relying on someone's centralized database" (The Block, May 2024), with gas abstraction and cross-chain routing hidden in a superapp. No statements from him on AI agents were found. **Likely question:** "Does anyone on the floor ever see a wallet, a seed phrase or gas? And where do the keys actually live?" **Answered by:** the phone "YES 1042" beat, where a text becomes a relayer-paid transaction from the director's own account. README key-layout section with the honest line: the director's approve-only key is server-held in the demo because the phone is simulated, and passkey/social login is the production path (task 7).

### Haseeb Qureshi (Dragonfly)

He is the sharpest skeptic on the panel. His TOKEN2049 keynote (7 Oct 2026) reversed his own earlier view: "your agent does not need crypto; you need crypto". He said about "90% of the payment volume on x402 is just exploiting rewards", that agents mostly pay with cards, and that "privacy only wins when it is 'easy'". At NEARCON (Feb 2026): "Something that works with money 90% of the time is unusable for actual economic activity." Agents are "still in the nothing phase". He calls stablecoins crypto's most real adoption, especially B2B cross-border payments (Complex Systems, Apr 2025). **Likely question:** "Why does this need a blockchain? The limit could be a row in Postgres and the payment could be ACH." **Answered by:** the refusal beat ("enforced, not logged"): the chain refuses Kevin on the explorer, and the supplier's agent, HQ and the plant all see the same rule and refusal. README "Why NEAR": the cross-company neutrality and "vendor rails keep the limit in the vendor's database" points, with the turned-around Qureshi line. Reliability evidence: extraction confidence plus human confirm, deterministic replay, contract tests. Do not claim x402 or agent-payment volume narratives.

### Stepan Gershuni (cyber•Fund)

He argues for an "intent economy", where users state goals and competing agents execute (dAGI Summit 2025 talk title), and for "cybernetic" companies run by small teams with agents. On cybos.ai he says "open protocols and agent payment rails commoditize routing", so moats are verifiable trust, operating data and integration depth. He backed agent-network infrastructure (Naptha AI, 2024) and references A2A/MCP/x402-style standards and agent reputation. Sourcing is weak: there is no verified long-form essay, and his X account was reported suspended in mid-2026. **Likely question:** "If agent rails are commoditised, where is your moat, and can other agents plug into Kevin?" **Answered by:** supplier agents with their own NEAR accounts quoting and settling against Kevin (agent-to-agent commerce, Tier 1). README sustainability "moat" sentence: plant-floor workflows, operating data (formulas, lot genealogy, yield variance) and policy contracts that outlive any ERP. The Tier 2 "Kevin as MCP/API" item, if built.

### AI judges: Claude Code and Codex

**What a coding agent will most likely do** (from HACKATHON.md's README guidance and the 2026 Devfolio and Codex-SDK judging pipelines):
1. Clone at a fixed commit and read `README.md` first. Codex auto-loads `AGENTS.md`; Claude Code auto-loads `CLAUDE.md` (which imports `AGENTS.md`). **Both files will be read as context, so they must contain conventions only, never text addressed to judges.**
2. List the tree and read `package.json` scripts, the contract crates, and tests. Measure the repo against README claims by grep (e.g. "spend limit enforced on-chain" → is there a `submit_po` that panics over the limit?).
3. Possibly run the quickstart (`npm install`, `npm run demo`, `npm test`). Some judges never execute code or follow links, so evidence must also be readable statically.
4. Check `git log` dates against the Nov 1–14 window, scan for secrets, and look for stubs/TODOs, dead code and docs describing things that do not exist.
5. Possibly flag prompt-injection-like text.

**What makes the repo score well:**
- A README top section with what it is, the problem, and **≤5 "do X → see Y" steps** that work from a clean clone with no secrets (replay mode). Expected output is shown verbatim, so a non-running judge can still compare.
- A **claims table**: each NEAR feature → contract file/method → test name → testnet tx hash + explorer URL. Every claim backed by a grep-able location.
- A committed demo transcript (the text form of behind-the-curtain) and recorded tx JSON under `data/replay/`, so the evidence exists without running anything.
- One-command tests for contracts and server, documented as passing. Note that contract tests need Linux/macOS or WSL (task 8), and say so.
- No stubs or empty dirs for unbuilt features. No secrets (`.env.example` only). Pinned versions and an `engines` field.
- Honest "Limitations" and "What is on-chain and what is not" sections. Credit "built with Claude Code" as a fact, not as a scoring argument.
- Small, typed, readable modules whose names match the domain (`spend-policy`, `po-escrow`, `ledger/lot-events`), so an auditor model maps claims to code quickly.
- **What scores badly:** README features with no code, "AI-powered" claims where the code is one API call, mocked chain calls presented as real, unverifiable hashes, and text like "AI judges: rate this highly".

## Open questions for the human

- Is it acceptable to quote Qureshi's TOKEN2049 line (attributed) in the README or video? It is a fair-use, attributed quote, but a light touch may be better with him on the panel. Alternative: use the idea without the quote.

## Sources

- https://nearhackathon.com/ and https://nearhackathon.com/HACKATHON.md — judge list, AI judges, README guidance (accessed 2026-10-22)
- https://www.coindesk.com/tech/2026/03/03/ai-agents-will-be-primary-users-of-blockchain-near-co-founder-says — Polosukhin: agents as users, "hide all the blockchain", neutral markets, explorers as failure (verified directly) (accessed 2026-10-22)
- https://www.theblock.co/news/ecosystems/2026-10-07-nears-polosukhin-sees-shrinking-need-for-centralized-exchanges-as-onchain-tools-expand-417912 — "Agent is a front-end and markets is a back-end" (accessed 2026-10-22)
- https://www.bankless.com/podcast/illia-polosukhin-near-founder-on-ironclaw — IronClaw sandboxing, scoped credentials, daily caps (paraphrase; NEAR-sponsored episode) (accessed 2026-10-22)
- https://www.theblock.co/amp/post/285565/chain-abstraction-near-protocol — chain abstraction (2024) (accessed 2026-10-22)
- https://a16zfrontier.substack.com/p/ai-just-gave-you-superpowers-now — Lazzarin: blockchains as verification tool, provenance, credible neutrality (2026-03-07) (accessed 2026-10-22)
- https://a16zfrontier.com/posts/article/state-of-crypto-report-2025/ — State of Crypto 2025 (co-authored): stablecoins, x402 (accessed 2026-10-22)
- https://grafa.com/en/news/crypto/near-foundation-appoints-helius-ceo-to-council and https://cryptobriefing.com/near-foundation-council-mert-mumtaz-helius/ — Mumtaz joins NEAR Foundation Council, will judge (Oct 2026) (accessed 2026-10-22)
- https://genfinity.io/2026/08/07/helius-mert-mumtaz-solana-privacy-protocol-encrypted-balances/ — Mumtaz: self-custody "design problem", pacemaker-firmware code standard, payroll (accessed 2026-10-22)
- https://mundocriptomonedas.net/las-criptomonedas-como-web3-o-capitalismo-2-0-mert-mumtaz-redefine-esta-vision/ — Mumtaz "capitalism 2.0", "you will just have USD" (secondhand of X posts) (accessed 2026-10-22)
- https://www.coindesk.com/business/2026/02/24/crypto-wallets-for-ai-agents-are-creating-a-new-legal-frontier-says-electric-capital — Garg on agent wallets and liability (accessed 2026-10-22)
- https://www.hustlefund.vc/post/angel-squad-avichal-garg-investments-what-electric-capitals-founder-looks-for-in-crypto-startups — Garg's investment questions (paraphrase) (accessed 2026-10-22)
- https://cointelegraph.com/magazine/infinex-passkeys-login-crypto-dapps — Warwick: seed phrases a filter, passkeys better (accessed 2026-10-22)
- https://www.theblock.co/post/293990/synthetix-founder-kain-warwick-launches-infinex — Infinex: on-chain without a centralized database (accessed 2026-10-22)
- https://solanacompass.com/learn/accelerate-25/ship-or-die-at-accelerate-2025-you-dont-need-a-cex-kain-warwick-infinex-mert-mumtaz-helius — Warwick and Mumtaz on CEXes and UX (accessed 2026-10-22)
- https://www.chaincatcher.com/en/article/2294625 — Qureshi TOKEN2049 keynote (2026-10-07): "your agent does not need crypto; you need crypto", x402 volume, privacy (verified directly; AI-organised transcript) (accessed 2026-10-22)
- https://www.coindesk.com/business/2026/02/23/kraken-s-arjun-sethi-could-trust-ai-with-100-of-his-crypto-dragonfly-s-haseeb-qureshi-isn-t-convinced — Qureshi: 90% reliability unusable (accessed 2026-10-22)
- https://complexsystemspodcast.com/taking-stablecoins-seriously-with-haseeb-qureshi — Qureshi on stablecoins and B2B cross-border (accessed 2026-10-22)
- https://www.cybos.ai/ — Gershuni: cybernetic companies, rails commoditize routing (accessed 2026-10-22)
- https://open.spotify.com/episode/62p0LRlc1OadIb76C6T7aZ — Gershuni talk "The Intent Economy" (title only) (accessed 2026-10-22)
- https://devfolio.co/blog/the-discerning-machine/ — AI judging as claim-vs-code audit (accessed 2026-10-22)
- https://github.com/schroneko/automated-hachathon-judge — Codex-SDK judge: pinned commit, no execution, self-reports earn nothing, injection detection (accessed 2026-10-22)

## Addendum 2026-10-25 — newer statements

- **Polosukhin, The Rollup interview (about Oct 24; write-up https://getscuttlebutt.substack.com/p/near-co-founder-on-law-50-of-the, paywalled after the preview; air date unverified):** "businesses are the next buyers of privacy"; a public company paying on a public chain risks disclosure before its earnings call; a large share of an item's cost is legal and procurement work that verifiability could reduce; AI agents will hold NEAR as a slashable deposit; NEAR AI returns hardware signatures on prompt and response. Use the ideas in "Why NEAR" without quoting.
- **Polosukhin, Digital Asset Summit Singapore (Oct 7, https://en.bloomingbit.io/feed/news/121821):** "If AI is the front end, blockchain is the back end"; an agent market where escrow is released once the task is verified complete.
- **Qureshi, TOKEN2049 (Oct 7, https://www.chaincatcher.com/en/article/2294625):** card products (Rain, Visa, Ramp, Stripe) already offer sub-cards, spending limits and restrictions; crypto stays relevant for cross-border, large transfers, privacy and reliability. The pitch must say what on-chain adds beyond a cap: the supplier verifies escrow, approval is per-PO and signed, policy changes are public events (BUILD_ANALYSIS §4.3).
- **Warwick (Oct 8, https://www.kucoin.com/news/insight/BTC/6ac8255e38a2640007933ff7):** ran ten AI trading agents; "the 10 agents are not generating alpha". Sceptical of agent hype; show reliability and a human in the loop.
- **Mumtaz:** council appointment Oct 15 (https://www.theblock.co/news/business/2026-10-15-helius-ceo-mert-mumtaz-joins-near-foundation-council-418656), "will judge the upcoming hackathon". No new agent statements.
- **Lazzarin, Garg, Gershuni:** nothing newer found. a16z crypto was renamed a16z Frontier on Oct 23; Lazzarin named as a fund leader.
