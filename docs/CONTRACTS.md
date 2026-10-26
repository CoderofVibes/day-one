# Contracts — Day One

**One** Rust contract on NEAR testnet, `spend-policy`, which holds the plant budget, enforces Kevin's limits, records approvals, escrows each PO, releases on QC and anchors records. Built and tested in WSL2. Design detail and alternatives are in research 03, 04, 08 and 09; the merge was decided by Tony on Oct 25 (OPEN_QUESTIONS #21, BUILD_ANALYSIS §4.2). This file is the build spec.

The escrow lives inside the policy contract: approved funds move from `budget` to `escrowed[po_id]` internally, so there is no cross-contract funding hop. The only token transfers out are the payout to the supplier and the refund to the treasury. Separation of duties is unchanged: each account's key reaches only its own methods, and no key can move tokens.

- `near-sdk` 5.29.1 (Rust ≥1.95), `cargo-near` 0.22.0, `near-contract-standards` 5.29.1
- Build: `cargo near build non-reproducible-wasm` (reproducible Docker builds are skipped to save disk)
- Tests: near-sdk unit tests (`testing_env!`) + near-sandbox 0.3.16 integration tests with a prebuilt FT wasm standing in for the token
- All amounts are `U128` strings in token base units (6 decimals). `$5,150.00` = `"5150000000"`.
- All access checks use `env::predecessor_account_id()`, never `signer_account_id()`. In a relayed meta-transaction the signer is the relayer (NEP-366).

---

## 1. Accounts

Root: `acme-holdings.testnet` (free on 2026-10-22; the human creates it before Nov 1 to avoid squatting). Everything below except suppliers and the relayer is created by `scripts/setup-testnet` from Nov 1.

| Account | Role | Online key | Initial NEAR |
|---|---|---|---|
| `acme-holdings.testnet` | Acquirer, treasury, contract owner | none (human's local credentials) | rest of float |
| `plant-a.acme-holdings.testnet` | Facility A | none | 0.2 |
| `plant-b.acme-holdings.testnet` | Facility B (acquired) | none | 0.2 |
| `plant-c.acme-holdings.testnet` | Facility C | none | 0.2 |
| `kevin.plant-b.acme-holdings.testnet` | Kevin | FC: spend-policy `submit_po`, `cancel_po`, `anchor`, `anchor_batch`; allowance ~2 NEAR | 1 |
| `director.plant-b.acme-holdings.testnet` | Linda, ops director | FC: spend-policy `approve_po`, `reject_po` | 0 |
| `receiving.plant-b.acme-holdings.testnet` | Tommy, receiving | FC: spend-policy `confirm_receipt` | 0 |
| `qc.plant-b.acme-holdings.testnet` | Priya, QC | FC: spend-policy `qc_release`, `qc_reject` | 0 |
| `spend-policy.acme-holdings.testnet` | The contract: policy, escrow, anchors | none after deploy | 5 |
| `spend-policy-usdc.acme-holdings.testnet` | Same wasm, initialized with Circle USDC, for the bonus real-USDC PO (§2) | none after deploy | 3 |
| `dayone-relayer.testnet` | Day One's relayer (vendor-owned, outside Acme's tree) | full access | 10 |
| `northgate-ingredients.testnet` | Supplier agent (qualified) | full access | 1 |
| `ridgeway-ascorbics.testnet` | Supplier agent (qualified, second source) | full access | 1 |
| `quickchem-direct.testnet` | Supplier agent (**not qualified**) | full access | 1 |
| `bayfront-labsupply.testnet` | Supplier agent (lab chemicals) | full access | 1 |

Supplier names are fictional; availability is checked by the setup script. Suppliers sit outside Acme's tree on purpose: neither side controls the other's account.

**Precise wording for the README:** the account tree is a naming and creation hierarchy. A parent has no control over a sub-account after creation. Authority comes from keys and from contract checks on the calling account (research 05).

Budget: about 35–45 testnet NEAR in total (research 05).

---

## 2. Token

The contracts are **token-agnostic**: the token account id is set at `new()` and checked on every `ft_on_transfer`.

| Token | Account | Use |
|---|---|---|
| Circle testnet USDC | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` | Real stablecoin proof run. Faucet: 20 USDC per address every 2 hours, CAPTCHA (human only). |
| Day One Test USD (DTUSD) | deployed by us, e.g. `dtusd.token.primitives.testnet` via the token factory, or the global FT contract | Demo POs at realistic dollar amounts. Name "Day One Test USD", symbol DTUSD, 6 decimals, our own icon, never the USDC logo. |

**Decided Oct 25** (OPEN_QUESTIONS #22):
- The main demo deployment settles in **DTUSD**, so PO-1042 can be a real $5,150.00.
- **Bonus, never a gate:** a second deployment of the same wasm, initialized with **Circle USDC**, runs one complete small PO end to end (pH buffer ×2 at $9.50, total $19.00), recorded in replay mode, once Tony has collected testnet USDC.
- If Circle grants a larger testnet allowance, the main deployment may switch to USDC and DTUSD is dropped.
- The README and the behind-the-curtain view name the token on every transfer. Amounts are never scaled.

Every account that holds tokens is registered with `storage_deposit` (0.00125 NEAR each) by the setup script: spend-policy, all suppliers, the treasury.

---

## 3. `spend-policy`

Holds the plant budget, enforces limits, records director approvals, funds escrow, and stores record anchors.

### State

```rust
pub struct SpendPolicy {
    owner: AccountId,                       // acme-holdings: config, pause, withdraw
    treasury: AccountId,                    // only allowed funder via ft_on_transfer
    token: AccountId,                       // USDC or DTUSD, set at init
    budget: u128,                           // unallocated token units held here
    escrowed: u128,                         // sum of funds held for open POs (budget + escrowed = token balance)
    roles: LookupMap<AccountId, PlantRoles>,// per plant: receiving and QC accounts
    agents: LookupMap<AccountId, AgentPolicy>,
    category_caps: LookupMap<String, u128>, // monthly cap per category
    spent_agent: LookupMap<(AccountId, u32), u128>,
    spent_category: LookupMap<(String, u32), u128>,
    approvals: LookupMap<String, Approval>, // po_id -> one-time approval
    pos: LookupMap<String, PoRecord>,       // po_id -> authorized PO
    anchors: LookupMap<String, Anchor>,     // ref_id -> record fingerprint
}
pub struct AgentPolicy {
    per_po_limit: u128,
    monthly_limit: u128,
    categories: Vec<String>,
    approver: AccountId,                    // director for this agent's plant
    active: bool,
}
pub struct Approval { supplier, amount, category, po_hash, approved_by, approved_at, expires_at }
pub struct PoRecord { agent, supplier, amount, category, po_hash, period, status: PoStatus, approved_by: Option<AccountId>,
                      supplier_lot: Option<String>, funded_at, accepted_at, shipped_at, received_at, released_at }
pub enum PoStatus { Funded, Accepted, Shipped, Received, Paying, Released, Refunding, Refunded, Cancelled }
pub struct PlantRoles { receiver: AccountId, qc: AccountId }
pub struct Anchor { kind, hash: [u8; 32], prev: Option<[u8; 32]>, by: AccountId, at: u64 }
```

`approver` is per agent rather than a single contract-wide director, so Tier 1 can add Kevin agents for Plants A and C without a new contract. Period = calendar month `YYYYMM` from `block_timestamp`; exposed as `get_period()`.

### Methods

| Method | Caller | Deposit | Effect |
|---|---|---|---|
| `new(owner, treasury, token)` | init | — | — |
| `set_roles(plant, receiver, qc)` | owner | 1 yocto | which staff accounts confirm receipt and release for a plant |
| `set_agent_policy(agent, per_po_limit, monthly_limit, categories, approver)` | owner | 1 yocto | emits `agent_policy_set` |
| `set_category_cap(category, monthly_cap)` | owner | 1 yocto | `category_cap_set` |
| `pause_agent(agent)` / `resume_agent(agent)` | owner | 1 yocto | `agent_paused` / `agent_resumed` |
| `ft_on_transfer(sender_id, amount, msg)` | token, with `sender_id == treasury` | — | `budget += amount`, `budget_funded`; any other token or sender is refunded |
| `submit_po(po_id, supplier, amount, category, po_hash)` | a registered agent | none | checks below; on pass, record the PO as `Funded`, update counters, `budget -= amount`, `escrowed += amount`, emit `po_authorized` and `po_funded`. No cross-contract call. On fail, **panic** with a plain-language reason. |
| `accept_po(po_id)` | the PO's supplier | none | `Funded → Accepted`; `po_accepted` (decision #23) |
| `mark_shipped(po_id, supplier_lot)` | the PO's supplier | none | `Accepted → Shipped`, stores the supplier lot the packing slip must match; `po_shipped` |
| `confirm_receipt(po_id)` | the plant's `receiver` role | none | `Shipped → Received`; `po_received` |
| `qc_release(po_id)` | the plant's `qc` role | none | `Received → Paying`; `ft_transfer(supplier, amount)` with 1 yocto from the contract's balance; callback `on_payout` |
| `on_payout(po_id)` | private callback | — | success: `Released`, `escrowed -= amount`, `po_released`; failure (e.g. supplier not registered): back to `Received`, `payout_failed` |
| `qc_reject(po_id, reason)` | the plant's `qc` role | none | `Received → Refunded`: `escrowed -= amount`, `budget += amount` (internal, no transfer); `po_refunded` |
| `cancel(po_id)` | owner, before `Received` | 1 yocto | same internal refund; `po_cancelled` |
| `approve_po(po_id, supplier, amount, category, po_hash, refused_tx)` | the agent's `approver` | none | stores a one-time approval (expires in 24 h); emits `po_approved` with `refused_tx`. Moves no money. |
| `reject_po(po_id, reason)` | approver | none | deletes any approval; `po_rejected` |
| `anchor(kind, ref_id, hash, prev)` / `anchor_batch(items)` (≤50) | a registered agent | none | append-only; re-anchoring an existing `ref_id` panics; emits `record_anchored` |
| `withdraw_budget(amount)` | owner | 1 yocto | returns unallocated tokens to treasury (demo reset) |
| Views: `get_agent_policy`, `get_spent`, `get_category_spent`, `get_po`, `list_pos(from, limit)`, `get_approval`, `get_budget`, `get_config`, `get_period`, `get_anchor` | anyone | — | — |

`submit_po` is a single-contract state change (about 10–20 TGas). `qc_release` needs about 50 TGas for the transfer and callback.

### `submit_po` checks (first failure panics with its message)

1. Agent registered and active — "Kevin is paused by HQ."
2. Category allowed — "Kevin isn't authorized to buy equipment."
3. `po_id` not already used.
4. Amount ≤ budget — "Plant budget is short by $X." No approval can override this.
5. If a matching, unexpired approval exists (same supplier, amount, category, po_hash): consume it, skip steps 6–8, record `approved_by`.
6. Amount ≤ per-PO limit — "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required."
7. Agent monthly spend + amount ≤ monthly limit.
8. Category monthly spend + amount ≤ category cap.

The retry after approval is the identical call. Within-limit and approved POs share one code path.

**Separation of duties:** the director's key can only approve or reject. Only an agent can trigger funding, and only within rules or a matching approval. Neither can move tokens directly.

A `po_refused` event is logged immediately before the panic. Logs from aborted calls appear to be kept (nearcore source); the first integration test confirms it. Nothing depends on it, because the panic message itself is in the failed transaction's status.

---

## 4. Escrow (inside `spend-policy`)

There is no separate escrow contract (decision of Oct 25, OPEN_QUESTIONS #21). Escrow is the `PoStatus` state machine in §3:

`Funded → Accepted → Shipped → Received → Paying → Released`, with `Received → Refunded` on QC reject and `Funded | Accepted | Shipped → Cancelled` by the owner.

- Funding is internal: `budget` decreases and `escrowed` increases in the same `submit_po` call that passes the policy checks. Nothing can fail between "authorized" and "funded".
- The supplier's agent signs `accept_po` and `mark_shipped` from its own account. Before shipping it reads `get_po` to see the funds are held (BUILD_ANALYSIS §4.3–4.4).
- Payout is the only outbound token transfer on the happy path: `ft_transfer(supplier, amount)` with 1 yocto from the contract's NEAR balance, followed by an `on_payout` callback that rolls back to `Received` if the transfer fails. A `Paying` status prevents a double release while the promise is in flight.
- Refunds on QC reject or cancel are internal (`escrowed → budget`); `withdraw_budget` returns tokens to the treasury.
- Invariant, asserted in tests: the contract's token balance equals `budget + escrowed` after every method.

The two-contract design (policy funds a separate escrow with `ft_transfer_call`) is kept in research 04 and 08 as history only.

---

## 5. Events (NEP-297)

One standard, version `1.0.0`, via `#[near(event_json(standard = …))]`:

- `dayone_spend_policy`: `budget_funded`, `agent_policy_set`, `category_cap_set`, `roles_set`, `agent_paused`, `agent_resumed`, `po_refused`, `po_authorized`, `po_approved`, `po_rejected`, `po_funded`, `po_accepted`, `po_shipped`, `po_received`, `po_released`, `payout_failed`, `po_refunded`, `po_cancelled`, `record_anchored`

The behind-the-curtain view and the demo transcript print these events with explorer links.

---

## 6. Record anchoring

- What is anchored: confirmed batch records, ranges of the `lot_events` hash chain, receipts (packing-slip hash). Approvals and payments are already transactions, so they are referenced by tx hash, not re-anchored.
- Hash = `sha256(JCS-canonical JSON of the record + 16-byte salt)`. Salts stay off-chain; fictional fixtures ship with their salts so judges can verify.
- Genealogy: a batch record's canonical form includes the hashes of its input lots' latest events, so the anchor commits to its inputs.
- Cost: about 0.0016 NEAR of storage per anchor (paid from the contract balance; FC keys cannot attach deposits).
- Durability: stored in state, readable forever with a free `view` call. Plain RPC nodes forget old transactions after a few epochs, so verification must not depend on tx lookup.
- Production roadmap: Merkle-root batching per day.

Judge verification (no keys): `npm run verify -- <record>` canonicalizes, hashes, calls `get_anchor`, prints MATCH or MISMATCH and the explorer link. Editing one gram in the fixture produces MISMATCH.

---

## 7. Tests (minimum set, all must pass by Nov 7)

spend-policy:
- within-limit `submit_po` moves funds from budget to escrow; token balance = budget + escrowed
- over per-PO limit panics with the exact message; state unchanged
- monthly cap and category cap panic
- paused agent panics; unauthorized category panics
- `approve_po` from non-approver panics
- approve then identical retry succeeds; approval is consumed
- mismatched amount or supplier after approval panics; expired approval panics
- relayed `approve_po` (signer = relayer, predecessor = director) passes
- `ft_on_transfer` from wrong token or wrong sender refunds
- anchor stores and emits; re-anchor panics; non-agent anchor panics
- confirm that `po_refused` log survives the panic (informational)

escrow (same contract):
- `accept_po` and `mark_shipped` only from the PO's supplier; anyone else panics; wrong order panics
- full path funded → accepted → shipped → received → released pays the supplier (sandbox, with FT wasm)
- release before receipt panics; wrong role panics; double release impossible
- payout to an unregistered supplier rolls back to `Received`
- QC reject returns the amount to `budget`; cancel before receipt does the same

Commands are added to `AGENTS.md` when they first pass.

---

## 8. Deploy and reset

- `scripts/setup-testnet`: idempotent; creates sub-accounts, adds FC keys, registers storage, writes public account ids to `config/testnet-accounts.json` (committed) and private keys to gitignored credentials.
- `scripts/deploy`: builds in WSL2, deploys `spend-policy`, calls `new`, `set_roles`, `set_agent_policy` (Kevin: per-PO $2,500; monthly $60,000 across `raw_material`, `packaging`, `lab_chemical`; approver `director.plant-b…`), `set_category_cap` (`lab_chemical` $2,000), funds the budget from treasury.
- `scripts/reset`: `withdraw_budget`, suppliers return tokens to treasury so the float recycles, new PO id prefix per run so `po_id` uniqueness holds.
- Contract accounts keep their full-access keys during the hackathon for redeploys. Deleting them to prove immutability is a post-hackathon step and is noted in the README.
