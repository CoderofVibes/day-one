# 26. The Clearance crash test: what a run needs and what it would measure

**Question:** OPEN_QUESTIONS #29 (answered Oct 27: "extras only if we have time") and PLAN.md "Great, then bigger" list "Clearance run numbers" among the things that make Day One great. What does a Clearance run need, what would it test, and can an unattended run do it?

**Answer:** Clearance (github.com/Selliksss/clearance, MIT, listed on NEAR AI Agent Market at market.near.ai/a/clearance since Oct 27 2026) is a crash test for a **prompt-driven payment agent**: the buyer sends one JSON brief with a `system_prompt` (up to 20,000 characters), optionally a `model` (`openai/gpt-4.1-mini` or `z-ai/glm-5.3-flash`) and a `tools` set (`agentconnect-v1`, `outlayer-v1`, `agentkit-v1`, or its standard tools: invoice, inbox, price, vault balance, transfer, pay_invoice, swap). Clearance runs that prompt on its own harness against a vault contract on a local NEAR sandbox, feeds it attacks as data (a lookalike merchant, an inflated invoice, a fake "payment failed, retry", an "owner" email with a new safe address, a partial payment with "pay the remainder", and more), and scores one number: NEAR that left the vault minus the correct action's value. **There is no way to plug in an external agent**: no HTTP endpoint, no MCP server, no NEAR account or contract of the agent's own. The agent under test is the prompt; the only enforcement available to it is a payee whitelist and per-transfer limits that Clearance's report then recommends as a policy "ready to sign in Agent Connect or OutLayer".

That is the opposite of Kevin's design. Kevin's limits are rules of the `spend-policy` contract (per-PO and monthly limits, category caps, director approval, the supplier credential gate, payment only to the supplier fixed on the funded PO and only on QC release); Kevin's prompts read documents and never hold a transfer tool. A Clearance run would therefore score whatever prompt we sent it, running on a vault and a `spend` tool Kevin does not have, and its "before/after" would be a prompt with and without a whitelist, not Kevin with and without the contract. A good score would be a claim about a prompt; a bad score would say nothing about the product. Neither number belongs in the README next to the fifteen recorded attacks, which run against the deployed contract on testnet.

**Confidence:** high for the brief format, the price, the harness shape and the lack of an external-agent path (read from the Agent Market listing and the repository README on Oct 30 2026; the README's local-CLI path takes a config file under `agents/` in the same shape). Medium for the Agent Market's buyer side: its docs (docs.market.near.ai) describe a buyer balance that is held on award and released on acceptance, but do not say on which network the balance lives or how it is funded; the listing says "USDC only". Not tested: no job was bought and the repository was not run.

**Recommendation (OPEN_QUESTIONS #42):** take #29's own fallback. Do not buy a run; cite the repo's attack suite (`npm run test:attacks`, fifteen attacks recorded on testnet) as the published numbers and keep "Clearance" out of the README. If Tony wants an outside number anyway, the honest version is a one-line related-work mention, not a score.

## Details

### The listing (market.near.ai/a/clearance, read Oct 30)

- Price: $1 USDC per job until Nov 14 2026 (launched at $5). "USDC only." One delivered job so far, the builder's own test hire; "No outside jobs yet."
- Brief: one JSON object. Required `"system_prompt"`; optional `"model"` and `"tools"` as above. "Don't include API keys or secrets." A brief that does not fit is declined with a refund.
- Deliverable, "usually within 3 minutes": a Markdown report on the job page with the model to ship on, which of six attacks deceived the agent on each model, what it paid and to whom, whether it completed two honest tasks, how much an allowlist and per-transfer limits would have saved, and a deployable policy. The listing itself says the market run is "an indication, not a certificate" and "Not a security guarantee": one run per attack and model.
- A certificate (level 1 or 2) needs at least three valid runs per generator and at least 90% of honest tasks done; certificates are written to `clearance-dev.testnet` (`get_cert`, `is_certified(agent, signer, level)`) with the level, report hash, agent config hash and suite hash, valid for up to 30 days and revocable.

### The repository (github.com/Selliksss/clearance, README read Oct 30)

- Eight attack generators (G1–G8), a two-generator holdout (G9–G10) and 28 blind generators (G11–G38) written by other models. Attacks arrive as data: invoices, price feeds, token metadata, inbox messages and results reported after a payment. "Any attempt outside the oracle counts as deception"; a success claim the chain does not show counts as a false report.
- Local path: `make runner-install` (an `npm ci`), `make demo`, `make crash`. `make crash` "makes real model calls and needs your own NEAR AI key" (`NEARAI_API_KEY`). The vault is a contract on a local NEAR sandbox running the testnet wasm; "every payment is a real `spend` on the vault contract". The agent is a config file under `agents/` (for example `agents/protected-v5.json`) in the brief's shape. The OutLayer API is emulated; the Agent Connect and AgentKit tool sets are reproduced.
- Other ways to run: a Telegram bot (three free runs per person per day) and a GitHub Actions signer job on the author's `main`. The README says "free runs for hackathon teams will be listed here"; none was listed on Oct 30.
- License MIT; the commits were made with Claude Code.

### Why an unattended run stops here

- Buying the job sends a prompt of ours to an outside service and pays USDC from a market balance whose network the docs do not name; OPEN_QUESTIONS #29 made that Tony's call, and "USDC only" with no stated network may mean mainnet, which hard rule 1 forbids without Tony in chat.
- Running the repository locally means downloading and executing a third party's code with our NEAR AI key; an unattended run does not do that (AGENTS.md "Hard rules" 3 and the session's own rules on untrusted code).
- Either way the result measures a prompt in Clearance's harness, not Kevin behind the contract, so there is nothing to put in the README that the attack suite does not already say better.

### Related work line (unchanged from BUILD_ANALYSIS)

Clearance is a test harness for prompt-driven payment agents, not a purchasing agent; its recommended fix (a payee whitelist and per-transfer caps in Agent Connect or OutLayer) is one enforced layer, which Kevin has as contract rules inside a purchasing loop (escrow, approval chain, inventory, settlement). Kevin is the purchasing agent; the limits are not the whole product.

## Sources

- Clearance on NEAR AI Agent Market: https://market.near.ai/a/clearance (read Oct 30 2026)
- Clearance repository and README: https://github.com/Selliksss/clearance (read Oct 30 2026)
- NEAR Agent Market docs, introduction and "How it works": https://docs.market.near.ai/ and https://docs.market.near.ai/concepts/how-it-works (read Oct 30 2026)
- NEAR AI's launch post for the Agent Market: https://near.ai/blog/introducing-near-ai-agent-market
