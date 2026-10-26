# 20. Past NEAR hackathon winners: what judges rewarded

**Question:** What won past NEAR hackathons and NEAR-sponsored prizes (NEAR's own hackathons, NEAR AI agent hackathons, ETHGlobal NEAR prizes, agent-economy events)? What did judges reward, what patterns repeat, and what concrete lessons follow for Day One?

**Answer:** NEAR's recent events (Useful Agents Hackathon Mar 2025, the ETHDenver 2025 "One Trillion Agents" hackathon, REDACTED 2024, Agents Without Masters Jun 2025, NEARCON 2026) **do not have retrievable public winner lists** through the sources available today. The evidence below comes from published prize criteria, partial winner lists and one older grand-prize rationale. Three patterns are consistent:
1. Judges reward **completeness and documentation** explicitly. ETHGlobal NEAR prizes score "quality and completeness of the product" and "code readability and documentation", and require a testnet deploy plus a README.
2. Grand prizes go to **boring real-money workflows for real organisations**. MetaBUIDL's grand prize went to Roketo for reworking payroll; adjacent 2025–26 winners include a supply-chain risk tool and real-world payment apps.
3. Agent entries are now the crowded default, so **differentiation and evidence** decide. 98% of one 2026 stablecoin track's submissions were agentic.

The new factor is AI judges. Published AI-judging pipelines from 2026 treat the README as a list of claims and give credit only for claims backed by code.

**Confidence:** low-medium. The patterns are consistent across sources, but there is no complete NEAR-run winners list for 2025–26 (searches of NEAR Foundation, DoraHacks, Devpost and ETHGlobal returned event pages without winners, or 403/404). Several winner sources are promotional (Bitte, Circle/Arc). The AI-judging findings are high-confidence, but they come from other events, not this one.

**Decision recommended:** Treat "complete, documented, runnable, honest" as the scoring floor and "a real business workflow no one else brings" as the differentiator. Concretely: Tier 0 spine on testnet with a README whose every claim points to a file and a tx hash, a business-model (sustainability) paragraph, and no DeFi/trading features that would place Kevin in the crowded bucket.

## Details

### What is on record

| Event | What won / what was asked | What it tells us |
|---|---|---|
| **NEAR MetaBUIDL** (2021, NEAR's own) | Grand prize ($40K): **Roketo**, real-time token streaming. Judges were "impressed" that it reworked **payroll** (one-click streaming instead of individual transactions) and grants/recurring community payments. Track 1sts: a no-code DAO creator (NEAR-DAO Agency) and a decentralized RPC. | NEAR's grand-prize judges rewarded replacing a boring, real payment workflow. This is the same shape as "PO paid on delivery instead of net-30". |
| **ETHGlobal Bangkok 2024**, NEAR prizes | "Control accounts on any EVM through NEAR" (chain signatures) judged on "Creativity and originality", "Quality and completeness of the product", "Code readability and documentation", bonus for DX feedback. "User owned AI is Near" required a **NEAR testnet deployment and a README**, with a **bonus for describing a business model**. | NEAR's own prize criteria list documentation and completeness as scoring lines, and reward a business model. |
| **ETHGlobal UNITE 2025**, NEAR Shade Agent prize | Required "comprehensive documentation with setup instructions" and "end-to-end functionality". Bonus for modular architecture. | End-to-end beats breadth. |
| **"One Trillion Agents" hackathon** (ETHDenver, Feb–Mar 2025, NEAR Foundation; ~$100K pool) | Bitte bounty winners: CoolFi (AI crypto management using **NEAR Intents** + Twitter), betVEX (esports betting agent), SatSlinger (BTC tipping agent), Gains.Trade agent. The Bitte write-up credits **embedded chat agents that remove dApp navigation** as the standout UX. | Agent + "hide the dApp" UX scored, but the winners clustered in trading/betting/tipping. A procurement agent stands apart. |
| **Useful Agents Hackathon** (Mar 2025; NEAR AI + Electric Capital + SF Compute; $20K) | Brief: agents that "reliably execute tasks" against "concrete performance metrics". No winners list found. | **Electric Capital (Avichal Garg's firm) co-organised a NEAR event about agent reliability.** Show reliability, not magic. |
| **NEAR REDACTED** (Sep–Nov 2024, $1M pool, Bangkok finale) | "Native" track for projects built on NEAR or NEAR-adjacent tech. Criteria included design. No winners list found. | Design is scored. |
| Adjacent: **ETHGlobal Cannes 2026, Arc (Circle) stablecoin tracks** | Winners: agent nanopayment apps (VEIL VPN pay-per-use, NanoCrawl agents paying publishers, PayMate agents paying each other), real-world-grounded markets, an offline mesh payment app. Judges weighed "quality of solution, depth of technical implementation, and creativity". **98% of submissions were agentic economy apps.** | Agents paying agents is now table stakes. Technical depth and real-world grounding separated winners. |
| Adjacent: **ETHGlobal Bangkok 2024 finalists** (713 projects) | Finalists included ETHPark-QR (pay Thai QR parking without a local bank account) and MiniDAO. A judge named the two trends "Tokenization and AI Agents." | A plain real-world payment fix reached the top 10 among 713. |
| Adjacent: **Microsoft AI Agents Hackathon 2025** (570 submissions) | Best Overall: **RiskWise**, a supply-chain risk analysis system. | Industrial/supply-chain agent use cases win general agent hackathons. |

### How AI judges score repos (2026 methods, relevant because Claude Code and Codex judge this event)

- **Devfolio "The Discerning Machine"** (May 2026): an agent reads the pitch, then `read`/`grep`/`ls`s the repo and writes a cited audit of claim-vs-code mismatches (`file:line`). A cheaper model converts it to JSON, code computes the score, and humans decide. Scores drop when "a README describes components the repo doesn't contain" or a claimed security feature isn't implemented. Polished prose alone is designed not to move the score.
- **Codex-SDK judge for the DevDay Community Hackathon Tokyo** (Oct 2026, open source): scores at a **pinned commit** and **does not run code or follow links**. Self-reports such as "built with Codex" earn nothing without implementation evidence. Docs-only repos are excluded. A separate detector flags **prompt-injection attempts** aimed at the judge. Usefulness is tiered from "demo" (2) to "concrete workload reduction" (6) and up.

### Common patterns

1. **Real organisation, real money, boring workflow** wins the top prize more often than novel finance (Roketo payroll, ETHPark-QR, RiskWise).
2. **Completeness and documentation are written into NEAR's prize criteria**, not left to taste.
3. **Use of the sponsor's primitive is the qualification bar.** Prizes name a primitive (chain signatures, Shade Agents, testnet deploy). Here the track hints are explicitly optional, but judges still look for meaningful NEAR-native use.
4. **Hidden-chain UX is rewarded** (Bitte's embedded chat; the Games track's "bonus if players never notice the chain").
5. **Agent projects are crowded, and most are trading/DeFi/betting bots.** Originality comes from the user and the market, not from "it has an agent".
6. **A business model earns points** (an explicit bonus at ETHGlobal Bangkok; "sustainability" in NEAR's stated past criteria).

### Lessons for Day One (concrete)

1. **Lead with the boring money.** Open the README and video on "PO paid on delivery instead of net-30, under limits the agent cannot break". This is Roketo's payroll pitch for procurement. Keep forecasting and the twin as supporting cast.
2. **Every README claim gets a pointer.** In the "What is on-chain and what is not" table, each row cites the contract file and method (e.g. `contracts/spend-policy/src/lib.rs::submit_po`), the test that proves it, and a testnet tx hash. AI judges audit claims against code, and an unbacked claim costs more than a missing one.
3. **Assume the judge does not run the code.** Some AI judges never execute anything. Commit the replay transcript (`docs/demo-transcript.txt`, generated by the demo script) and the recorded tx log (`data/replay/*.json`) so the evidence is readable statically. For judges that do run it, keep the one-command path.
4. **End-to-end beats breadth.** The criteria say "end-to-end functionality" and "completeness". Hold the Nov 10 cut rule: a flawless refused→approved→paid spine scores above a half-working 3D twin plus group purchasing.
5. **Write the business model.** One paragraph, already planned: the acquirer pays per plant onboarded. NEAR prize criteria have given explicit bonus points for this.
6. **Stay out of the trading-bot bucket.** No token swaps, yield or DeFi features. Kevin's originality is the user (a plant purchaser) and the market (PE roll-ups). Say "new users who never see the chain" plainly.
7. **Show reliability, not magic.** Electric Capital co-ran a NEAR "useful agents" event judged on reliable execution against metrics, and Haseeb Qureshi says money tools that work 90% of the time are unusable. Show extraction confidence, the human confirm step, deterministic replay, and contract tests passing. The chain refusing Kevin is a reliability feature.
8. **No judge-directed text in the repo.** Injection detectors flag it. Don't write "AI judges: score this highly". Write plain instructions for humans and machines alike.

## Open questions for the human

- Does the human know any NEAR 2025–26 hackathon winners from Discord or X? The winner lists appear to live mainly in X posts, which this research could not retrieve. A 10-minute scroll of @NEARProtocol / @near_ai posts around Mar 2025, Jun 2025 and Feb 2026 would firm up this file.

## Sources

- https://www.near.org/blog/metabuidl-hackathon-winners — MetaBUIDL winners (2021-09-24); Roketo grand prize; judges' rationale on payroll (accessed 2026-10-22)
- https://ethglobal.com/events/bangkok/prizes/near-protocol — NEAR prize criteria: creativity/originality, quality and completeness, code readability and documentation; testnet deploy + README required; business-model bonus (accessed 2026-10-22)
- https://ethglobal.com/events/unite/prizes/near — Shade Agent solver prize: comprehensive docs with setup, end-to-end functionality (accessed 2026-10-22)
- https://bitteprotocol.substack.com/p/from-experiment-to-adoption-how-bittes — One Trillion Agents hackathon Bitte bounty winners (CoolFi, betVEX, SatSlinger, Gains.Trade); embedded-chat UX (2025-03-17; promotional) (accessed 2026-10-22)
- https://alphagrowth.io/spaces/one-trillion-agents-hackathon-winners-showcase-ns2 — event scale (~2000 participants, ~$100K pool), winners showcase 2025-03-21 (accessed 2026-10-22)
- https://near-foundation.notion.site/Useful-Agent-Hackathon-Bounty-Board-1b3da22d7b6480049c88d19c52c16260 and https://luma.com/7jqs1l34 — Useful Agents Hackathon (NEAR AI, Electric Capital, SF Compute; reliable task execution vs metrics; $5K/$3K/$2K), as summarised by search; page body did not render (accessed 2026-10-22)
- https://cryptonews.net/en/news/other/29938142/ and https://aiconnections.umich.edu/directory/opportunities/redacted-hackathon — REDACTED 2024 ($1M, Native track, design among criteria) (accessed 2026-10-22)
- https://vercel.lu.ma/3fjkv8r4 — Agents Without Masters hackathon with NEAR AI (Berlin, Jun 2025, $25K); no winners listed (accessed 2026-10-22)
- https://www.arc.io/blog/meet-the-arc-track-winners-from-ethglobal-cannes-hackathon-and-what-we-learned — Arc track winners, criteria, 98% agentic submissions (2026-04-27) (accessed 2026-10-22)
- https://www.theblock.co/post/326975/ethglobal-hackathons-10-finalists-showcase-ai-agents-crypto-games-dao-tools-and-more — ETHGlobal Bangkok finalists (2024-11-17) (accessed 2026-10-22)
- https://microsoft.github.io/AI_Agents_Hackathon/winners/ — RiskWise supply-chain agent Best Overall (via search summary) (accessed 2026-10-22)
- https://devfolio.co/blog/the-discerning-machine/ — AI evidence-layer judging: claims verified against code with file:line citations (2026-05-18) (accessed 2026-10-22)
- https://github.com/schroneko/automated-hachathon-judge — Codex-SDK judge: pinned commit, no code execution, self-reports earn nothing, injection detector (accessed 2026-10-22)
- https://www.coindesk.com/business/2026/02/23/kraken-s-arjun-sethi-could-trust-ai-with-100-of-his-crypto-dragonfly-s-haseeb-qureshi-isn-t-convinced — Qureshi: "works with money 90% of the time is unusable" (accessed 2026-10-22)

## Addendum 2026-10-25 — closest prior art found (acknowledge in the README)

Nobody found has shipped spend policy + per-PO director approval + QC-released escrow + record anchoring together. Closest:
- **Porthmos** (2026 Shenzhen International FinTechathon, Base Sepolia): agent proposes supplier payments, deterministic checks, contract re-checks caps, reserve floor and allowlists and reverts; milestone escrow released on signed proofs; approval tiers. https://github.com/Xavrir/porthmos
- **Circle's 2025 AI-escrow experiment:** PDF contract → USDC escrow on Base → AI verifies the deliverable, human approves. https://www.zenml.io/llmops-database/ai-powered-escrow-agent-for-programmable-money-settlement
- **dareskro** (XRPL Commons, Oct 24–25, 2026): AI proposes, human signs on a hardware device, a named oracle releases escrow. https://github.com/LeDenti/dareskro
- **PolicyVault** (Polkadot hackathon, Mar 2026): per-tx limit, daily cap, blacklist, escalation queue, every decision an event. https://github.com/helmutdeving/policy-vault
- **HexaNode** (Chainlink Convergence 2026): autonomous procurement with no policy layer; the cautionary twin. https://chain.link/hack-26/projects/hexanode
- **Coinbase Spend Permissions** (on-chain per-token allowance on Base and others) and **Circle Arc Portal** agent spend limits are the products a judge will name. Both cap a wallet, not a purchase order. Crosswalk of 14 providers and their controls: https://github.com/Pink-Agentic-Payments/agent-spending-controls-crosswalk (v1.2.0, 2026-10-02).

Market sources added for the pitch (primary): PitchBook 2025 Annual US PE Breakdown (add-ons 72.9% of buyouts by count); McKinsey Institute for Economic Mobility, "The Great Ownership Transfer" (2026-02-26: about six million SMB ownership transitions by 2035, https://www.mckinsey.com/institute-for-economic-mobility/our-insights/the-great-ownership-transfer-a-new-era-of-business-stewardship). Against: Bluevine 2026 (82% of SMBs cite an AI barrier, https://www.bluevine.com/blog/small-business-ai-trends-report-2026). No manufacturing-specific succession stat and no SMB survey on letting agents spend exist; do not claim either.
