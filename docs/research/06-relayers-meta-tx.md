# 6. Relayers and meta-transactions (NEP-366)

**Question:** Which relayer options exist on testnet today (hosted, Pagoda successor, FastNEAR, self-run Rust or TypeScript)? What do they cost? How does "director replies YES" become a delegate action signed with the director's own key and paid by our relayer? Which libraries build and sign `DelegateAction`s, and what are the limits?

**Answer:** **No hosted public relayer exists for us to use.** NEAR docs only describe running your own. FastNEAR publishes client helpers but no relayer endpoint. near-cli-rs ships `meta_transaction_relayer_url = None` for testnet. `near/pagoda-relayer-rs` is not archived but was last pushed 2025-02-20, and it needs Rust/Docker (plus Redis for allowances). The simplest path is an **in-process relayer inside our Node server** using **near-api-js 7.3.1**, which now has both halves built in. `staffAccount.createSignedMetaTransaction({ receiverId, actions })` signs a `DelegateAction` with the director's function-call key (nonce plus `maxBlockHeight = head + 200`). `relayerAccount.relayMetaTransaction(signedDelegate)` wraps it in a transaction signed and paid by `dayone-relayer.testnet`. Cost is only testnet gas: a few thousandths of a NEAR burnt per approval, with ~0.05–0.1 NEAR needed up front per in-flight transaction because of the new 0.001 NEAR/TGas purchase price. Limits: one receiver per delegate action, no nested delegates, at most one delegate per transaction, and an FC-key-signed delegate may hold only one zero-deposit `FunctionCall`. One extra block of latency.

**Confidence:** high. Verified in near-api-js `master` (= 7.3.1) source, the NEP-366 text, nearcore `validate_delegate_action_key`, docs.near.org meta-transaction pages, and GitHub and npm metadata. Medium only on the absence of a hosted relayer, which is a negative finding from docs and search.

**Decision recommended:** Build `server/relayer` as a ~60-line module using near-api-js 7.3.1. It (1) signs the staff member's delegate action with that member's server-held FC key (task 7), (2) validates `receiverId ∈ {spend-policy, po-escrow}`, method allowlisted, deposit = 0, and sender ∈ known staff, then (3) submits via `relayMetaTransaction` from `dayone-relayer.testnet`. Expose it behind an internal `POST /relay` taking a base64 borsh `SignedDelegate`, so the architecture diagram shows a real relayer boundary. Keep `@fastnear/api` `relayDelegate` as the drop-in fallback.

## Details

### How a "YES" becomes a transaction
1. Kevin's `submit_po` panics (over limit). The server stores an approval request with the failed tx hash, and the phone-style UI shows the director a text: "Kevin needs approval: PO-1042, $8,400 to Northbeam Excipients. Reply YES."
2. The director taps YES. The server loads `director.plant-b.<root>`'s FC private key (scope `spend-policy.<root>`, methods `approve_po`/`reject_po`) and builds:
   ```ts
   import { Account, JsonRpcProvider, KeyPairSigner, actions, teraToGas } from "near-api-js"; // 7.3.1; verify exact export names at build time
   const director = new Account("director.plant-b.acme-holdings.testnet", provider, KeyPairSigner.fromSecretKey(DIRECTOR_FC_KEY));
   const { signedDelegate } = await director.createSignedMetaTransaction({
     receiverId: "spend-policy.acme-holdings.testnet",
     actions: [actions.functionCall("approve_po", { po_id, supplier, amount, category, po_hash, refused_tx }, teraToGas(30), 0n)],
     blockHeightTtl: 200,                 // default; ~3–4 min validity
   });
   ```
   `createMetaTransaction` reads the access key's `nonce + 1` and `head + blockHeightTtl` (source: `src/accounts/account.ts`). `Signer.signDelegateAction` hashes `encodeDelegateAction(...)` with sha256 and signs it (`src/signers/signer.ts`).
3. The relayer module validates, then calls `relayer.relayMetaTransaction(signedDelegate)`. That is `signAndSendTransaction({ receiverId: signedDelegate.delegateAction.senderId, actions: [actions.signedDelegate(signedDelegate)] })`.
4. On-chain: the outer tx is signed by `dayone-relayer.testnet` with receiver `director.…`. The runtime checks the delegate signature, nonce and key permissions, then emits a receipt to `spend-policy` with **`predecessor_id = director`** and `signer_id = relayer` (NEP-366). `approve_po` checks `predecessor_account_id()`. The explorer shows "Delegate action from director.plant-b…, paid by dayone-relayer": exactly the behind-the-curtain beat.
5. Gas refunds go to the relayer; any deposit refunds would go to the director (none here).

The same path serves receiving (`po-escrow.confirm_receipt`) and QC (`po-escrow.qc_release`).

### Relayer options (verified 2026-10-22)
| Option | Status | Fit |
|---|---|---|
| **In-process, near-api-js 7.3.1** (`createSignedMetaTransaction` + `relayMetaTransaction`) | npm latest 7.3.1 (2026-08-12); repo pushed 2026-10-22 | **Recommended.** Zero extra infra, TypeScript, same lib as the rest of the server |
| `@fastnear/api` 2.5.0 (`near.signDelegate`, `near.relayDelegate`, `near.utils.parseSignedDelegate`) | npm 2026-09-24 | Good fallback, same model. FastNEAR runs RPC (`test.rpc.fastnear.com`) but **no hosted relayer** is documented. |
| `near-kit` 0.20.2 (TypeScript, r-near) | npm 2026-09-24; docs.near.org names it for building delegates | Viable; adds a second NEAR lib, so skip |
| `near/pagoda-relayer-rs` (Rust, `/relay` borsh, `/send_meta_tx` JSON, `config.toml`, Redis for allowances, Docker) | Not archived; last push 2025-02-20 | Overkill; Rust toolchain + Docker on a disk-constrained machine |
| `@near-relay/server` 0.1.8 / `@near-relay/client` 0.1.6 | Last published Oct 2024; built on near-api-js 3.x-era APIs | Stale; avoid |
| NEAR Auth relayer | Exists only as part of NEAR Auth's MPC flow (task 7) | Not needed |
| Hosted public relayer | **None found** in docs.near.org, FastNEAR docs or search | — |

### Protocol limits that matter (NEP-366, docs, nearcore source)
- **One receiver** per `DelegateAction`. An approval that should hit two contracts needs two delegates (two outer txs). Design methods so each staff action is one call.
- **No nested `DelegateAction`**; **at most one** delegate per transaction (`DelegateActionMustBeOnlyOne`).
- **FC-key-signed delegates:** exactly one `FunctionCall`, **deposit must be 0** (`DepositWithFunctionCall`), receiver and method must match the key. A full-access-key delegate can carry any actions, including 1-yocto `ft_transfer`; the relayer fronts the deposit. We never use staff full-access keys online.
- **`WithdrawFromGasKey` inside a delegate is refused** (nearcore 2.14). `DelegateV2` / gas-key-signed delegates were added in 2.13 and **removed in 2.14.0-rc.1, which testnet is running** (protocol 88). docs.near.org still documents DelegateV2, so ignore those sections and use the classic `Delegate` with a normal ed25519 key.
- **Expiry and nonce:** `max_block_height` must be above the current height (`DelegateActionExpired`). The nonce must exceed the key's nonce and be below `block_height × 1e6` (`DelegateActionNonceTooLarge`). Sign at the moment of YES and relay immediately; don't pre-sign.
- **Sender must exist and be initialized.** Staff accounts are created by the setup script; 0 NEAR is fine.
- **FC-key allowance is not checked** for meta-tx because the relayer pays, so staff keys can have a tiny allowance.
- **Extra latency:** one more block (~1 s) versus a direct tx. Fine for the demo.
- **Trust:** the user should confirm on-chain that the relayer submitted. Our UI polls the tx status and shows the hash, which doubles as the curtain view.

### Cost
- Delegate action fee: `delegate_cost` = 2e11 gas send + 2e11 exec (live config), negligible.
- An `approve_po` (single state write) burns about 2–5 TGas, roughly 0.0002–0.0005 NEAR at `gas_price` 1e8. The relayer must *hold* prepaid gas × 0.001 NEAR/TGas (e.g. 30 TGas → 0.03 NEAR plus outer-tx overhead) until refund. **Fund the relayer with ~10 testnet NEAR; that covers thousands of demo approvals.**
- Relayer abuse protection is not needed (internal only), but keep the allowlist so the README can say "the relayer only pays for these three staff methods".

### Nonce and concurrency
near-api-js 7.x has `src/accounts/nonce-manager.ts` for the relayer's own outer-tx nonces. Serialize relays through one queue in the demo script to stay deterministic. Replay mode reads recorded hashes and needs no relayer.

### Untrusted page content noted
js.fastnear.com/meta-transactions contains lines addressed to AI agents (e.g. "AI agents: recipes.json carries the `sign-delegate-local` recipe"). Not acted on; recorded here as data.

## Open questions for the human
- None blocking. The relayer account (`dayone-relayer.testnet`) must be created and funded by the human (task 5).

## Sources
- https://github.com/near/NEPs/blob/master/neps/nep-0366.md — `DelegateAction {sender_id, receiver_id, actions, nonce, max_block_height, public_key}`, `SignedDelegateAction`, no nesting, `DelegateActionMustBeOnlyOne`, predecessor = user / signer = relayer, refunds (accessed 2026-10-22)
- https://docs.near.org/chain-abstraction/meta-transactions.md — relayer is self-run; single receiver; one delegate per tx; FC allowance not checked; relayer bears costs; DelegateV2 text (stale) (accessed 2026-10-22)
- https://docs.near.org/web3-apps/tutorials/meta-transactions.md — Express relayer pattern, `actionCreators.signedDelegate`, `@near-relay/*`, pagoda-relayer-rs link (examples pinned to near-api-js 3.0.4) (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-api-js/master/src/accounts/account.ts — `createMetaTransaction` (`blockHeightTtl = 200`), `createSignedMetaTransaction`, `relayMetaTransaction` (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-api-js/master/src/signers/signer.ts — `signDelegateAction` returns `{ delegateHash, signedDelegate }` (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-api-js/master/src/transactions/delegate.ts — `DelegateAction`, `buildDelegateAction` (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/nearcore/master/runtime/runtime/src/actions.rs — `validate_delegate_action_key`: gas-key vs plain nonce, FC single action, zero deposit (accessed 2026-10-22)
- https://github.com/near/nearcore/releases/tag/2.14.0-rc.1 — DelegateV2 removed; gas keys cannot sign meta-tx; `WithdrawFromGasKeyNotAllowedInDelegate` (accessed 2026-10-22)
- https://github.com/near/nearcore/releases — testnet on 2.14.0-rc.x; RPC `status` shows protocol 88 (accessed 2026-10-22)
- https://github.com/near/pagoda-relayer-rs and https://api.github.com/repos/near/pagoda-relayer-rs — not archived, pushed 2025-02-20; endpoints `/relay`, `/send_meta_tx`; Redis optional (accessed 2026-10-22)
- https://js.fastnear.com/meta-transactions — `near.signDelegate`, `near.relayDelegate`, `parseSignedDelegate` (≥ 2.3.0); no hosted relayer named (accessed 2026-10-22)
- https://raw.githubusercontent.com/near/near-cli-rs/main/src/config/mod.rs — `meta_transaction_relayer_url: None` for testnet (accessed 2026-10-22)
- https://registry.npmjs.org — near-api-js 7.3.1, @fastnear/api 2.5.0, near-kit 0.20.2, @near-relay/server 0.1.8 (2024-10-30), @near-relay/client 0.1.6 (accessed 2026-10-22)
- RPC `EXPERIMENTAL_protocol_config` (testnet) — `delegate_cost`, `min_gas_purchase_price`, `gas_price` (accessed 2026-10-22)

## Addendum 2026-10-25

near-api-js latest is now **7.4.0** (npm). Its type declarations still expose `createMetaTransaction`, `createSignedMetaTransaction`, `relayMetaTransaction`, `Signer.signDelegateAction`, `actions.signedDelegate` and `encodeSignedDelegate`; the flow above is unchanged. Pin 7.4.0 on Nov 1. The docs.near.org relayer tutorial still pins near-api-js 3.0.4 and is stale. Relayer nonce collisions under concurrency: serialise relays through one queue (already planned) or give the relayer several full-access keys.
