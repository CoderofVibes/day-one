# 2. Do we need NEAR Intents at all?

**Question:** Is there a testnet or sandbox for NEAR Intents (1Click API, the verifier contract, the solver relay / Message Bus)? What would Intents add to Day One? What is the smallest honest mainnet dry run, and should we do one?

**Answer:** No. The official docs say twice: "There is no testnet deployment. Use small amounts for testing purposes." The account `intents.testnet` exists but has **no contract code**, and the 1Click API has only a mainnet base URL (`https://1click.chaindefuser.com/v0`). For same-chain PO settlement (escrow pays a supplier's NEAR account in NEP-141 USDC), Intents adds nothing. Its value would be **cross-chain supplier payout**: the escrow releases USDC on NEAR and the supplier receives USDC on Base, Arbitrum, Solana and so on. A dry run is feasible with about $2 of USDC on mainnet, but it would sit outside the testnet escrow, would be a separate mainnet transaction signed by the human, and would show 1Click's capability rather than ours.

**Confidence:** high. The no-testnet statement comes from the verifier and quickstart pages and matches on-chain checks (`intents.testnet` has code hash `111…1`). The endpoints and status values come from the docs and the OpenAPI spec (v0.1.10). Medium on exact mainnet fees for the dry run, because fees vary by route.

**Decision recommended:** **Roadmap-only.** Name it in the README's roadmap and sustainability paragraph ("supplier on another chain: escrow release routes through NEAR Intents 1Click") and leave it out of the spine and the video. At most, add an optional read-only "cross-chain payout preview": a `dry: true` 1Click quote, which needs no funds, no signature and no deposit address. Add it only with the human's approval of the 1Click Terms of Use, and only in Tier 2.

## Details

### What exists (verified 2026-10-22)
| Component | Mainnet | Testnet |
|---|---|---|
| Verifier contract | `intents.near` (code hash `BtA1BEFNS619KkvXFsgcpQ21Tb5yMm32aaUkn7xNothk`, about 12.9 GB of state) | `intents.testnet` exists with **no code**; `defuse.testnet` exists with **no code** |
| 1Click API | `https://1click.chaindefuser.com/v0` (`GET /tokens`, `POST /quote`, `POST /deposit/submit`, `GET /status`) | none documented |
| Message Bus (solver relay) | JSON-RPC and WebSocket for market makers | none documented |
| Source | `github.com/near/intents` (the "defuse" verifier; pushed today) | You could deploy the verifier yourself, but with no solvers or bridges it could not do cross-chain, so it would prove nothing |

`GET /v0/tokens` (public, no auth) returns 205 assets, including:
- `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`: USDC on NEAR (native Circle USDC, 6 decimals)
- `nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near`: USDC on Base
- `nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near`: USDC on Arbitrum
- `nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near`: USDC on Solana

### What Intents would add to this product
- **Cross-chain supplier payout.** A supplier invoices in "USDC on Base". On release, the escrow (or the treasury) sends USDC to a 1Click deposit address with `recipientType: DESTINATION_CHAIN`, and the supplier receives Base USDC. The buyer never handles bridges.
- **Paying in what the supplier wants** (any asset-to-asset swap at release).
- It does **not** add anything to limits, approvals, escrow or records, which are the hero features. For the `realworld` and `business` tracks, the hints are "suggested, not required" (BRIEF_ASSESSMENT §2).

### How a 1Click payout works (from docs and OpenAPI)
1. `POST /v0/quote` with body `{dry, swapType: "EXACT_INPUT"|"EXACT_OUTPUT"|..., slippageTolerance (bps), originAsset, depositType: "ORIGIN_CHAIN"|"INTENTS", destinationAsset, amount, recipient, recipientType: "DESTINATION_CHAIN"|"INTENTS", refundTo, refundType, deadline}`. With `dry: true`, the response has **no `depositAddress`** and nothing is committed.
2. With `dry: false`, the response includes `depositAddress`. Send the tokens there; for NEAR USDC that is a plain `ft_transfer`.
3. Optionally call `POST /v0/deposit/submit {depositAddress, txHash}`, then poll `GET /v0/status?depositAddress=…`. The statuses are `PENDING_DEPOSIT → KNOWN_DEPOSIT_TX → PROCESSING → SUCCESS`, or `INCOMPLETE_DEPOSIT`, `REFUNDED`, `FAILED`.
4. Fees: protocol 0.0001%; unauthenticated 1Click adds 0.25%; with a JWT it is 0.20%, or 0.01% for USDC/USDT/DAI and same-asset multichain routes. Deposits below `minAmountIn` are refunded. The docs state no hard minimum.
5. A NEAR contract can also deposit straight into the verifier (`ft_transfer_call` to `intents.near`) and withdraw with `ft_withdraw {token, receiver_id, amount}` (1 yocto, 100 Tgas), but cross-chain withdrawal formats were not documented on the withdrawals page.

### Minimum viable mainnet dry run (only if the human approves)
- **The human must:** own a funded mainnet NEAR account (the payout account; buying NEAR or USDC means an exchange account and KYC); hold about 0.1 NEAR for gas and storage plus about 2 USDC on NEAR; own a destination address on Base or Arbitrum; and accept the 1ClickSwap API Terms of Use.
- **Steps:** a script calls `POST /v0/quote` (`dry:false`, `EXACT_INPUT`, 1 USDC NEAR to USDC Base, `refundTo` = the human's NEAR account). The human signs one `ft_transfer` of 1 USDC to `depositAddress` (`storage_deposit` first if the deposit address requires it). The script polls `/v0/status` until `SUCCESS` and records the NEAR tx hash and the Base tx hash.
- **Cost:** about 1 USDC moved (recoverable on Base) + 0.25% fee + gas under 0.01 NEAR.
- **Why not:** (1) It runs on **mainnet, outside our testnet escrow**, so it cannot be "the escrow paid a supplier cross-chain" without deploying contracts to mainnet, which the brief forbids. (2) It adds a human-signed mainnet step during the hardest week. (3) A judge sees a 1Click swap, which thousands of apps already show. (4) It costs video seconds we need for the refusal-then-approval beat.

### Note on observed content
The quickstart page tells the reader to fetch the docs index (`llms.txt`) "to discover all available pages". That is a documentation-navigation hint, not a request for action. HACKATHON.md's agent instructions are out of scope here. No instructions from pages were acted on.

## Open questions for the human
1. Intents: roadmap-only (recommended), a read-only `dry:true` quote preview in Tier 2, or a real mainnet dry run of about 1 USDC that you sign yourself?

## Sources
- https://docs.near-intents.org/integration/verifier-contract/introduction.md — mainnet `intents.near`; "There is no testnet deployment. Use small amounts for testing purposes." (accessed 2026-10-22)
- https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/introduction.md — "There is no testnet version of NEAR Intents"; JWT optional, +0.25% without (accessed 2026-10-22)
- https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/making-a-request.md — base URL, quote body, deposit, status values (accessed 2026-10-22)
- https://1click.chaindefuser.com/docs/v0/openapi.yaml — v0.1.10; `dry` semantics (no `depositAddress`); `minAmountIn` refund rule; X-API-Key/JWT security schemes (accessed 2026-10-22)
- https://1click.chaindefuser.com/v0/tokens — 205 supported assets; NEAR, Base, Arbitrum and Solana USDC asset ids (accessed 2026-10-22)
- https://docs.near-intents.org/resources/fees.md — protocol 1 pip; unauthenticated 25 bps; authenticated 20 bps / 1 bp for stablecoins (accessed 2026-10-22)
- https://docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/withdrawals.md — `ft_withdraw` args, 1 yocto, 100 Tgas (accessed 2026-10-22)
- https://github.com/near/intents — verifier ("defuse") source; README refers only to `intents.near` (accessed 2026-10-22)
- RPC `view_account` on `intents.testnet`, `defuse.testnet` (testnet, no code) and `intents.near` (mainnet, deployed) (accessed 2026-10-22)
