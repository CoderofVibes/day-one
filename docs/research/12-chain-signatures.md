# 12. Chain Signatures

**Question:** Does Day One need NEAR Chain Signatures, and if not, when would it?

**Answer:** No. Chain Signatures let a NEAR account or contract sign transactions for *other* chains (Bitcoin, Ethereum and other EVM chains, Solana and more) through the MPC signer contract (`v1.signer` on mainnet, `v1.signer-prod.testnet` on testnet; both verified live today). Everything in Day One's spine happens on NEAR: the policy check, the director's approval, escrow in NEP-141 USDC, payout to a supplier's NEAR account, and record anchoring. No foreign-chain transaction is ever signed. Chain Signatures would matter only if a contract had to **control funds or execute payments on another chain directly**. Example: a supplier is paid from an acquirer treasury that lives on Ethereum or Base, or the escrow holds USDC on Base while NEAR enforces the policy. Even then, for "pay a supplier on another chain", NEAR Intents (task 2) is the simpler route, because the funds stay on NEAR and the solver network delivers them cross-chain.

**Confidence:** high. The product's chain footprint is fully NEAR-native, and both signer accounts exist on-chain with the same code hash.

**Decision recommended:** Do not use Chain Signatures. Mention it in the README roadmap in one line: "a treasury on another chain, governed by the same NEAR policy contract via Chain Signatures."

## Details
- `v1.signer` (mainnet) and `v1.signer-prod.testnet` (testnet) both exist with code hash `DAE5ng4ZFR2ctMx9SizQBqmGkVbKUutgZ4ZECD4R8Sm9` (RPC `view_account`, 2026-10-22).
- The docs list Bitcoin, Solana, Cosmos, XRP, Aptos, Sui and EVM networks as targets.
- It would add MPC signing latency, foreign-chain gas funding and a second explorer to the demo, all of which work against "invisible chain" and the 2-minute video.

## Sources
- https://docs.near.org/chain-abstraction/chain-signatures — purpose, `v1.signer`, supported chains (accessed 2026-10-22)
- RPC `view_account` on `v1.signer` (mainnet) and `v1.signer-prod.testnet` (testnet) — both deployed, same code hash (accessed 2026-10-22)
