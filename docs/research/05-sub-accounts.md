# 5. Sub-accounts: acquirer → plant → agent

**Question:** How do we model the org chart as a NEAR account tree (acquirer → plant → agent / staff)? What do account creation and storage cost now? How do we create accounts from a script, and what are the testnet faucet limits? What is the full account list for the demo, and can a top-level `.testnet` account be created without a wallet UI?

**Answer:** Named sub-accounts map one-to-one onto the org chart. **Only the direct parent can create a sub-account**: `plant-b.acme-holdings.testnet` creates `kevin.plant-b.acme-holdings.testnet`. **The parent has no control over the child afterwards**; control is purely by keys. Since NEP-642 (live on mainnet protocol 86 and testnet protocol 88), every account creation costs a fixed **0.007 NEAR** (`account_creation_charge`, verified via RPC), paid by the creator through the gas surplus. Each account gets **770 bytes free** (zero-balance accounts), enough for a couple of keys. So staff accounts that only act through the relayer can hold **0 NEAR**, while contract accounts need storage stake at 1e19 yocto/byte (~1 NEAR per 100 KB). A top-level `.testnet` account **can** be created without a wallet UI: `near account create-account sponsor-by-faucet-service <name>.testnet …`, or programmatically by calling `create_account` on the `testnet` account contract from any funded account (near-api-js `account.createAccount`). Sub-accounts are a `[CreateAccount, Transfer, AddKey]` batch signed by the parent (near-api-js `account.createSubAccount`).

**Confidence:** high on the hierarchy rules, the 0.007 NEAR charge, storage price and the 770-byte allowance (docs plus live RPC), and on the scripted-creation APIs (near-api-js 7.3.1 source, near-cli-rs 0.30.1 source and docs). Low on faucet amounts and rate limits: no official number is published, and the only figure found (10 NEAR per request, 1 request per 24 h) is from a third-party listing.

**Decision recommended:** One top-level root, `acme-holdings.testnet` (currently unregistered; verified via RPC), with plants and contracts as sub-accounts and people/agents under their plant. Suppliers are **separate top-level accounts** outside Acme's tree, which is the neutrality story. The relayer belongs to the software vendor (`dayone-relayer.testnet`), not to Acme. The human creates two top-level accounts with near-cli-rs via the faucet. Everything else is created from Nov 1 by an idempotent `scripts/setup-testnet` that reads keys from a git-ignored credentials directory.

## Details

### Rules (docs.near.org account-id; nearcore config)
- `near` / `testnet` can create `bob.testnet`; `bob.testnet` can create `app.bob.testnet`; **nobody else** can create `app.bob.testnet`. "A parent account has no control over its sub-accounts"; they are "different entities". So "the org chart is the account tree" is a *naming and creation* hierarchy. Authority still comes from keys and from contracts that check `predecessor_account_id`. Say this precisely in the README.
- Account IDs: 2–64 chars, lowercase `a-z 0-9 - _`, `.` separators. `kevin.plant-b.acme-holdings.testnet` is 35 chars.
- Top-level names (no dot) need ≥ 65 chars or the `registrar`: `min_allowed_top_level_account_length = 65`, `registrar_account_id = "registrar"` (live testnet config). `.testnet` names are therefore sub-accounts of `testnet`, created through its contract's `create_account(new_account_id, new_public_key)` method. near-cli-rs config names `linkdrop_account_id = "testnet"`.
- New in 2026 (not needed): `0u…` universal accounts (nearcore 2.14), deterministic accounts (`DeterministicStateInit`), global contracts.

### Costs (live testnet `EXPERIMENTAL_protocol_config`, 2026-10-22)
| Item | Value |
|---|---|
| `account_creation_charge` | 7e21 yocto = **0.007 NEAR** per account, burned. Deducted from the creator's gas-price surplus refund. Applies to `CreateAccount`, implicit, deterministic and cross-contract creation. |
| `min_gas_purchase_price` | 1e9 yocto/gas = 0.001 NEAR/TGas, so the creator needs more NEAR *up front* (refunded except the 0.007) |
| `gas_price` (burn) | 1e8 yocto/gas = 0.0001 NEAR/TGas |
| `storage_amount_per_byte` | 1e19 yocto = 100 KB per NEAR |
| Free storage per account | 770 bytes (zero-balance account allowance) |

**Per-account budget we recommend**
| Kind | Initial transfer | Why |
|---|---|---|
| Staff (director, receiving, QC) | **0 NEAR** | Only sign delegate actions; the relayer pays gas. Keys fit in 770 bytes. Shows judges "staff hold no tokens". |
| Kevin | 1 NEAR | Signs his own FC-key txs. Needs up-front gas at the purchase price (~0.15 NEAR per `submit_po`) and an FC allowance of about 2 NEAR (task 3). |
| Plants | 0.2 NEAR | Must pay 0.007 + up-front gas to create their children |
| Supplier accounts | 1 NEAR | Sign their own quote and accept txs; USDC `storage_deposit` 0.00125 NEAR |
| Contract accounts | 5 NEAR | wasm (~150–300 KB = 1.5–3 NEAR) + state + 1-yocto deposits |
| Relayer | 10 NEAR | Up-front gas for relayed txs (~0.05–0.1 NEAR each in flight, mostly refunded) |
| `acme-holdings` root / treasury | the rest | Funds the tree; pays `storage_deposit`s |

Total about **35–45 testnet NEAR**, plus headroom for redeploys. The amount per faucet drip is unverified; plan on several requests or ask in NEAR Discord.

### Proposed account list (root = `acme-holdings.testnet`; swap the root if the human picks another name)
| # | Account | Role | Keys held by the app |
|---|---|---|---|
| 1 | `acme-holdings.testnet` | Acquirer; treasury holding USDC; owner of contracts | Full access (setup script only, local credentials) |
| 2 | `plant-a.acme-holdings.testnet` | Facility A (org node) | Full access (script) |
| 3 | `plant-b.acme-holdings.testnet` | Facility B, the acquired family plant in the demo | Full access (script) |
| 4 | `plant-c.acme-holdings.testnet` | Facility C | Full access (script) |
| 5 | `kevin.plant-b.acme-holdings.testnet` | Kevin, the AI purchasing agent | **FC key only** in server env (spend-policy: `submit_po`,`cancel_po`); full-access key offline |
| 6 | `director.plant-b.acme-holdings.testnet` | Ops director (approves by "text") | FC key (`approve_po`,`reject_po`) used via relayer; 0 NEAR |
| 7 | `receiving.plant-b.acme-holdings.testnet` | Receiving dock | FC key (escrow `confirm_receipt`) via relayer; 0 NEAR |
| 8 | `qc.plant-b.acme-holdings.testnet` | QC release | FC key (escrow `qc_release`) via relayer; 0 NEAR |
| 9 | `spend-policy.acme-holdings.testnet` | Spend-policy contract (holds plant budget) | Full access for deploy; consider deleting it after deploy to prove immutability (Tier 2; keep for demo resets) |
| 10 | `po-escrow.acme-holdings.testnet` | PO escrow (+ record anchoring if folded in, task 9) | Full access for deploy |
| 11–13 | `<supplier>.testnet` ×3, e.g. `northbeam-excipients.testnet`, `calder-packaging.testnet`, `ridgeline-labchem.testnet` (invented; check availability) | Supplier agents, outside Acme's tree, each with its own policy | Full access in server env for the simulated supplier agent (the supplier is the agent) |
| 14 | `dayone-relayer.testnet` | Day One's relayer (vendor-owned, pays staff gas) | Full access in server env |
| optional | `purchasing.plant-b.acme-holdings.testnet` | Purchaser, only if his "confirm" is signed on-chain | FC via relayer |
| optional | `kevin.plant-a…`, `kevin.plant-c…` | Kevin per plant, if Tier 1 three-facility work needs separate agents | FC |

Not accounts: accounting (read-only view), USDC (Circle testnet contract `3e2210e1…b8af`, task 1). Escrow could instead live on a neutral `dayone-…` account to stress buyer/supplier neutrality; keep it under Acme for simplicity unless task 8 argues otherwise.

Brief Section 7 writes `plant-b.acmeholdings.near`. Use the hyphenated `.testnet` form consistently in docs and code; mainnet names are illustrative only.

### Creating accounts from a script
**Top-level (human, once, no wallet UI):**
```bash
near account create-account sponsor-by-faucet-service acme-holdings.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
near account create-account sponsor-by-faucet-service dayone-relayer.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
```
(near-cli-rs 0.30.1; POSTs `{newAccountId, newAccountPublicKey}` to `https://helper.nearprotocol.com/account`. Install: `npm install -g near-cli-rs@latest` or the Windows `irm …installer.ps1 | iex` from the CLI docs. Installing is a human step.) The other route is the faucet at docs.near.org/getting-started/faucet or near-faucet.io for an existing account. From a funded account, more `.testnet` names come from `testnet.create_account`. In near-api-js 7.3.1, `account.createAccount({ newAccountId: "northbeam-excipients.testnet", publicKey, nearToTransfer })` does exactly this: `functionCall('create_account', {new_account_id, new_public_key}, 60 TGas, deposit)` to the TLA.

**Sub-accounts (setup script, from Nov 1):** near-api-js 7.3.1 `Account.createSubAccount({ accountOrPrefix: "plant-b", publicKey, nearToTransfer })`. It sends `[createAccount(), transfer(n), addFullAccessKey(pk)]` to `plant-b.acme-holdings.testnet`, signed by the parent (verified in `src/accounts/account.ts`). For grandchildren, instantiate an `Account` for the plant with the plant's key. CLI equivalent: `near account create-account fund-myself kevin.plant-b.acme-holdings.testnet '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as plant-b.acme-holdings.testnet network-config testnet sign-with-keychain send`. Confirm the exact subcommand order with `--help`.

Script rules: idempotent (`view_account` first; skip if it exists); keys generated locally with `KeyPair.fromRandom('ed25519')`; private keys written only to a git-ignored `.near-credentials/` or `.env.local`; public account IDs in a committed `config/testnet-accounts.json` so replay mode needs no secrets. Since the brief makes seed and setup scripts build work, write this script on Nov 1; until then the human creates only the two top-level accounts.

**Name squatting risk:** testnet names are first-come. Pick and create the root early (Oct 23–31), because a sub-account tree cannot move to a new root without recreating everything.

### Faucet
- docs.near.org/getting-started/faucet: a built-in form sends "a small amount" of testnet NEAR. External `near-faucet.io` offers NEAR "or provided Fungible Tokens" (no USDC shown). Both are noted as sometimes empty; the fallback is NEAR Telegram `t.me/neardev`.
- near-cli-rs `sponsor-by-faucet-service` creates and funds a new `.testnet` account in one step (testnet only).
- **No official amount or rate limit found.** A third-party skill listing claims 10 NEAR per request, 1 per 24 h (unverified). Testnet USDC is separate: Circle faucet, 20 USDC per 2 h (task 1).

## Open questions for the human
- Root name: `acme-holdings.testnet` is free today. Do you want it, or a less collision-prone `acme-dayone.testnet` (also free)? Create it before Nov 1 so nobody squats it.
- How much testnet NEAR can you collect before Nov 1 (target ≥ 40)? Ask in NEAR Discord if the faucet is stingy.
- Supplier names: approve the invented names above or supply your own (fictional only).

## Sources
- https://docs.near.org/protocol/accounts-contracts/account-id.md — sub-account creation rules, "parent has no control", registrar for top-level, `0u` universal accounts (accessed 2026-10-22)
- https://docs.near.org/protocol/storage/storage-staking — 1e19 yocto/byte, 100 KB per NEAR, 770 bytes free paid via the 0.007 NEAR charge (accessed 2026-10-22)
- https://github.com/near/NEPs/blob/master/neps/nep-0642.md — 0.007 NEAR `account_creation_charge` on every creation path; `min_gas_purchase_price` 0.001 NEAR/TGas (accessed 2026-10-22)
- https://github.com/near/nearcore/releases/tag/2.13.0 — account creation ~0.0008 → ~0.007 NEAR; protocol 86 (accessed 2026-10-22)
- RPC `https://rpc.testnet.fastnear.com` `EXPERIMENTAL_protocol_config` — `account_creation_charge = 7000000000000000000000`, `storage_amount_per_byte = 1e19`, `min_allowed_top_level_account_length = 65`, `registrar_account_id = "registrar"`; `status` protocol 88; `view_account`: `acme-holdings.testnet`, `acmeholdings.testnet`, `acme-dayone.testnet`, `dayone-relayer.testnet`, `day-one.testnet` unknown (free); `acme.testnet`, `dayone.testnet` exist (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-api-js/master/src/accounts/account.ts — `createAccount` (TLA `create_account`, 60 TGas), `createSubAccount` (`createAccount`+`transfer`+`addFullAccessKey`), 64-char check; near-api-js 7.3.1 (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-cli-rs/main/src/config/mod.rs — testnet `faucet_url = https://helper.nearprotocol.com/account`, `linkdrop_account_id = "testnet"`, `meta_transaction_relayer_url = None` (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-cli-rs/main/src/commands/account/create_account/sponsor_by_faucet_service/mod.rs — POST `newAccountId` and key to the faucet helper (accessed 2026-10-22)
- https://docs.near.org/tools/cli.md — `create-account sponsor-by-faucet-service … create`, install methods (accessed 2026-10-22)
- https://docs.near.org/getting-started/faucet — built-in faucet "small amount", near-faucet.io, Ref testnet swap, Telegram fallback (accessed 2026-10-22)
- https://near-faucet.io/ — no amount or rate limit shown (accessed 2026-10-22)
- https://termo.ai/skills/near-faucet — third-party claim: 10 NEAR per request, 1 per 24 h (unverified; accessed 2026-10-22)
- https://crates.io/api/v1/crates/near-cli-rs — 0.30.1, updated 2026-10-19 (accessed 2026-10-22)
