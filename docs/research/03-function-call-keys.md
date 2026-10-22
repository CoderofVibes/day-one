# 3. Function-call access keys

**Question:** What can a NEAR function-call (FC) access key actually enforce for an agent that moves USDC? What does `allowance` limit, how do receiver and method restrictions work, can an FC key attach a deposit, and how are keys rotated or revoked? Given that `ft_transfer` / `ft_transfer_call` require exactly 1 yoctoNEAR, how does Kevin fund escrow at all?

**Answer:** An FC key restricts *which* contract (`receiver_id`, exactly one) and *which methods* (`method_names`, empty = all) the holder may call. Its `allowance` is a NEAR budget for **gas and transaction fees only**, so it cannot limit token amounts. An FC key **cannot attach any deposit, not even 1 yoctoNEAR**. The protocol rejects such a transaction with `InvalidAccessKeyError::DepositWithFunctionCall`, and the same check applies inside NEP-366 delegate actions (verified in nearcore source). So Kevin's FC key can never call `ft_transfer` / `ft_transfer_call` on the USDC contract. The treasury therefore pre-funds the spend-policy contract with USDC (a full-access-key action). Kevin calls a no-deposit method such as `submit_po` on the policy contract. If the rules pass, *the contract* calls `ft_transfer_call` to the escrow, attaching the 1 yocto from its own NEAR balance. Keys scope *what* Kevin can touch; the contract enforces *how much*.

**Confidence:** high. The FC permission fields, the zero-deposit rule and allowance semantics are confirmed in the Nomicon spec, docs.near.org and nearcore `master` source (`validate_delegate_action_key`). The live testnet protocol config (protocol 88) confirms the new minimum gas purchase price that affects allowance sizing.

**Decision recommended:** Give Kevin's account FC keys only: one key scoped to `spend-policy.<root>` with `method_names = ["submit_po", "cancel_po"]` and a finite allowance of about 2 NEAR. The full-access key for Kevin's account is held offline by the human (Acme admin), never by Kevin's runtime. All USDC movement goes through contract-initiated `ft_transfer_call` with the contract's own 1 yocto. Revocation has two layers: `DeleteKey` on Kevin's key (account-level) and `pause_agent` in the policy contract (rule-level).

## Details

### What an FC key is (protocol data structures)
From the Nomicon `AccessKey` spec:
```rust
pub enum AccessKeyPermission { FunctionCall(FunctionCallPermission), FullAccess }
pub struct FunctionCallPermission {
    pub allowance: Option<Balance>,   // None = unlimited; covers gas + tx fees only
    pub receiver_id: AccountId,       // exactly one contract
    pub method_names: Vec<String>,    // empty = any method on receiver_id
}
```
Runtime validation for a transaction signed with an FC key (Nomicon `RuntimeSpec/Transactions`):
- More than one action, or a non-`FunctionCall` action → `InvalidAccessKeyError::RequiresFullAccess`. **One FunctionCall per transaction; no batching.**
- Non-zero `deposit` → `InvalidAccessKeyError::DepositWithFunctionCall`.
- Transaction `receiver_id` ≠ key's `receiver_id` → `ReceiverMismatch`.
- Method not in `method_names` (when non-empty) → `MethodNameMismatch`.
- Not enough allowance → `NotEnoughAllowance`.

An FC key cannot transfer NEAR, add or delete keys, create or delete accounts, deploy, or stake.

### What `allowance` limits (and what it does not)
- **Unit:** yoctoNEAR. It limits the NEAR the key may spend on **gas and fees**. Using the key decreases both the account balance and the allowance by the same amount. It has nothing to do with USDC or any NEP-141 amount, because token amounts are just JSON args to the token contract.
- **Immutable:** "The allowance of an existing key cannot be changed." To top up, add a new key and delete the old one. Adding NEAR to the account does not refill a key's allowance.
- **`0` gotcha:** `0` in an `AddKey` *transaction* makes every call fail with `NotEnoughAllowance`. But `0` passed via the host function `promise_batch_action_add_key_with_function_call` (contract-added keys) means unlimited.
- **Charged at the buy price:** the allowance is debited at the gas *purchase* price and credited back on refund, so it must exceed the *prepaid* gas cost, not just the burnt cost.
- **New since 2026 (NEP-642, nearcore 2.13, live on mainnet protocol 86 and testnet protocol 88):** `min_gas_purchase_price = 1_000_000_000` yocto/gas (0.001 NEAR/TGas). That is 10x the current burn price of `gas_price = 100_000_000` (0.0001 NEAR/TGas), verified via RPC `EXPERIMENTAL_protocol_config` and `gas_price`. A call with 300 TGas prepaid needs **about 0.3 NEAR of allowance and balance up front**. Most of it is refunded, but **near-api-js's default allowance of 0.25 NEAR (`addFunctionCallAccessKey`) is too small for a 300 TGas call.** Set Kevin's allowance to 1–2 NEAR and keep his account balance at 1 NEAR or more.
- **Meta-transactions:** FC-key allowance "is not checked for meta transactions, because the relayer covers the costs" (docs.near.org meta-transactions page). Staff keys used only via the relayer can carry a tiny allowance.

### The 1 yoctoNEAR problem
NEP-141 `ft_transfer` and `ft_transfer_call` require **exactly 1 yoctoNEAR** attached, precisely so that FC keys *cannot* call them (docs.near.org "one yocto" security page: function-call keys "cannot attach the one yoctoNEAR"). nearcore `validate_delegate_action_key` applies the same `function_call.deposit > 0 → DepositWithFunctionCall` check inside delegate actions. **A relayer cannot work around it for an FC key either.**

Consequences for the design:
1. **Kevin cannot move USDC directly, ever.** That is the security story, not a limitation to hide.
2. **The treasury pre-funds the policy contract.** Acme's treasury account, with a full-access key run by the setup script (or an HQ admin action), calls `usdc.ft_transfer_call({receiver_id: "spend-policy.<root>", amount, msg: "{\"budget\":\"plant-b\"}"})` with 1 yocto. The policy contract's `ft_on_transfer` accepts it only from the USDC contract and only when `sender_id` is the configured treasury. It returns `"0"` (keep all).
3. **Kevin calls a no-deposit method.** `spend-policy.submit_po(po_id, supplier, amount, category, po_hash)` is signed with Kevin's FC key and has no deposit. If within policy, *the contract* calls `usdc.ft_transfer_call({receiver_id: "po-escrow.<root>", amount, msg: {po_id, supplier}})` with `NearToken::from_yoctonear(1)` from its own NEAR balance, plus a callback `on_escrow_funded(po_id)` to roll back the spend counter if the transfer is refunded. Contracts *can* attach deposits to cross-contract calls; only access keys cannot.
4. **Escrow release works the same way.** Receiving or QC confirm with no-deposit calls (`confirm_receipt`, `qc_release`) on the escrow contract. The escrow contract itself calls `usdc.ft_transfer(supplier, amount)` with its own 1 yocto.
5. **Every contract that holds USDC** (policy, escrow, suppliers) must be registered via `storage_deposit` (0.00125 NEAR; see `01-testnet-stablecoins.md`). The setup script does this with a full-access key.

Alternative considered: merging policy and escrow into one contract removes one cross-contract hop and the refund path. It is a valid fallback if the two-contract callback logic slips (see `04-spend-policy-design.md`).

### Key layout for the demo
| Account | Key held by the app | Scope | Purpose |
|---|---|---|---|
| `kevin.plant-b.<root>` | FC | `spend-policy.<root>`, `["submit_po","cancel_po"]`, allowance ~2 NEAR | Kevin proposes and executes POs |
| `kevin.plant-b.<root>` (optional 2nd key) | FC | `po-escrow.<root>`, e.g. `["anchor_record"]` | Only if Kevin must call the escrow/anchor contract. One key = one receiver, so a second contract needs a second key. |
| `director.plant-b.<root>` | FC | `spend-policy.<root>`, `["approve_po","reject_po"]`, small allowance | Director's "YES" via relayer (task 6) |
| `receiving.plant-b.<root>` | FC | `po-escrow.<root>`, `["confirm_receipt"]` | Dock confirms delivery |
| `qc.plant-b.<root>` | FC | `po-escrow.<root>`, `["qc_release"]` | QC releases lot → payment |
| All of the above | **Full-access key kept offline** by the human (local keychain or `.env` outside the repo) | — | Key management only |
| `acme-holdings` treasury, contract accounts | Full access (setup script) | — | Funding, deploy, `storage_deposit` |

Because staff accounts act only via the relayer, they can hold **0 NEAR** (NEP-448 zero-balance accounts cover up to 770 bytes). That is literally "staff never hold tokens"; see task 5.

### Rotation and revocation
- **Rotate or top up allowance:** one transaction signed by the full-access key with actions `[AddKey(newPk, FunctionCall{...}), DeleteKey(oldPk)]`. Batched actions on a full-access key are atomic.
  - near-api-js 7.3.1: `account.addFunctionCallAccessKey({ publicKey, contractId, methodNames, allowance })` and `account.deleteKey(publicKey)` (verified in `src/accounts/account.ts`). For one atomic tx use `account.signAndSendTransaction({ receiverId: account.accountId, actions: [actions.addKey(...), actions.deleteKey(...)] })`.
  - near-cli-rs 0.30.1: `near account add-key <acct> grant-function-call-access --allowance '2 NEAR' --contract-account-id spend-policy.<root> --function-names 'submit_po, cancel_po' use-manually-provided-public-key ed25519:<pk> network-config testnet sign-with-keychain send`. The subcommand shape is from the CLI's interactive tree; confirm with `--help` before use. Delete: `near account delete-keys <acct> public-keys ed25519:<pk> network-config testnet sign-with-keychain send` (docs.near.org/tools/cli). List: `near account list-keys <acct> network-config testnet now`.
- **Revoke (kill switch):** `DeleteKey` takes effect at the next block, and Kevin's runtime can no longer sign anything. Also add `pause_agent(agent)` to the policy contract, owner-only, so HQ can freeze spending without touching keys. Both are good "behind the curtain" beats.
- **Danger:** an account whose only keys are FC keys cannot manage its own keys. Never delete the last full-access key unless a contract on that account provides key management.

### Things that do *not* change this design
- **Gas keys (NEP-611)**, a new key type in nearcore 2.13 with a prepaid balance and parallel nonces. They *can* be FunctionCall-scoped but cannot set an allowance. As of nearcore 2.14.0-rc.1 (testnet), **gas keys can no longer sign meta-transactions** (`DelegateV2` was removed). The docs.near.org gas-keys and meta-tx pages still describe DelegateV2, so they are stale on this point. Not needed for the demo; ignore.
- **ML-DSA-65 post-quantum keys** are now a third key type. Not needed.

## Open questions for the human
- None blocking. Confirm you are comfortable holding each demo account's full-access key in a local, git-ignored credentials file (or OS keychain via near-cli-rs) and only FC private keys in the server's `.env`.

## Sources
- https://docs.near.org/protocol/access-keys — FC keys: one `receiver_id`, optional `method_names`, `allowance` for gas only, cannot attach NEAR, allowance immutable, `0` semantics, charged at buy price (accessed 2026-10-22)
- https://docs.near.org/protocol/accounts-contracts/access-keys.md — same, plus gas-key tip and key-scheme list (accessed 2026-10-22)
- https://nomicon.io/DataStructures/AccessKey — `FunctionCallPermission { allowance: Option<Balance>, receiver_id, method_names }`, "GAS and transaction fees only" (accessed 2026-10-22)
- https://nomicon.io/RuntimeSpec/Transactions — `RequiresFullAccess`, `DepositWithFunctionCall`, `ReceiverMismatch`, `MethodNameMismatch`, `NotEnoughAllowance` (accessed 2026-10-22)
- https://docs.near.org/smart-contracts/security/one_yocto — 1 yocto "cannot be attached with a function-call key" (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/nearcore/master/runtime/runtime/src/actions.rs — `validate_delegate_action_key`: FC key inside delegate action, single FunctionCall, `deposit > 0 → DepositWithFunctionCall` (accessed 2026-10-22)
- https://github.com/near/NEPs/blob/master/neps/nep-0642.md — `min_gas_purchase_price` 0.001 NEAR/TGas applies to all receipts; 0.007 NEAR account creation charge (accessed 2026-10-22)
- RPC `https://rpc.testnet.fastnear.com` / `https://rpc.mainnet.fastnear.com` `EXPERIMENTAL_protocol_config`, `gas_price`, `status` — testnet protocol 88 (nearcore 2.14.0-rc.5), mainnet 86; `min_gas_purchase_price = 1000000000`; `gas_price = 100000000`; `account_creation_charge = 7e21` (accessed 2026-10-22)
- https://github.com/near/nearcore/releases/tag/2.13.0 and https://github.com/near/nearcore/releases/tag/2.14.0-rc.1 — gas keys stabilized; DelegateV2 added then removed; gas keys can no longer sign meta-tx (accessed 2026-10-22)
- https://docs.near.org/chain-abstraction/meta-transactions.md — FC-key allowance not checked for meta-tx (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-api-js/master/src/accounts/account.ts — `addFunctionCallAccessKey` (default allowance `NEAR.toUnits('0.25')`), `deleteKey`, `addFullAccessKey` in near-api-js 7.3.1 (accessed 2026-10-22)
- https://docs.near.org/tools/cli.md — near-cli-rs `delete-keys`, `list-keys`, `call-function ... attached-deposit` syntax (accessed 2026-10-22)
- https://registry.npmjs.org/near-api-js — latest 7.3.1 (2026-08-12); https://crates.io/api/v1/crates/near-cli-rs — 0.30.1 (accessed 2026-10-22)
