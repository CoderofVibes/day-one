# 1. Stablecoins on NEAR testnet

**Question:** Which stablecoin contract do we settle POs in on NEAR testnet, how does a developer get it, and how does it flow into an escrow contract (`storage_deposit`, `ft_transfer_call`, `ft_on_transfer`, decimals)? What is the fallback if testnet USDC cannot be obtained?

**Answer:** Circle's native USDC exists on NEAR testnet at the implicit account `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`. It is a standard NEP-141 + NEP-145 contract with **6 decimals** and a storage registration cost of **0.00125 NEAR** (both verified by RPC today). Circle's public faucet (faucet.circle.com) lists "Near Testnet". It gives **20 USDC per address every 2 hours**, sits behind reCAPTCHA, needs no account, and Circle's Discord is the route for more. 20 USDC per drip does not cover realistic PO sizes ($1k–$10k), so the real constraint is supply, not access. The settlement flow works today: recent `ft_transfer_call` transactions on the testnet contract succeed.

**Re-verified 2026-10-25 by Muse** (bridge message #11), read-only, no tokens requested: https://faucet.circle.com/ lists "Near Testnet" among 38 networks; selecting it shows "Send 20 USDC"; the FAQ states 20 USDC per address, per blockchain, every 2 hours. Not yet proven: that the faucet actually delivers to a NEAR account, and which token contract it funds. Muse's own earlier "no verifiable testnet USDC" finding is withdrawn. Next step: one real claim to a testnet account (PLAN.md human task 6).

**Confidence:** high for the contract id, decimals, storage cost and the faucet's existence and limits (checked against Circle's address page, Circle's faucet page and live RPC). Medium on two points: whether the Circle faucet registers storage for a NEAR recipient automatically (not documented), and whether Circle will grant a larger drip.

**Decision recommended:** Make the escrow and policy contracts **token-agnostic**: pass the token account id in at `init` and keep an allowlist. Settle the spine in **real Circle testnet USDC**, using PO amounts that fit the float we can collect. The human gathers about 100–200 USDC across several accounts over the prep window, and supplier agents send USDC back to the treasury in the reset script, so the float recycles. If we cannot collect enough float by Nov 4, switch to a self-deployed, honestly labelled **"Day One Test USD" (DTUSD)** NEP-141 for the big-number demo POs. Keep at least one recorded end-to-end PO in real Circle USDC either way.

## Details

### Verified contract facts (RPC `query` against `rpc.testnet.near.org` and `test.rpc.fastnear.com`, 2026-10-22)
| Item | Value |
|---|---|
| Account id | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (64-hex implicit account; matches Circle's published testnet address) |
| Mainnet (for reference only) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (also the `nep141:` asset 1Click lists for NEAR USDC) |
| `ft_metadata` | `spec: ft-1.0.0`, `name: USDC`, `symbol: USDC`, `decimals: 6` |
| `storage_balance_bounds` | `min = max = 1250000000000000000000` yocto = **0.00125 NEAR** |
| `ft_total_supply` | 14,081,220,210.267770 USDC (testnet, no value) |
| Recent activity | `storage_deposit`, `ft_transfer`, and `ft_transfer_call` transactions all succeed (NearBlocks testnet API) |

Amounts are strings in the smallest unit: $1,250.00 = `"1250000000"`.

### Getting testnet USDC (human action; CAPTCHA, so an agent cannot do it)
1. Register the receiving account with the USDC contract first. It is cheap, and we don't know whether the faucet does it for us:
   `near contract call-function as-transaction 3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af storage_deposit json-args '{"account_id":"acme-treasury.<root>.testnet","registration_only":true}' prepaid-gas '30.0 Tgas' attached-deposit '0.00125 NEAR' sign-as <payer>.testnet network-config testnet sign-with-keychain send`
2. On https://faucet.circle.com/, choose USDC and Near Testnet, paste the account id, and solve the reCAPTCHA. The limit is 20 USDC per address per 2 hours.
3. Repeat for several of our own accounts (Acme treasury, the plants, Kevin), then consolidate with `ft_transfer`. Over 9 prep days a realistic float is 100–200 USDC.
4. Ask in Circle's Discord for a larger testnet drip, for example 5,000 USDC (open question below).
5. Other routes, both weaker: near-faucet.io (NEAR docs say it serves "NEAR or provided Fungible Tokens"; its page did not show USDC) and the testnet Ref Finance swap (`testnet.ref.finance`). Ref's pools trade **`usdc.fakes.testnet`** ("Bridged USDC", symbol `USDC.e`, 6 decimals), which is **not Circle's** token. Do not mix it with Circle USDC.

### Other testnet stablecoins seen (all NEP-141, verified `ft_metadata`)
- `usdc.fakes.testnet`: USDC.e, 6 decimals (Ref test token)
- `usdt.fakes.testnet`: USDT.e, 6 decimals (Ref test token)
- `tt_local.testnet`: "TetherToken" USDt, 6 decimals (provenance unclear)
- `usdn.testnet`: USN, 18 decimals (USN is defunct on mainnet; avoid)
- `usdt.tether-token.testnet`: does not exist (mainnet `usdt.tether-token.near` does)

Only Circle's is "native USDC". For a "Real-World Money" story, the Circle contract is the one worth naming.

### Settlement flow into escrow (NEP-141 / NEP-145)
1. **Registration (NEP-145).** Every account that will *hold* USDC must be registered: the policy/treasury contract, the escrow contract, and every supplier agent. Call `storage_deposit({account_id, registration_only: true})` on the USDC contract with 0.00125 NEAR. Check with `storage_balance_of({account_id})`. An `ft_transfer` to an unregistered account panics, so the setup script registers all accounts.
2. **Funding (`ft_transfer_call`).** The holder of the funds calls `ft_transfer_call({receiver_id: "<escrow>", amount: "<u128 string>", memo: null, msg: "<json>"})` on the USDC contract. It must attach **exactly 1 yoctoNEAR** and enough gas (NEAR docs use 300 Tgas in examples; 100 Tgas is typically enough). `msg` carries `{"po_id":"PO-1042"}`.
3. **Receiver (`ft_on_transfer`).** The USDC contract calls `escrow.ft_on_transfer(sender_id, amount: U128, msg: String) -> PromiseOrValue<U128>`. The escrow must:
   - `require!(env::predecessor_account_id() == self.token_id)`, otherwise anyone could call `ft_on_transfer` directly with fake amounts.
   - parse `msg`, check that the PO exists, is in `AwaitingFunds`, and that `amount == po.amount` (or return the excess);
   - return `U128(0)` to keep everything, or `U128(amount)` to refuse. Returning the full amount is the clean refusal: the USDC contract's `ft_resolve_transfer` refunds the sender automatically. **Do not panic** in `ft_on_transfer` for business-rule refusals. A panic also refunds, but it makes the explorer show a failed receipt instead of a clean refusal.
4. **Release / refund (`ft_transfer`).** The escrow pays out with `ft_transfer({receiver_id, amount, memo})` + 1 yocto (a cross-contract call with about 30 Tgas, as in the near-examples auction). Use a callback (`#[private] on_payout(po_id)`) that checks `env::promise_result` and rolls the PO state back if the transfer failed (for example, if the supplier is not registered).

**Key constraint discovered (affects tasks 3–4):** function-call access keys **cannot attach a deposit**, not even 1 yocto (docs.near.org/protocol/access-keys). Kevin's function-call key therefore **cannot call `ft_transfer_call` on USDC himself.** The funds must sit in a contract (policy/treasury), and that contract calls `ft_transfer_call` to the escrow when a PO is approved. This is also the better story: the chain moves the money once the rule is satisfied.

### Fallback: our own NEP-141 "test USD"
- **Effort:** under 1 hour, no code. Use the canonical FT contract via NEAR's **global FT contract** (`near contract deploy <acct> use-global-account-id ft.globals.primitives.testnet with-init-call new_default_meta json-args '{"owner_id":"<acct>","total_supply":"<u128>"}' ...`). This avoids paying storage for about 200 KB of wasm. Alternatively, use the **factory** `token.primitives.testnet` (`get_required` then `create_token`), which creates `<symbol>.token.primitives.testnet`. `dtusd.token.primitives.testnet` is currently free, as is `dousd`. A plain deploy of `near-examples/FT` also works and costs about 2 testnet NEAR in storage.
- **Cost:** testnet NEAR only (free from the faucet). Supply is fixed and minted to the owner at init, which is fine because the treasury owns it.
- **Honest labelling:** name "Day One Test USD", symbol `DTUSD`, decimals 6 (same as USDC so the code paths are identical), our own icon, never the USDC logo. The README's on-chain table states "settles in Circle testnet USDC (`3e22…b8af`); large demo POs use DTUSD, a test token we deployed, because Circle's faucet caps at 20 USDC/2h." The behind-the-curtain view shows the token symbol on every transfer.
- **Why not scale amounts** (show $4,800, move 4.80 USDC): judges would rightly call that misleading. If we scale, label it in the UI ("testnet: 1/1000 scale").

## Open questions for the human
1. Will you collect Circle testnet USDC over the prep window (CAPTCHA, 20 USDC every 2h per account), and ask in Circle's Discord (https://discord.com/invite/buildoncircle) for a larger testnet grant?
2. If the float stays small: do you prefer (a) small, realistic PO amounts in real USDC (lab chemicals around $15–$150), (b) our own labelled DTUSD for large POs, or (c) a mix (recommended)?

## Sources
- https://developers.circle.com/stablecoins/usdc-contract-addresses — NEAR testnet and mainnet USDC addresses (accessed 2026-10-22)
- https://faucet.circle.com/ — "Near Testnet" listed; 20 USDC per 2h per address per chain; reCAPTCHA; no account; Discord for more (accessed 2026-10-22)
- RPC `https://rpc.testnet.near.org` and `https://test.rpc.fastnear.com` — `ft_metadata` (decimals 6), `storage_balance_bounds` (0.00125 NEAR), `ft_total_supply`, `view_account`; metadata of `usdc.fakes.testnet`, `usdt.fakes.testnet`, `tt_local.testnet`, `usdn.testnet` (accessed 2026-10-22)
- https://api-testnet.nearblocks.io/v1/account/3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af/txns-only — recent successful `ft_transfer_call` / `storage_deposit` (accessed 2026-10-22)
- https://docs.near.org/primitives/ft/standard — `storage_deposit`, `ft_transfer_call` (exactly 1 yocto), `ft_on_transfer` returns unused amount, `ft_resolve_transfer` (accessed 2026-10-22)
- https://docs.near.org/primitives/ft/ft — 0.00125 NEAR registration example, 300 Tgas `ft_transfer_call` example, factory `token.primitives.testnet`, global `ft.globals.primitives.testnet` (accessed 2026-10-22)
- https://docs.near.org/getting-started/faucet — near-faucet.io and testnet Ref Finance swap as FT sources (accessed 2026-10-22)
- https://docs.near.org/protocol/access-keys — function-call keys "do not allow to attach NEAR tokens to the call" (accessed 2026-10-22)
- https://github.com/near-examples/auctions-tutorial/blob/main/contract-rs/03-bid-with-fts/src/lib.rs — reference `ft_on_transfer` with a predecessor check and `ft_transfer` + 1 yocto (accessed 2026-10-22)

## Proven 2026-10-27: Circle's faucet delivers to a NEAR testnet account

Claude registered `acme-holdings.testnet` with the Circle USDC contract (`storage_deposit`, 0.00125 NEAR, signed with the account's keychain key). Tony then claimed once at faucet.circle.com (USDC, "Near Testnet", address `acme-holdings.testnet`). Within about a minute `ft_balance_of` on `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` returned 20 USDC (20000000 base units). So the faucet funds Circle's own NEAR testnet contract, the one the bonus PO-1047 deployment will use. Register storage before claiming; whether the faucet registers it for you is still untested.
