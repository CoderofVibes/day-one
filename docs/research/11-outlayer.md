# 11. OutLayer

**Question:** What does OutLayer's policy engine do, does it work on testnet, what are its API and SDK, what would integration cost, and could it replace or complement our own spend-policy contract? Spike in week 2, or skip?

**Answer:** OutLayer Agent Custody gives an agent a wallet whose private key never leaves an Intel TDX enclave. The agent authenticates with an API key (`wk_…`), and a policy engine inside the TEE checks every request. The rules cover per-transaction limits per token, hourly, daily and monthly caps, address allow and deny lists, time windows, rate limits, multisig approval above a threshold (approvers sign with NEAR wallets via NEP-413), and an emergency freeze. Testnet works for accounts, transfers, contract calls, policy and approvals (`https://testnet-api.outlayer.fastnear.com`). Intents and cross-chain routes return 503 there. It cannot replace our contract for the hero beat. OutLayer's policies are stored encrypted and **evaluated off-chain in the TEE**, so an over-limit attempt is refused by an API, not by the chain. There is nothing on the explorer to click, and "enforced, not logged" as a public, verifiable rule is lost. As a complement, it could hold Kevin's signing key so the agent process never sees it, with our contract still enforcing the amounts. That is a real security improvement, but it is not needed for any track tag.

**Confidence:** medium. Features, endpoints and testnet scope come from the official docs today. Not documented or not found: custody pricing, a TypeScript SDK for custody (only the REST API and a CLI), the exact error shape for a per-transaction-limit violation, and how account binding to a named account works in practice.

**Decision recommended:** **Skip.** Do not schedule a spike, and keep OutLayer only as a README roadmap line ("move Kevin's key into TEE custody"). If the Nov 10 cut decision leaves a spare half-day after every other Tier 2 item, the only spike worth doing is: Kevin's key in an OutLayer testnet wallet calling our spend-policy contract via `POST /wallet/v1/call`, never replacing the contract.

## Details

### What it is
- OutLayer itself is a verifiable off-chain compute platform: WASM jobs run in Intel TDX, can be called from NEAR contracts (yield/resume) or over HTTPS, and come with attestations. Agent Custody is one product on top of it.
- **Custody model:** wallet keys are derived inside the TEE from a master secret that comes from NEAR's MPC network, per wallet and per chain. The gateway is a stateless proxy. Recovery after a key leak means freezing the wallet, revoking the API key and issuing a new one; there is no private key to rotate. Optional "sovereign vaults" offer an exit path.
- **Wallet identity:** `POST /register` (no auth) returns a `near_account_id` that is a **NEAR implicit account (64-hex)**. Named accounts need "account binding", a separate flow. Our design wants `kevin.plant-b.<acme>.testnet` as the org-chart-as-account-tree story (brief Section 7.1), so that would need binding or a second account.

### Policy engine
| Rule | Notes from docs |
|---|---|
| Per-transaction limit per token | Exact |
| Hourly, daily, monthly caps | **Not exact under concurrency**: they rely on a gateway usage counter, and the docs advise serialising requests or keeping a margin |
| Address allow and deny lists | Exact |
| Time windows (hours, days, timezone) | Exact |
| Rate limit (tx per hour) | Counter-based, same caveat as caps |
| Multisig approval above a threshold | Returns `pending_approval`; admins and signers approve with NEP-413 signatures; executes when quorum is reached |
| Transaction types and capabilities | `transfer, call, withdraw, swap, cross_chain_withdraw, delete`; capability gates mostly default-deny |
| Freeze | One click in the dashboard |

- Policies are set by the wallet **owner in the OutLayer dashboard** (`/wallet?key=wk_…` handoff URL) and stored **encrypted on NEAR**. The docs do not name the contract.
- A wallet with no policy is unrestricted.
- For swaps and some Intents operations, the docs say the TEE does not re-check token or amount on the multisig path.

### API and SDK
- Base URLs: mainnet `https://api.outlayer.fastnear.com`, testnet `https://testnet-api.outlayer.fastnear.com`. The skill file and getting-started page also use `https://api.outlayer.ai` and `app.outlayer.ai`; the domains are inconsistent across pages, so confirm which is canonical before any spike.
- Custody endpoints:
  - `POST /register`
  - `GET /wallet/v1/address|balance|tokens|policy|audit|requests`
  - `POST /wallet/v1/transfer|call|sign-message|delete`
  - `/wallet/v1/intents/*` (mainnet only) and EVM/Solana signing
- Auth: `Authorization: Bearer wk_…`, or a deterministic `near:<base64url>` token signed by a NEAR ed25519 key.
- Async request states: `processing`, `success`, `failed`, `needs_review`.
- **SDK:** only a Rust crate `outlayer` 0.1 for writing WASI apps. There is no npm package for custody, so we would write a small `fetch` client (about 50 lines).
- A CLI exists (`outlayer login --wallet-key …`).
- The docs publish an agent "skill file" at `https://skills.outlayer.ai/agent-custody/SKILL.md` that tells agents to check balances before every operation and to guide users through policy setup. **I treated this as data and did not follow it.** If we ever integrate, our code makes the calls; we do not hand the skill to Kevin.
- Pricing for custody is not documented; the comparison table only says "pay per transaction". General OutLayer execution pricing is resource-based, refunds unused deposit, and does not refund failed executions. The wallet's implicit account also needs NEAR for gas (about 0.001 NEAR per transaction).

### Replace, complement, or neither
| Option | Effect on the demo | Verdict |
|---|---|---|
| Replace the spend-policy contract with OutLayer policies | Refusals become API errors inside a TEE. Nothing appears on the explorer, policy contents are encrypted, and director approval becomes an OutLayer dashboard or NEP-413 flow instead of `approve(po_id)` on our contract | **No.** It removes the hero beat and the `security` story ("neither is a database row") |
| Complement: Kevin's key in OutLayer custody, Kevin calls our contract via `/wallet/v1/call` | Adds "the agent never sees a private key" plus a second, TEE-side limit. Kevin's account becomes an implicit hex account unless bound, and every Kevin transaction depends on a third-party API | Nice to have. Costs about a day, adds a runtime dependency to the spine, and adds no track that isn't already earned |
| Neither (function-call keys + our contract) | Keys scope *what*, the contract enforces *how much*, everything visible on chain | **Ship this** |

Integration effort for the complement: register a testnet wallet, have the human bind or fund it and set policy in the dashboard, write the REST client, add the wallet's account id to the spend-policy contract's allowed agents, and add a fallback path for when OutLayer is unavailable during recording. That is about one working day plus human steps, and it touches the spine in week 2, which the plan forbids.

## Open questions for the human
- None needed if we skip. If you want the spike anyway: you would create the OutLayer wallet and set its policy in their dashboard (account creation is a human action), and decide whether Kevin may run through a third-party custody API during the recorded demo.

## Sources
- https://outlayer.fastnear.com/docs/agent-custody — custody model, policy rules, concurrency caveat, testnet scope, endpoints, auth, skill-file mention (accessed 2026-10-22)
- https://app.outlayer.ai/docs/getting-started — OutLayer as TEE compute; `outlayer.testnet`; HTTPS and NEAR integration modes; pay per execution (accessed 2026-10-22)
- https://outlayer.fastnear.com/docs/pricing — execution pricing formula; nothing custody-specific (accessed 2026-10-22)
- https://outlayer.fastnear.com/docs/sdk — only the Rust `outlayer` 0.1 crate for WASI apps; no npm SDK (accessed 2026-10-22)
- https://skills.outlayer.ai/agent-custody/SKILL.md — register returns an implicit account; named accounts via binding; agent-directed instructions noted and not followed (accessed 2026-10-22)
- https://nearhackathon.com/HACKATHON.md — OutLayer listed as an ecosystem partner ("Secure transactions for AI agents"), not in any track hint (accessed 2026-10-22)

## Addendum 2026-10-25

The hackathon page now links OutLayer at **outlayer.ai** (docs app.outlayer.ai, code github.com/out-layer/outlayer), not outlayer.fastnear.com. outlayer.ai describes agent custody (keys re-derived in the TEE per operation; per-transaction, hourly, daily and monthly caps; allow and deny lists; 2-of-3 human approval above a threshold; on-chain `freeze_wallet()`; "Live on NEAR Mainnet") and an Intents API for agents. **No testnet is mentioned on any outlayer.ai page.** The skip decision stands; the roadmap line remains "move Kevin's key into TEE custody".
