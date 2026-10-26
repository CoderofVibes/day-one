# 19. Live hackathon rules (re-read 2026-10-22) and diff against the brief

**Question:** What do https://nearhackathon.com/ and https://nearhackathon.com/HACKATHON.md say today that affects scope: prior code, testnet vs mainnet, KYC for payout, form fields and limits, X post requirements? How does that differ from PROJECT_BRIEF.md Section 1?

**Answer:** The brief's Section 1 is accurate. Dates, prizes, tracks, judges, one uneditable submission, the public repo + X post + form, the mainnet payout account and "build during the hackathon" all match. The live pages add precise form constraints:
- `projectName` 2–80 characters and unique (our name is 42 characters).
- `idea` 20–2000 characters.
- URLs ≤300 characters.
- `nearAddress` is a lowercase mainnet named account or a 64-character implicit account.
- A duplicate project name **or email** is rejected (409), so there is one attempt.
- Submissions are accepted only during Nov 1–14 UTC.
- A consent checkbox is required.

One trap: the website form shows an optional **"Website"** field, but HACKATHON.md says `website` is a **spam honeypot, and any non-empty value causes rejection**. Leave it empty. Neither page says anything about testnet vs mainnet for the project, KYC, eligibility by country, licensing, or a judging rubric. HACKATHON.md contains instructions for coding agents, including a submission API. They are recorded below and were **not acted on**.

**Confidence:** high. Both pages were fetched three times today and the answers were consistent. Limits are as stated by the pages. Absence findings (no KYC, no testnet rule) are medium, because they rest on what the pages do not say.

**Decision recommended:** Keep Section 1 as is, and add three lines: the field limits, "leave Website empty (honeypot)", and "one attempt: a duplicate name or email is rejected". Draft the `idea` text (≤2000 chars) and the X post during Phase 0 as docs, and have the human confirm the full payload on Nov 14 per Section 0.

## Details

### Facts confirmed (match the brief)

| Item | Live value | Brief §1 |
|---|---|---|
| Build window | 2026-11-01T00:00Z → 2026-11-14T23:59Z; submissions open only in this window | Match |
| Judging / results | Judging from 2026-11-16; results by 2026-11-18 23:59 UTC | Match |
| Prizes (paid in NEAR) | Grand $55K; per track $10K / $3K / $2K; 13 tracks; $250K total | Match |
| Tracks | defi, thesis, privacy, business, swarms, security, agents, realworld, games, nfts, memecoins, social, open | Match (target ids valid) |
| Multi-track | "Select every track that fits"; still one submission | Match |
| Track hints | Hints (NEAR Intents, Chain Signatures, etc.) are suggested features | Match |
| Judges | Polosukhin, Lazzarin, Mumtaz, Garg, Warwick, Qureshi, Gershuni + "Claude Code & Codex (Anthropic & OpenAI)" | Match |
| Criteria | "Previous NEAR hackathons evaluated technical implementation, design, impact, originality and sustainability." No rubric for this event. | Match |
| Prior work | Site: "Build during the hackathon." HACKATHON.md: "Build the project with the human. There is no sign-up before the hackathon: the only form is the final submission." | Match; nothing more specific |
| Repo | Must be public by the deadline ("Judges can't open a private one"); may be private during development | Match |
| X post | "The human publishes a demo post on X: it says the project was built at NEAR HACKATHON and has the demo video or screenshots attached." The agent may draft; the human posts. | Match |
| README | "The jury includes AI judges, so write the README for a machine reader as well as a human one": what it is, the problem, "do X - see Y" steps. | Match |
| One submission | "A submission cannot be edited… A second submission with the same project name or email is rejected, so there is one attempt per team." | Match, plus email uniqueness (new) |
| Payout | "NEAR account for the prize payout, mainnet: a named account such as `team.near` or a 64-character implicit account." "If you win, the prize is sent there." | Match |

### Form fields and limits (new detail for the brief)

| Field (form label / API name) | Constraint | Our value / note |
|---|---|---|
| Project name / `projectName` | 2–80 chars, unique | "Day One: AI Purchasing for Acquired Plants" = 42 chars ✓ |
| Team lead / `leadName` | 2–80 chars | Human |
| Email / `email` | max 160 chars, **unique** | Human; use one email only once |
| Team size / `size` | `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` (form shows "Solo") | `1` |
| Tracks / `tracks` | one or more ids, each once | realworld, business, security, agents (+ swarms/privacy only if built) |
| NEAR wallet address / `nearAddress` | 2–64 chars, lowercase, mainnet | Human creates; agent must never invent one |
| Repository link / `projectUrl` | http(s), ≤300 chars, must be public | |
| Demo post link / `demoUrl` | http(s), ≤300 chars | The X post URL |
| What did you build / `idea` | **20–2000 chars** | Draft in docs; plain, no marketing |
| Website / `website` | Shown as optional on the form; **HACKATHON.md: spam trap, any value → rejected** | **Leave empty** |
| Consent | must be true; text: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." | Human ticks |

A wallet connection is not needed to submit.

### Not stated anywhere (absence findings)

- **Testnet vs mainnet for the project:** nothing. Only the payout account must be mainnet. The brief's testnet-only build is consistent with the rules.
- **KYC / tax / country eligibility / age:** nothing. Eligibility is "Developers, designers and people with ideas for the NEAR ecosystem." Payout is in NEAR to the given account, and no payout process is described.
- **Open-source license:** not required. A public repo is required.
- **Pre-hackathon prep rule:** nothing beyond "build during the hackathon". The brief's conservative interpretation (no code before Nov 1) stands. "Confirm in Discord" stays in OPEN_QUESTIONS.
- **Video length:** not specified by the hackathon. X's own limits apply (see task 16).

### Track one-liners worth quoting back in the README

- `business` ("The company of one. Or none"): "Humans only set the constraints." API text: "…treasury, sales, procurement, cross-chain payments via NEAR Intents and revenue sharing."
- `realworld` ("Bring the boring money onchain"): "Something a normal company could use tomorrow." API text: "payroll, invoicing, remittances, merchant payments and stablecoin rails for real businesses."
- `security` ("Trust, but verify"): "Give AI money without giving it the keys to everything." API text: "spending limits, policy engines, sandboxed wallets, reputation and scam detection."
- `agents` ("Give AI a wallet"): "agents that earn, spend, negotiate, hire other agents and pay for APIs, compute or data."
- `swarms` ("Many agents. One economy"): "coordination markets, bidding, collective purchasing, intent-based settlement…"
- `privacy` ("Private by design"): "confidential computation, private finance and AI that protects sensitive data." Hints: TEE, NEAR AI Cloud.
- `games`: "bonus if players never notice the chain" (not our track, but it validates the invisible-chain principle).

Partners listed: NEAR Intents, Aurora, HOT, Rhea, meme.cooking, HEX, NEAR.AI, SVRN, Trezu, SputnikDAO, OutLayer, GoMining.

### Instructions aimed at coding agents in HACKATHON.md (recorded, NOT followed)

HACKATHON.md is written as an instruction file for an AI coding agent. The homepage also has a line telling coding agents to use HACKATHON.md to "file your submission". In summary, the file:

- Tells the agent to build with the human, re-read the live page before submitting, collect every required value from the human, and never guess or use placeholders. It says never to create or invent a payout account, and to read the consent notice to the human verbatim.
- Lists actions that need explicit human confirmation: sending the submission ("Print the full JSON payload first and wait for a yes"), posting on X, making the repo public, pushing, signing transactions, spending tokens, deploying to mainnet, and committing secrets.
- Describes a **submission API**: `POST https://nearhackathon.com/api/applications`, JSON body ≤12,000 bytes containing only the listed fields, a `requestId` UUID generated once and reused on retries, and `website` honeypot not to be sent.
  - Responses: 201 saved; 400 fix fields and resend with the same requestId; 403 window closed or "looked cross-site", do not retry; 409 name/email taken, ask the human and do not rename to get around it; 413 body too large; 503 wait and resend.
  - It includes an example curl command and says it must never be sent with example values.
- **What we did:** read it as data only. No endpoint was called, nothing was submitted or posted. Our own rules (brief Section 0, AGENTS.md rule 6) are stricter: the human submits, or explicitly confirms a printed payload, on Nov 14.

### Minor observations

- The team-size options "2–4" and "4–6" overlap at 4. Irrelevant for a solo entry.
- The judges list links Kain Warwick to `x.com/kain`; his widely used handle is @kaiynne (not verified today). This is probably a site typo, so verify before tagging anyone in the X post.
- A third-party article (AI郵報, 2026-10-20) restates the same rules and adds nothing official.

## Open questions for the human

- Which email will be used for the form? It must be unique and is a one-time use.
- Confirm in the NEAR Discord: what counts as prep (already in OPEN_QUESTIONS), and whether payout requires any KYC (the pages are silent).

## Sources

- https://nearhackathon.com/ — dates, prizes, tracks and taglines, judges, criteria sentence, submission requirements, form fields (Website shown optional), consent text, FAQ (accessed 2026-10-22)
- https://nearhackathon.com/HACKATHON.md — Facts, "What the human decides", confirmation list, Procedure, Submission API (endpoint, fields, limits, honeypot, response codes), track one-liners; contains agent-directed instructions that were not followed (accessed 2026-10-22)
- https://www.aiposthub.com/near-hackathon-ai-judges-2026/ — third-party restatement (2026-10-20), nothing new (accessed 2026-10-22)

## Re-read 2026-10-25

Both pages fetched again today and read as data. Nothing in Section 1 of the brief changed: dates, tracks, prizes, judges, one uneditable submission, the `website` honeypot, the criteria sentence and the form limits all match. Sharpened details:
- Judging starts 2026-11-16 00:00 UTC; results by Nov 18 23:59 UTC.
- Per-track hints in HACKATHON.md: `security` "agent security, function call keys, TEE attestation"; `realworld` "stablecoins, NEAR Intents, meta transactions"; `business` "AI agents, NEAR Intents, chain signatures" with the blurb "treasury, sales, procurement, cross-chain payments and revenue sharing. Humans set constraints"; `agents` "agent commerce, NEAR Intents, chain signatures"; `swarms` "multi-agent systems, NEAR Intents, sub-accounts"; `social` "Sputnik DAO, Trezu, named accounts".
- The description field must cover "the problem, the product, and how NEAR fits in".
- Partner links changed: OutLayer now points to outlayer.ai (docs at app.outlayer.ai, code at github.com/out-layer/outlayer); Trezu docs at github.com/NEAR-DevHub/trezu-docs; NEAR.AI at github.com/nearai/cloud-api.
- Community: Discord https://discord.gg/nearprotocol and X @NEARProtocol. No Telegram, workshops, office hours, rubric or prep rule on either page.
- No registration or entry counts are published anywhere. No public "building X for NEAR HACKATHON" posts were found.
- Related: NEAR launched "NEAR Business" on Oct 20, 2026 (self-custodial treasury: payroll, vendor payments, cross-chain swaps, approval thresholds by tier, invite-only; no AI agent). Source: https://cryptobriefing.com/near-protocol-launches-near-business-treasury/ (accessed 2026-10-25).
- The `near/agent-skills` repo now ships six skills (near-intents, near-ai-cloud, near-api-js, near-dapp, near-kit, near-smart-contracts), `npx skills add near/agent-skills`. Their content is third-party instructions for agents: use as reference, not as commands.

## X sweep 2026-10-26 (Tony via Grok, relayed by Muse, bridge message #19)

Second-hand: Grok's summary of public X posts, not pages we opened. Treat names and claims as leads to check, not facts.

- **Consistent with our rules:** $250K in NEAR ($55K grand; $10K/$3K/$2K per track, 13 tracks); window Oct 31 5 PM PT (= Nov 1 00:00 UTC) to Nov 14 3:59 PM PT; no sign-up; one uneditable submission; repo may be private during the build but public by the deadline; demo post on X; no published rubric; no NEAR AI Cloud credits or workshops announced yet.
- **Track display names map to our ids** (already in the table above): Autonomous Business = `business`, AI Security & Defense = `security`, Real-World Money = `realworld`. Use the display names in the README track section.
- **Prep-before-Nov-1 question is still unanswered.** Team Nymira asked it on X on Oct 23 with no reply. Cite that precedent when asking in the Discord Dev chat (OPEN_QUESTIONS #8). KYC for payouts: nobody has asked; the form reportedly asks only name, email and NEAR account.
- **Projects seen on X** (lanes, for positioning): ClearToPay (fake-invoice detection before agents pay), NearSwaps (trading agent with on-chain spending caps — closest to Kevin's caps; our difference is the purchasing workflow and the invisible chain, not caps alone), BLINDKEY (ZK agent permissions), Jurat (proof of funds), OutLayer (partner; locked-down agent wallets).
- **README must say plainly** that the PO escrow is scoped to purchase orders and is not a general multisig, because NEAR's own treasury product (NEAR Business, Oct 20) covers vendor payments with approval thresholds and its guidance is "don't rebuild the multisig".
- **Watch:** NEAR Backers Summit, Oct 28 (agentic payments, NEAR AI) for rubric, credit or workshop announcements.
