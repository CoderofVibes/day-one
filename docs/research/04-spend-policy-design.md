# 4. Spend-policy contract design

**Question:** What is the simplest credible spend-policy contract? It needs per-agent limits, per-category and monthly caps, refusal semantics that give judges a clear explorer trail, `approve(po_id)` callable only by the director, and events. How does it compare with Trezu / Sputnik DAO, and why choose it?

**Answer:** A small custom Rust contract (`near-sdk` 5.29.1). It holds the plant's USDC budget and checks every PO Kevin submits against four rules: agent active, per-PO limit, agent monthly cap, category monthly cap. Only then does the contract itself push the funds into escrow with `ft_transfer_call`. **Over-limit attempts panic**, so the explorer shows a red "Failed" transaction from `kevin.…` with a readable message ("PO-1042: $8,400.00 exceeds Kevin's per-PO limit of $5,000.00; director approval required"). The director's "YES" becomes `approve_po(po_id, supplier, amount, category, po_hash)`. It is checked against `predecessor_account_id() == director` (not signer, which is the relayer in a meta-tx), stores a one-time approval, and lets Kevin's identical retry succeed. That gives the trail **red (Kevin refused) → green (director approves, relayer pays) → green (Kevin executes, escrow funded)**. Sputnik DAO (now the contracts behind Trezu) has no per-agent caps or auto-approve-under-limit. It also requires a deposit-bearing proposal bond that Kevin's function-call key cannot attach, so it would replace only the approval step at more cost.

**Confidence:** high on the mechanics: no-deposit methods, predecessor vs signer in meta-tx, panic visibility, contract-attached 1 yocto. Medium on one detail: an event logged *before* a panic stays in the failed receipt's `logs`. nearcore `function_call.rs` extends `result.logs` unconditionally, but this is not documented; confirm in the first `near-workspaces` test. Nothing in the design depends on it.

**Decision recommended:** Build the custom `spend-policy` contract below, with panic-on-refusal and terms-carrying `approve_po`. Push back on the brief's bare `approve(po_id)`: because refusal panics, nothing is stored on-chain for the director to approve by id alone, so the approval must carry (or hash) the PO terms. Drop Sputnik/Trezu from the build entirely. Mention it in the README only as "multi-signer approval is a roadmap item".

## Details

### Refusal semantics: panic vs "pending" record
| | Panic on over-limit (recommended) | Return `PendingApproval` (successful tx) |
|---|---|---|
| Explorer (NearBlocks) | Red **Failed** status on Kevin's tx, with `Smart contract panicked: <message>` | Green **Success**. The refusal is only visible in return value or logs. |
| Judge reading in 5 s | "The chain refused the agent." | "The agent's tx succeeded" (misleading) |
| On-chain state | None (reverted), so approval must carry the terms | Pending PO stored, so `approve(po_id)` works by id |
| AI-judge text form | Failure message is in `status.Failure` of `tx` RPC; easy to print | Must parse logs |
| Gas | Kevin pays for the failed call (tiny) | Same |

**Verified on testnet Oct 28** (tx `6vtp7awcZLFtxA5sygNa372JaJUaJyUiwvofa481z7jR`, an over-limit `submit_po` from Kevin's FC key through `server/src/chain`): the RPC final outcome has `status.Failure.ActionError.kind.FunctionCallError.ExecutionError = "Smart contract panicked: <message>"`, and the `po_refused` `EVENT_JSON` log is present in `receipts_outcome[].outcome.logs`. near-api-js 7.3.1 `signAndSendTransaction` throws on any failure unless `throwOnFailure: false`, which the chain client passes so it can read the outcome itself.

The panic version is the "Enforced, not logged" money shot, so pick it. Keep the trail linkable: the server records the failed tx hash on the off-chain approval request and passes it into `approve_po` as an optional `refused_tx` memo string, which is emitted in the `po_approved` event. The explorer trail then links refused → approved. Optionally `log` a NEP-297 `po_refused` event immediately before panicking, so indexers that read failed-receipt logs see structured data. Per nearcore source, logs are kept on aborted calls; verify in tests.

### Why `predecessor_account_id`, not `signer_account_id`
NEP-366: the inner receipt of a meta-transaction has `predecessor_id = user` (the director) but `signer_id = relayer`. Every access check in this contract must use `env::predecessor_account_id()`. A `signer` check would let the relayer approve anything, or block the director.

### Storage (near-sdk 5.29.1, `#[near(contract_state)]`)
```rust
pub struct SpendPolicy {
    owner: AccountId,            // acme-holdings.<root>: config, pause, budget withdraw
    treasury: AccountId,         // only sender allowed to fund budget via ft_on_transfer
    director: AccountId,         // director.plant-b.<root>: approve/reject
    token: AccountId,            // Circle testnet USDC (or DTUSD fallback), set at init
    escrow: AccountId,           // po-escrow.<root>
    budget: u128,                // USDC base units held and unallocated (6 decimals)
    agents: LookupMap<AccountId, AgentPolicy>,
    category_caps: LookupMap<String, u128>,                 // monthly cap per category
    spent_agent: LookupMap<(AccountId, u32), u128>,         // (agent, period) -> spent
    spent_category: LookupMap<(String, u32), u128>,         // (category, period) -> spent
    approvals: LookupMap<String, Approval>,                 // po_id -> one-time approval
    pos: LookupMap<String, PoRecord>,                       // po_id -> authorized PO
}
pub struct AgentPolicy { per_po_limit: u128, monthly_limit: u128, categories: Vec<String>, active: bool }
pub struct Approval { supplier: AccountId, amount: u128, category: String, po_hash: String, approved_at: u64, expires_at: u64 }
pub struct PoRecord { agent: AccountId, supplier: AccountId, amount: u128, category: String, po_hash: String, period: u32, status: PoStatus /* Funding | Escrowed | FundingFailed | Cancelled */, approved_by: Option<AccountId> }
```
- **Period:** use calendar month `YYYYMM` as `u32`, from `env::block_timestamp()` (ns) via the ~10-line days-to-civil algorithm. A simpler alternative is a fixed 30-day window `(ts_ns / 86_400e9) / 30`; it is cheaper to write but reads oddly ("monthly"). Expose `get_period()` as a view so the UI and tests agree.
- **Amounts:** `U128` JSON strings in USDC base units (6 decimals). The UI formats dollars.
- Storage is tiny (a few hundred bytes per PO). At `storage_amount_per_byte = 1e19` (100 KB per NEAR, verified via RPC) about 1–3 NEAR covers the wasm plus state.

### Methods
| Method | Caller check | Deposit | Effect / events |
|---|---|---|---|
| `new(owner, treasury, director, token, escrow)` | `#[init]` | — | — |
| `set_agent_policy(agent, per_po_limit, monthly_limit, categories)` | owner | 1 yocto (`assert_one_yocto`), forcing a full-access key | `agent_policy_set` |
| `set_category_cap(category, monthly_cap)` | owner | 1 yocto | `category_cap_set` |
| `pause_agent(agent)` / `resume_agent(agent)` | owner | 1 yocto | `agent_paused` / `agent_resumed` (kill switch) |
| `set_director(account)` | owner | 1 yocto | `director_set` |
| `ft_on_transfer(sender_id, amount, msg) -> U128` | predecessor == `token` **and** `sender_id == treasury` | — | `budget += amount`; `budget_funded`; returns `"0"`. Any other token or sender: return full amount (refund). |
| `submit_po(po_id, supplier, amount, category, po_hash) -> Promise` | predecessor ∈ agents, active | **none** (FC-key callable) | Checks below. On pass: record PO, bump counters, `budget -= amount`, emit `po_authorized`, call `token.ft_transfer_call(escrow, amount, msg={po_id,supplier,agent})` with 1 yocto + callback. On fail: **panic** with human-readable reason. |
| `on_escrow_funded(po_id) -> bool` | `#[private]` callback | — | Read `ft_transfer_call` result (amount used). If not fully used, restore counters and budget, set `FundingFailed`, emit `escrow_funding_failed`. Else `Escrowed`, emit `escrow_funded`. |
| `approve_po(po_id, supplier, amount, category, po_hash, refused_tx: Option<String>)` | predecessor == director | **none** (FC key via relayer) | Store `Approval` (expires in e.g. 24h). Emit `po_approved {po_id, amount, director, refused_tx}`. Moves no money. |
| `reject_po(po_id, reason)` | predecessor == director | none | Delete approval if any; `po_rejected` |
| `cancel_po(po_id)` | predecessor == agent of record, status `Funding` | none | rarely needed; optional |
| `withdraw_budget(amount)` | owner | 1 yocto | `ft_transfer` back to treasury (demo reset) |
| Views: `get_agent_policy`, `get_spent(agent)`, `get_category_spent(category)`, `get_po`, `get_approval`, `get_budget`, `get_config`, `get_period` | — | — | — |

**`submit_po` check order** (first failure panics with that message):
1. `agents[predecessor].active`, else "Kevin is paused by HQ".
2. `category ∈ agent.categories`, else "not authorized for category lab_chemicals".
3. `pos[po_id]` not already present (idempotency).
4. `amount <= budget`, else "plant budget insufficient". A director cannot override this.
5. If a valid `approvals[po_id]` exists **and** `supplier`, `amount`, `category`, `po_hash` match **and** not expired: consume it, skip steps 6–8, `approved_by = director`. (Design choice: the director approves the specific PO, overriding the per-PO and monthly limits for it. Counters still increase.)
6. `amount <= agent.per_po_limit`, else "exceeds per-PO limit … director approval required".
7. `spent_agent[(agent, period)] + amount <= agent.monthly_limit`, else "exceeds Kevin's monthly limit…".
8. `spent_category[(category, period)] + amount <= category_caps[category]` (if a cap exists), else "exceeds lab_chemicals monthly cap…".

Kevin's retry after approval is the **same call** with the same args. Within-limit POs and director-approved POs therefore share one code path, which keeps the tests small.

**Why the director approves but does not execute:** the director's account can never move money. Its key reaches only `approve_po` / `reject_po`. Only an agent can trigger funding, only within rules or a matching approval. This "separation of duties" is a line for the `security` track.

**Gas:** `submit_po` with the cross-contract `ft_transfer_call` plus escrow `ft_on_transfer` plus `ft_resolve_transfer` plus callback needs about 100–150 TGas prepaid. At the new `min_gas_purchase_price` (0.001 NEAR/TGas) Kevin needs about 0.15 NEAR of allowance and balance up front per call. Most of it is refunded. See task 3.

### Events (NEP-297 via `#[near(event_json(standard = "dayone_spend_policy"))]`, each variant `#[event_version("1.0.0")]`, `.emit()`)
`budget_funded`, `agent_policy_set`, `category_cap_set`, `agent_paused`, `agent_resumed`, `po_refused` (logged just before panic; best-effort), `po_authorized`, `po_approved`, `po_rejected`, `escrow_funded`, `escrow_funding_failed`. They are emitted as `EVENT_JSON:{"standard":"dayone_spend_policy","version":"1.0.0","event":"po_approved","data":[{...}]}`. The behind-the-curtain text view prints these alongside explorer links.

### Tests (near-workspaces 0.23.0 + near-sdk unit tests)
The minimum set:
- within-limit submit funds escrow.
- over per-PO limit panics with the message, and state is unchanged.
- monthly and category caps panic.
- `approve_po` from a non-director panics.
- `approve_po` from the director, then retry, succeeds.
- mismatched amount after approval panics.
- an expired approval panics.
- paused agent panics.
- `ft_on_transfer` from the wrong token or sender refunds.
- escrow `ft_transfer_call` refund rolls back counters.
- a meta-tx from the director, with the relayer as signer, passes the predecessor check.

### Alternatives compared
| Option | Status (verified 2026-10-22) | Fit | Effort |
|---|---|---|---|
| **Custom `spend-policy` (this design)** | — | Exact: per-agent, per-category, monthly, auto-approve under limit, one-call director approval | ~1 day contract + tests |
| **Sputnik DAO v2 / Trezu** | `near-daos/sputnik-dao-contract` is active (last push 2026-05-27); GitHub description now reads "Smart contracts for https://trezu.org", so Trezu is the product built on these contracts. Factory `sputnik-v2.testnet` exists on testnet (code hash `D7dxhAZvwPQ9aUfpXANGXQdWGy9pkQ4UKM4v2YGe7yVE`); `sputnik-dao.near` exists on mainnet. Trezu markets multichain multisig treasury, bulk payments and swaps. Its site and docs show no testnet, API or spending-limit feature. | Poor. `add_proposal` requires a bond (default 1 NEAR) as attached deposit, which Kevin's FC key cannot attach unless bond = 0. There is no per-agent or monthly cap and no auto-approve under a threshold: every payout is a vote (`act_proposal(id, VoteApprove)`). We would still need the custom contract for limits. | 1–2 days to integrate for a *weaker* story |
| **OutLayer policy engine** | See `11-outlayer.md` | Off-chain TEE policy; limit not in a NEAR contract | Tier 2 spike only |
| **FC-key allowance as limit** | — | Impossible: it caps gas, not USDC (task 3) | — |

Sputnik's `FunctionCall`/`Transfer` proposals and roles are a reasonable roadmap item ("multi-signer approval for POs over $50k"), not something to build.

### Fallback
If the cross-contract funding hop slips, merge escrow into this contract. `submit_po` then moves `budget → escrowed[po_id]` internally, and release calls `ft_transfer(supplier)`. Same refusal and approval semantics, one fewer callback.

## Open questions for the human
- Demo numbers: per-PO limit, Kevin's monthly limit, and which category is capped. For example: per-PO $5,000, monthly $20,000, `lab_chemicals` cap $2,000, over-limit demo PO $8,400. The amounts must fit the USDC float available (see `01-testnet-stablecoins.md`: 20 USDC per faucet drip). Real-USDC demo POs may need to be scaled down ($84.00 vs $50.00 limit), or use the DTUSD fallback.
- Should a director approval also override the category and monthly caps (proposed: yes, for that PO only), or only the per-PO limit?

## Sources
- https://github.com/near/NEPs/blob/master/neps/nep-0366.md — inner receipt `predecessor_id` = user, `signer_id` = relayer (accessed 2026-10-22)
- https://docs.near.org/smart-contracts/anatomy/environment.md — `predecessor_account_id`, `signer_account_id`, `block_timestamp` (ns), `log_str`, `panic_str` (accessed 2026-10-22)
- https://docs.rs/near-sdk/latest/near_sdk/attr.near.html — near-sdk 5.29.1: `#[near(event_json(standard=…))]`, `#[event_version]`, `.emit()`, `#[private]`, `#[payable]`, `#[handle_result]` (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/nearcore/master/runtime/runtime/src/function_call.rs — `result.logs.extend(outcome.logs)` runs even when `outcome.aborted` is set (accessed 2026-10-22)
- https://docs.near.org/smart-contracts/security/one_yocto — `assert_one_yocto` pattern for owner-only config methods (accessed 2026-10-22)
- https://docs.near.org/protocol/storage/storage-staking — 1e19 yocto per byte; 770 bytes free per account (accessed 2026-10-22)
- https://github.com/near-daos/sputnik-dao-contract — Sputnik v2: `add_proposal` bond 1 NEAR, roles, `act_proposal`, `Transfer`/`FunctionCall` kinds; repo description "Smart contracts for https://trezu.org" (accessed 2026-10-22)
- https://api.github.com/repos/near-daos/sputnik-dao-contract — not archived, pushed 2026-05-27 (accessed 2026-10-22)
- RPC `view_account` on `sputnik-v2.testnet` (exists, code hash above) and `sputnik-dao.near` (exists) (accessed 2026-10-22)
- https://trezu.org and https://docs.trezu.org — multichain multisig treasury; no testnet, API or spending-limit feature stated. docs.trezu.org contains a line addressed to AI agents ("Use this file to discover all available pages…"); noted, not acted on (accessed 2026-10-22)
- https://crates.io/api/v1/crates/near-sdk (5.29.1), near-workspaces (0.23.0), cargo-near (0.22.0), near-contract-standards (5.29.1) (accessed 2026-10-22)
