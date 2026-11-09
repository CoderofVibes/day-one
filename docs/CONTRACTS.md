# Contracts — Day One

**One** Rust contract on NEAR testnet, `spend-policy`, which holds the plant budget, enforces Kevin's limits, records approvals, escrows each PO, releases on QC and anchors records. Built and tested in WSL2. Design detail and alternatives are in research 03, 04, 08 and 09; the merge was decided by Tony on Oct 25 (OPEN_QUESTIONS #21, BUILD_ANALYSIS §4.2). This file is the build spec.

The escrow lives inside the policy contract: approved funds move from `budget` to `escrowed[po_id]` internally, so there is no cross-contract funding hop. The only token transfers out are the payout to the supplier and the refund to the treasury. Separation of duties is unchanged: each account's key reaches only its own methods, and no key can move tokens.

- `near-sdk` 5.29.1 (Rust ≥1.95), `cargo-near` 0.22.0, `near-contract-standards` 5.29.1, pinned with `=` in `contracts/spend-policy/Cargo.toml` (a caret range resolves to 5.30.0)
- Build: `cargo near build non-reproducible-wasm` (reproducible Docker builds are skipped to save disk)
- Tests: near-sdk unit tests (`testing_env!`) + near-sandbox 0.3.16 integration tests with a prebuilt FT wasm standing in for the token
- All amounts are `U128` strings in token base units (6 decimals). `$5,150.00` = `"5150000000"`.
- All access checks use `env::predecessor_account_id()`, never `signer_account_id()`. In a relayed meta-transaction the signer is the relayer (NEP-366).

---

## 1. Accounts

Root: `acme-holdings.testnet` (created by Tony Oct 27). Everything below except suppliers and the relayer is created by `npm run setup:testnet` (`scripts/setup-testnet.ts`; done Oct 28 for the Acme tree). Root-signed steps go through near-cli-rs `sign-with-keychain`, so the root key stays in Tony's OS keychain; new private keys go to the git-ignored `.near-credentials/testnet/` in the repo (`<account>.json` full access, `<account>.fc.json` function call), public ids and keys to `config/testnet-accounts.json`. Staff accounts are created by Plant B with both keys in one transaction, because a 0-NEAR account cannot pay to add its own key.

| Account | Role | Online key | Initial NEAR |
|---|---|---|---|
| `acme-holdings.testnet` | Acquirer, treasury, contract owner | none (human's local credentials) | rest of float |
| `plant-a.acme-holdings.testnet` | Facility A; creates and funds its Kevin and director (group purchasing, §9) | none | 0.8 (the Oct 28 account had 0.2; setup tops a plant up from root when it cannot fund its children) |
| `plant-b.acme-holdings.testnet` | Facility B (acquired); creates and funds the four accounts below | none | 1.5 |
| `plant-c.acme-holdings.testnet` | Facility C; creates and funds its Kevin and director | none | 0.8 |
| `kevin.plant-b.acme-holdings.testnet` | Kevin | FC: spend-policy `submit_po`, `submit_pooled_po`, `open_pool`, `join_pool`, `anchor`, `anchor_batch`, `open_sealed_round`, `award_sealed_round` (§9, §10); allowance 2 NEAR (cancelling is HQ's `cancel`, not Kevin's). A key made before a method was added is replaced by `setup:testnet` (same key pair, new methods) | 1 |
| `kevin.plant-a…`, `kevin.plant-c.acme-holdings.testnet` | "Kevin at Plant A", "Kevin at Plant C" (group purchasing) | FC: the same eight methods; allowance 0.5 NEAR | 0.5 |
| `director.plant-a…`, `director.plant-c.acme-holdings.testnet` | Each plant's director, approving its own share of a pooled PO | FC: spend-policy `approve_po`, `reject_po` | 0 |
| `director.plant-b.acme-holdings.testnet` | Linda, ops director | FC: spend-policy `approve_po`, `reject_po` | 0 |
| `receiving.plant-b.acme-holdings.testnet` | Tommy, receiving | FC: spend-policy `confirm_receipt` | 0 |
| `qc.plant-b.acme-holdings.testnet` | Priya, QC | FC: spend-policy `qc_release`, `qc_reject` | 0 |
| `spend-policy.acme-holdings.testnet` | The contract: policy, escrow, anchors, pools, credentials, sealed rounds | none after deploy | 8 (5 before the Oct 29 redeploy; the merged wasm is larger) |
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
| Day One Test USD (DTUSD) | our own NEP-141 contract, `contracts/dtusd` (built Oct 28 from `near-contract-standards`; whole supply minted to the treasury at init, no later minting), deployed to e.g. `dtusd.acme-holdings.testnet`. The same wasm is the token in the sandbox test. | Demo POs at realistic dollar amounts. Name "Day One Test USD", symbol DTUSD, 6 decimals, our own icon, never the USDC logo. |

**Decided Oct 25** (OPEN_QUESTIONS #22):
- The main demo deployment settles in **DTUSD**, so PO-1042 can be a real $5,150.00.
- **Bonus, never a gate (done Oct 29, `npm run usdc`):** a second deployment of the same wasm, initialized with **Circle USDC**, runs one complete small PO end to end (pH buffer ×2 at $9.50, total $19.00), recorded in replay mode, once Tony has collected testnet USDC.
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
    suppliers: LookupMap<AccountId, SupplierStatus>, // who Kevin may pay
}
pub enum SupplierStatus { Qualified, Conditional } // no entry = cannot be paid
pub struct AgentPolicy {
    name: String,                           // how refusals name the agent ("Kevin")
    plant: AccountId,                       // whose receiving and QC roles handle its POs
    per_po_limit: u128,
    monthly_limit: u128,
    categories: Vec<String>,
    approver: AccountId,                    // director for this agent's plant
    active: bool,
}
pub struct Approval { supplier, amount, category, po_hash, approved_by, approved_at, expires_at }
pub struct PoRecord { agent, supplier, amount, category, po_hash, period, status: PoStatus, approved_by: Option<AccountId>,
                      supplier_lot: Option<String>, funded_at, accepted_at, shipped_at, received_at, released_at }
pub enum PoStatus { Funded, Accepted, Shipped, Received, Paying, Released, Refunded, Cancelled }
pub struct PlantRoles { receiver: AccountId, qc: AccountId }
pub struct Anchor { kind, hash: String /* 64 lowercase hex */, prev: Option<String>, by: AccountId, at: u64 }
```

`approver` is per agent rather than a single contract-wide director, so Tier 1 can add Kevin agents for Plants A and C without a new contract. Period = calendar month `YYYYMM` from `block_timestamp`; exposed as `get_period()`.

### Methods

| Method | Caller | Deposit | Effect |
|---|---|---|---|
| `new(owner, treasury, token)` | init | — | — |
| `set_roles(plant, receiver, qc)` | owner | 1 yocto | which staff accounts confirm receipt and release for a plant |
| `set_agent_policy(agent, name, plant, per_po_limit, monthly_limit, categories, approver)` | owner | 1 yocto | emits `agent_policy_set`; the approver may not be the agent; replacing the approver revokes the old one's right to approve |
| `set_category_cap(category, monthly_cap)` | owner | 1 yocto | `category_cap_set` |
| `set_supplier(supplier, status)` | owner | 1 yocto | `Qualified`, `Conditional` or `null` (removes); `supplier_set` (added Oct 28: FICTIONAL_DATA §9 and the Nov 6 attack suite need the vendor rule enforced, not just Kevin's ranking). Since §3.1 a listed supplier is paid only with a live credential; `issue_credential` sets the status too |
| `pause_agent(agent)` / `resume_agent(agent)` | owner | 1 yocto | `agent_paused` / `agent_resumed` |
| `ft_on_transfer(sender_id, amount, msg)` | token, with `sender_id == treasury` | — | `budget += amount`, `budget_funded`; any other token or sender is refunded |
| `submit_po(po_id, supplier, amount, category, po_hash)` | a registered agent | none | checks below; on pass, record the PO as `Funded`, update counters, `budget -= amount`, `escrowed += amount`, emit `po_authorized` and `po_funded`. No cross-contract call. On fail, **panic** with a plain-language reason. |
| `accept_po(po_id)` | the PO's supplier | none | `Funded → Accepted`; `po_accepted` (decision #23) |
| `mark_shipped(po_id, supplier_lot)` | the PO's supplier | none | `Accepted → Shipped`, stores the supplier lot the packing slip must match; `po_shipped` |
| `confirm_receipt(po_id)` | the plant's `receiver` role | none | `Shipped → Received`; `po_received` |
| `qc_release(po_id)` | the plant's `qc` role | none | `Received → Paying`; `ft_transfer(supplier, amount)` with 1 yocto from the contract's balance; callback `on_payout` |
| `on_payout(po_id)` | private callback | — | success: `Released`, `escrowed -= amount`, `po_released`; failure (e.g. supplier not registered): back to `Received`, `payout_failed` |
| `qc_reject(po_id, reason)` | the plant's `qc` role | none | `Received → Refunded`: `escrowed -= amount`, `budget += amount` (internal, no transfer); the PO stops counting against its month's agent and category spend; `po_refunded` |
| `cancel(po_id)` | owner, before `Received` | 1 yocto | same internal refund and spend reversal; `po_cancelled` |
| `approve_po(po_id, supplier, amount, category, po_hash, refused_tx)` | an account named as `approver` in some agent's policy | none | stores a one-time approval (expires in 24 h); emits `po_approved` with `refused_tx`. Moves no money. `submit_po` accepts it only if `approved_by` is that agent's approver. |
| `reject_po(po_id, reason)` | approver | none | deletes any approval; `po_rejected` |
| `anchor(kind, ref_id, hash, prev)` | a registered agent; or a registered supplier, for kind `quote` and a `ref_id` ending in `/<its account>` only (Oct 28) | none | append-only; re-anchoring an existing `ref_id` panics; emits `record_anchored` |
| `anchor_batch(items)` (≤50) | a registered agent | none | same, in one call |
| `withdraw_budget(amount)` | owner | 1 yocto | returns unallocated tokens to treasury (demo reset) |
| Views: `get_agent_policy`, `get_spent`, `get_category_spent`, `get_po`, `list_pos(from, limit)`, `get_approval`, `get_budget`, `get_config`, `get_period`, `get_anchor`, `get_roles`, `get_category_cap`, `get_supplier` | anyone | — | — |

`submit_po` is a single-contract state change (about 10–20 TGas). `qc_release` needs about 50 TGas for the transfer and callback.

### `submit_po` checks (first failure panics with its message)

1. Agent registered and active — "Kevin is paused by HQ."
2. Category allowed — "Kevin isn't authorized to buy equipment."
3. `po_id` not already used.
3a. Supplier has a live credential (§3.1), in this order — none and not listed: "quickchem-direct.testnet is not an approved supplier; no approval can override this."; listed by `set_supplier` but no credential; revoked; expired; taken off the list; suspended; PO category not on the credential. Every one of these ends "no approval can override this." and runs before step 5, so no approval reaches past it.
4. Amount ≤ budget — "Plant budget is short by $X." No approval can override this.
5. If a matching, unexpired approval exists (same supplier, amount, category, po_hash): consume it, skip steps 5a–8, record `approved_by`.
5a. Conditional supplier — "PO-1043: delta-d-nutrition.testnet is a conditional supplier; director approval required."
6. Amount ≤ per-PO limit — "PO-1042: $5,150.00 exceeds Kevin's per-PO limit of $2,500.00; director approval required."
7. Agent monthly spend + amount ≤ monthly limit.
8. Category monthly spend + amount ≤ category cap.

The retry after approval is the identical call. Within-limit and approved POs share one code path.

**Separation of duties:** the director's key can only approve or reject. Only an agent can trigger funding, and only within rules or a matching approval. Neither can move tokens directly.

A `po_refused` event is logged immediately before the panic. Logs from aborted calls are kept: confirmed Oct 28 in the sandbox test (the refused `submit_po` outcome carries the `po_refused` log). Nothing depends on it, because the panic message itself is in the failed transaction's status.

### 3.1 Supplier credentials and reputation (Oct 28, OPEN_QUESTIONS #35 and #36; research 25)

Each approved supplier holds a **soulbound credential** that HQ issues: the PO categories it may sell and an expiry. The credential is the permission: `submit_po` step 3a refuses a supplier without a live one, and no director approval overrides that. The same record carries the supplier's **delivery history**, which the contract updates itself, and a contract rule turns a run of QC rejects into a suspension that only HQ lifts. The contract is its own NEP-393 registry (the standard's single-contract case), so SBT-aware tools read the credentials through the standard views and `nep393` events.

```rust
pub struct SupplierCredential {
    token: u64,                      // NEP-393 token id, one per supplier, from 1
    supplier: AccountId,
    categories: Vec<String>,         // raw_material, lab_chemical …
    issued_at: U64, expires_at: U64, // ns
    revoked: Option<Revocation>,     // { at, reason }; the token stays (NEP-393 revoke, no burn)
    reputation: Reputation,
}
pub struct Reputation { released: u32, rejected: u32, consecutive_rejects: u32,
                        last_outcome: Option<DeliveryOutcome>, last_po, last_at,
                        suspended_at: Option<U64> }
pub enum Standing { Approved, Conditional, Suspended, Expired, Revoked, NoCredential, NotListed }
```

**Storage is additive:** no field in the root struct. Credentials by supplier (`cred:s`), the token index (`cred:t`), the token counter (`cred:n`) and the suspension rule (`cred:r`) live under their own byte prefixes and are opened per call. No existing method signature changed. The supplier's status (`Qualified` / `Conditional`) stays in the existing supplier list.

| Method | Caller | Deposit | Effect |
|---|---|---|---|
| `issue_credential(supplier, status, categories, expires_at)` | owner | 1 yocto | first time: mints the token (`nep393` `mint`); again: renews it (`renew`), keeps the token id and the delivery record, lifts a revocation, does **not** lift a suspension. Lists the supplier with `status` (`supplier_set`); `credential_issued`. Needs a category and a future expiry. |
| `revoke_credential(supplier, reason)` | owner | 1 yocto | marks it revoked, takes the supplier off the list; `nep393` `revoke`, `supplier_set` (null), `credential_revoked`. Funded POs are untouched (HQ can `cancel`). |
| `reinstate_supplier(supplier)` | owner | 1 yocto | lifts a suspension and clears the run of rejects (totals stay); `supplier_reinstated` |
| `set_suspension_rule(consecutive_rejects)` | owner | 1 yocto | default 2, at least 1; `suspension_rule_set` |
| Views: `get_credential`, `get_supplier_standing` (standing, `may_be_paid`, status, credential), `get_suspension_rule` | anyone | — | — |
| NEP-393 views: `sbt_metadata`, `sbt_class_metadata` (class 1, "Approved supplier"), `sbt(issuer, token)`, `sbt_tokens(issuer, from_token, limit, with_expired)`, `sbt_tokens_by_owner(account, issuer, from_class, limit, with_expired)`, `sbt_supply(issuer)`, `sbt_supply_by_owner(account, issuer, class)` | anyone | — | times in **ms**; a revoked token reads as expired at its revocation |
| NEP-171 read views: `nft_token(token_id)`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply` | anyone | — | read only; no transfer, no NFT events (NEP-393 `SBTNFT`) |

**The record.** `qc_reject` adds a rejected delivery at once. A release counts in `on_payout` when the transfer succeeds, so a failed payout and the second release never count twice. `cancel` is not a delivery. A release ends a run of rejects but does not lift a suspension. When the run reaches the rule, the contract sets `suspended_at` and emits `supplier_suspended`. Each update emits `delivery_recorded`.

**Quote anchors** (§6) need a listed supplier whose credential is neither revoked nor expired; a suspended supplier may still quote.

**Staff words** (`server/src/erp-connector/credentials.ts`): Approved → "approved supplier"; Conditional → "approved supplier, director signs every PO"; Suspended, Expired, Revoked → "on hold: …" with the reason; no credential or not listed → "not an approved supplier". Token ids, categories and counts appear only behind the curtain.

**ERP sync** (docs/ERP.md): the connector reads the credential of every vendor the escrow can pay. ERP `approved` must match `Approved` on chain; `onHold` fits conditional, suspended, expired or uncredentialed; `blocked` fits anyone the contract will not pay. `npm run erp:reconcile` reports any disagreement and who fixes it. Kevin treats the vendor as on hold if either side says so. The ERP never makes a supplier payable.

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

- `dayone_spend_policy`: `budget_funded`, `agent_policy_set`, `category_cap_set`, `supplier_set`, `roles_set`, `agent_paused`, `agent_resumed`, `po_refused`, `po_authorized`, `po_approved`, `po_rejected`, `po_funded`, `po_accepted`, `po_shipped`, `po_received`, `po_released`, `payout_failed`, `po_refunded`, `po_cancelled`, `record_anchored`; supplier credentials (§3.1): `credential_issued`, `credential_revoked`, `delivery_recorded`, `supplier_suspended`, `supplier_reinstated`, `suspension_rule_set`; sealed rounds (§10): `sealed_round_opened`, `quote_sealed`, `quote_revealed`, `sealed_round_awarded`
- `nep393` (NEP-393 v1.0.0): `mint`, `renew`, `revoke` for the supplier credentials

`qc_release`'s callback now also logs `delivery_recorded` after `po_released`, and `qc_reject` logs it after `po_refunded`.

The behind-the-curtain view and the demo transcript print these events with explorer links.

---

## 6. Record anchoring

- What is anchored: confirmed batch records, ranges of the `lot_events` hash chain, receipts (packing-slip hash), and supplier quotes. Approvals and payments are already transactions, so they are referenced by tx hash, not re-anchored.
- Supplier quotes (Oct 28): each supplier agent anchors the fingerprint of its quote's terms from its own account as `ref_id = "<rfq>/<account>"`, kind `quote`, and sends Kevin the terms and the salt over the bus. The contract takes a quote anchor only from a supplier HQ has listed with a credential that is neither revoked nor expired (§3.1) and only under the caller's own account suffix, so a supplier can commit to a price but cannot squat another record's id, and an unqualified vendor's anchor (QuickChem) is refused. Kevin recomputes the fingerprint and ignores a quote that no longer matches what its sender anchored. `npm run verify` checks a quote file the same way as a batch record.
- Hash = `sha256(JCS-canonical JSON of the record + 16-byte salt)`. Salts stay off-chain; fictional fixtures ship with their salts so judges can verify.
- Genealogy: a batch record's canonical form includes the hashes of its input lots' latest events, so the anchor commits to its inputs.
- Cost: about 0.0016 NEAR of storage per anchor (paid from the contract balance; FC keys cannot attach deposits).
- Durability: stored in state, readable forever with a free `view` call. Plain RPC nodes forget old transactions after a few epochs, so verification must not depend on tx lookup.
- Production roadmap: Merkle-root batching per day.

Judge verification (no keys): `npm run verify -- <record>` canonicalizes, hashes, calls `get_anchor`, prints MATCH or MISMATCH and the explorer link. Editing one gram in the fixture produces MISMATCH.

---

## 7. Tests (minimum set, all must pass)

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
- a registered supplier anchors its own quote; another kind, another account's ref_id, `anchor_batch`, or an unregistered supplier panics
- confirm that `po_refused` log survives the panic (informational; confirmed Oct 28)

escrow (same contract):
- `accept_po` and `mark_shipped` only from the PO's supplier; anyone else panics; wrong order panics
- full path funded → accepted → shipped → received → released pays the supplier (sandbox, with FT wasm)
- release before receipt panics; wrong role panics; double release impossible
- payout to an unregistered supplier rolls back to `Received`
- QC reject returns the amount to `budget`; cancel before receipt does the same

supplier credentials (§3.1; `src/tests/credentials.rs`, `tests/credentials_sandbox.rs`):
- issue mints one token per supplier and lists it; re-issue renews the same token and keeps the record; issuing needs HQ, a category and a future expiry
- a listed supplier without a credential, a revoked, an expired, an unlisted or a suspended supplier, and a PO outside the credential's categories are each refused with their message, before and after a director's approval
- releases and rejects build the record; a failed payout does not count; two rejects in a row suspend; only HQ reinstates; HQ sets the rule
- a suspended supplier still quotes and its open POs still settle
- NEP-393 and NEP-171 views, including a revoked token reading as expired
- sandbox: the purchasing loop with credentials and the delivery record; the four credential attacks with the testnet account names, recorded to `data/attacks/credentials-sandbox.json` (`RECORD_CREDENTIAL_ATTACKS=1`; otherwise the test fails if the recording no longer matches the contract)

Commands are added to `AGENTS.md` when they first pass.

---

## 8. Deploy and reset

- `scripts/setup-testnet`: idempotent; creates sub-accounts, adds FC keys, registers storage, writes public account ids to `config/testnet-accounts.json` (committed) and private keys to gitignored credentials.
- `scripts/deploy`: builds in WSL2, deploys `spend-policy`, calls `new`, `set_roles`, `set_agent_policy` (Kevin: per-PO $2,500; monthly $60,000 across `raw_material`, `packaging`, `lab_chemical`; approver `director.plant-b…`), `set_category_cap` (`lab_chemical` $2,000), `issue_credential` (§3.1: Northgate and Ridgeway `raw_material`, Bayfront `lab_chemical`, all qualified, until 2027-10-31; QuickChem gets none and the script checks it holds none; on a redeploy over the Oct 28 state this is also the migration of the `set_supplier` approvals), registers token storage for the contract and the four suppliers, funds the budget from treasury.
- `scripts/reset-testnet` (`npm run reset:testnet`, built Oct 28): HQ `cancel`s every PO not yet received, `withdraw_budget` returns the budget to the treasury, then the contract account deploys an 8-byte empty wasm and deletes itself in one transaction (an account holding the 250 KB wasm is too large to delete), so `po_id` uniqueness and a changed state layout both start clean; setup and deploy then recreate it with the same key. It stops before deleting if a PO waits on QC or tokens remain. Supplier payouts stay with the suppliers (DTUSD is ours to mint). Dry run without `--yes`; `--contract` points it at a throwaway account.
- Contract accounts keep their full-access keys during the hackathon for redeploys. Deleting them to prove immutability is a post-hackathon step and is noted in the README.

---

## 9. Group purchasing (Oct 28, branch `group-buy`; docs/GROUP_BUY.md)

Several plants pool their need for one material into one RFQ and one pooled PO whose allocation lines charge each plant's share to that plant's own agent limits. Additive: new methods, new events and new storage only; no existing method or message changes.

### State

New state lives in two `LookupMap`s built on demand under **byte-string prefixes** (`b"gb:pool"`, `b"gb:lines"`), not in new fields on the contract struct, so a redeploy over the deployed testnet state needs no migration, and the single-byte `StorageKey` prefixes of the other maps can never collide with them.

```rust
pool_id -> Pool { pool_id, category, material, opened_by, opened_at, members: Vec<PoolMember>, po_id: Option<String> }
pub struct PoolMember { agent, plant, qty: U64 /* base units, for the record */, max_amount: U128 }
po_id   -> Vec<ShareLine { agent, plant, amount, approved_by: Option<AccountId> }>   // the funded allocation
```

### Methods

| Method | Caller | Effect |
|---|---|---|
| `open_pool(pool_id, category, material, qty, max_amount)` | a registered, active agent allowed `category` | opens the pool and records the caller's pledge: its quantity and the most it will pay for its share; `pool_opened`, `pool_joined` |
| `join_pool(pool_id, qty, max_amount)` | another such agent | adds or replaces that plant's pledge while the pool is open; `pool_joined` |
| `submit_pooled_po(po_id, pool_id, supplier, amount, category, po_hash, lines: [{agent, amount}])` | a pool member | checks below; on pass records one `PoRecord` (agent and plant = the caller's, `approved_by` none), stores the lines, closes the pool with `po_id`, charges each line's agent its share in `spent_agent`, the category the total, `budget -= amount`, `escrowed += amount`; emits `pooled_po_authorized` (with the lines) and `po_funded`. On fail, `po_refused` then **panic** with the reason. |
| `approve_po("<po_id>/<plant agent>", supplier, share amount, category, po_hash, refused_tx)` | that agent's approver | the existing method: a share approval is an approval keyed by the share. `reject_po` with the same key deletes it. |
| Views: `explain_pooled_po(agent, …same args…)` → `{ refusal, shares: [{ agent, plant, name, amount, approved_by, needs_approval }] }` (the same checks, read-only, so Kevin learns which directors to ask); `get_pool(pool_id)`; `get_pool_lines(po_id)` | anyone | — |

Receiving, QC, payout, `qc_reject` and `cancel` are unchanged: the pooled PO is an ordinary escrow record under the placing plant's roles. `refund` reverses each plant's share from the stored lines (a plain PO reverses its agent in full, as before).

### `submit_pooled_po` checks

Refused outright (no approval path): caller not registered or paused; pool unknown, already placed, or in another category; caller not a member; `po_id` already used; the supplier fails the §3.1 credential gate, exactly as in `submit_po` step 3a (not listed, no credential, revoked, expired, suspended, or not credentialed for the pool's category; Oct 29 review fix: until then only the listing was checked); no lines, more than 10, a duplicate agent, a non-member, a zero share, a share over that plant's pledge; shares not adding up to `amount`; `amount` over the budget; a line agent paused or not allowed the category; a share approval that is expired or does not match (supplier, amount, category, `po_hash`, that agent's approver).

Then per share, unless it carries a matching approval: conditional supplier; share over that agent's per-PO limit; agent's monthly spend plus share over its monthly limit. Then the category cap on the pooled total, for every share without an approval. If any share waits, the PO is refused with one message naming every waiting share, ending in "director approval required." so Kevin's existing refusal handling applies.

### Tests

`src/tests/group.rs`: 19 unit tests, one per refusal above plus the happy path, a suspended, revoked, expired and wrong-category supplier refused on a pooled PO, per-plant approvals, consumed and expired approvals, the monthly limit and category cap on shares, refunds by share, and the view. `tests/sandbox.rs` `group_purchasing_on_sandbox`: two plants, two directors, one escrow, one payout, a cancelled pool, on a local node with the DTUSD token.

## 10. Sealed quote rounds (added Oct 28, branch `sealed-bids`)

Kevin can ask for quotes as a sealed-bid round, so no one, Kevin included, can read a price before the deadline, and no supplier can change its price after seeing the others. The rules are the contract's; Kevin's ranking only refuses to look before they have done their work. Code: `contracts/spend-policy/src/sealed.rs`, its own `#[near] impl` block, event enum and storage prefix (`b"sealed:" + round_id`, raw storage, no field in the root state struct, so no migration).

| Method | Caller | Effect |
|---|---|---|
| `open_sealed_round(round_id, commit_secs, reveal_secs)` | a registered agent | stores the round: quotes sealed for `commit_secs` from now (the deadline), then opened for `reveal_secs`; each window 1 minute to 7 days; a `round_id` (the RFQ number) only once, no `/`; emits `sealed_round_opened` |
| `commit_quote(round_id, hash)` | a supplier with a status (`set_supplier`) | stores only `hash` = sha256 hex of the quote text, before the deadline, one per supplier; emits `quote_sealed` |
| `reveal_quote(round_id, quote)` | a supplier that sealed | from the deadline until the reveal window ends; `sha256(quote)` must equal the seal, and the text, JSON `{"record":{"rfq":<round_id>,"supplier":<caller>,…},"salt":…}`, must name the round and the caller; stores the text; emits `quote_revealed` |
| `award_sealed_round(round_id, supplier)` | the agent that opened the round | after the deadline, once every seal is opened or the reveal window is over, once, and only to a supplier whose quote was opened; emits `sealed_round_awarded` |
| `get_sealed_round(round_id)` | anyone (view) | the round with every seal (and, once opened, its text) plus `phase`: `sealed`, `revealing` or `closed`, at the block it is read in |

Refusals (each panics with the message): late seal "Quotes for RFQ-… closed at the deadline; this one came in late."; early reveal "RFQ-… is still sealed; quotes open after the deadline."; mismatched reveal "This quote does not match what <supplier> sealed for RFQ-…"; copied text "A quote must name this round and the supplier revealing it."; early award "RFQ-… is still sealed; no quote can be awarded before the deadline."; award to an unopened quote "<supplier> has no opened quote in RFQ-…; only an opened quote can win."; unapproved supplier "<account> is not an approved supplier and cannot quote."

- **Quote text.** The text sealed and revealed is the canonical JSON of the quote's terms with a 16-byte salt (`sealedQuoteText` in `server/src/quotes.ts`), so the seal equals the fingerprint a supplier anchors for a plain quote (§6). The contract hashes the text as given; it does not re-canonicalize.
- **What is public when.** Before the deadline the chain holds fingerprints only; the salt keeps a price from being guessed from its hash. After the deadline opened quotes are public in the reveal transactions and in state: that is the price of a round anyone can check.
- **Kevin.** `agents/kevin/src/sealed.ts`: `openedQuotes` throws while the round is `sealed`, ranks only opened quotes, re-checks each against its seal, and leaves an unopened quote void. The award is on chain; `submit_po` is unchanged and does not read it.
- **Time.** Windows are block time, from 1 minute to 7 days. The sandbox recording, fast-forwarded, kept the demo's two hours to seal and one to open; testnet cannot be fast-forwarded, so the recorded testnet round (`npm run sealed -- --live --record`, Oct 29) has three minutes to seal and ten to open, and staff see "2 sealed quotes, opened at 1:03 PM" on the demo clock.
- **Storage.** About 500 bytes per round plus about 350 per opened quote, paid from the contract balance (§6 price: about 0.005 NEAR per round with two quotes).
- **Keys.** Kevin's function-call key carries `open_sealed_round` and `award_sealed_round`; `setup:testnet` replaces an older key that lacks them (§1). Suppliers sign with their full-access keys, as for `accept_po`.
- **Tests.** 12 unit tests in `src/sealed/tests.rs`; `tests/sealed_round.rs` runs a round on a local node, fast-forwarded past the deadline, and its ignored `host_for_recording` test keeps that node up for `npm run sealed -- --record-sandbox`.
- **Judge check (no keys).** `npm run verify:round -- data/sealed/RFQ-2611-02.round.json`: every opened quote hashes to its seal, names its round and supplier, was sealed before the deadline and opened in the window, and the winner is one of them; for a testnet file one `get_sealed_round` view confirms the chain holds the same round. The committed round is the testnet one (`chain MATCH`).

## 11. Pay for what reached stock, and enclave-signed decisions (Nov 3; OPEN_QUESTIONS #48, #50)

Deployed Nov 3 as **v2** at `spend-policy-v2.acme-holdings.testnet` (v1 stays at `spend-policy.acme-holdings.testnet`, which testnet would not delete once its state grew; LESSONS). Plant B's threshold is $2,500; the attested signer is `0x3b753b4406613c5e70ae640508632b600424fa0c`. The USDC deployment (`spend-policy-usdc`) still runs v1's code.

Two additions in one contract version (docs/REFERENCE_IDEAS_PLAN.md, E and F). Every new argument is optional, so a caller that omits it gets the behaviour of §1–§10.

**E. Receipt-bound settlement.** `submit_po` takes `qty` (the ordered quantity in base units: mg, or each). `confirm_receipt` then takes `received_qty`, `receipt_hash` (the ledger receipt's fingerprint) and `lots` (the plant lot codes it posted); for a PO with `qty`, `received_qty` is required and may not be zero or more than ordered ("more than PO-x ordered"). `record_invoice(po_id, invoice_hash, amount)`, sent by the PO's agent once the PO is shipped or received, records the supplier's invoice once. `qc_release` pays the smallest of: the escrow, the escrow pro rata to `received_qty / qty` (freight included in the ratio), and the invoice amount. The rest goes back to the plant budget and to the agent's and category's spend, `settlement_adjusted` says how much and why, and `po_released` carries the amount actually paid. The ERP stays the books: the contract applies its own quantity and amount rule and never asks the ERP. Pooled POs (§9) keep paying in full: they take no `qty` and no invoice in this version.

**F. Enclave-signed decisions.** NEAR AI Cloud signs `<model>:<sha256 request>:<sha256 response>` with a secp256k1 key as an EIP-191 message (research 10); the contract recovers the signer with `env::ecrecover` (near-sdk's `unstable` feature; `src/attest.rs`). HQ registers the signing address it verified off chain (`npm run attest`) with `set_attested_signer(address, active)`. An agent policy may set `signed_above`: a PO above that amount needs `decision: { text, signature, response }` whose text recovers to a registered signer, whose response hashes to the text's response hash, and whose response contains `APPROVE <po_hash>`. A decision sent with any PO is checked the same way, and the PO stores the signed text. It verifies that the registered signer signed a response containing approval for the supplied PO hash. Limits, director authorization and supplier credentials are checked separately.

### V2 terms-binding boundary, verified Nov 7

The caller supplies `po_hash`. The contract does not reconstruct it from the submitted PO fields. Director approval compares supplier, amount, category and the supplied hash under the PO ID. The optional `qty` input is separate. The signed model response is also checked against that supplied hash.

The executable `v2_trusts_the_agent_to_bind_quantity_to_the_approved_hash` case in [settlement.rs](../contracts/spend-policy/src/tests/settlement.rs) submits an over-limit order for 700 kg, obtains approval and retries with 350 kg while keeping the hash, amount, supplier and signed decision. V2 accepts that retry and treats receipt of 350 kg as a full delivery. This is a trust boundary in the deployed design. Independently binding all submitted terms requires a versioned contract and client change, migration consideration and fresh recorded evidence.
