# 8. Escrow contract patterns, SDK choice and toolchain

**Question:** What is the right PO-escrow pattern on NEAR (fund via `ft_transfer_call`, release on receipt/QC by an authorized account, refund/cancel), and what examples exist? Rust `near-sdk` or JS `near-sdk-js`: which versions, how mature, what test tooling? Does `cargo-near` work on native Windows 11 or does it need WSL or Docker? Which server-side libraries and versions should we use?

**Answer:** Use **Rust `near-sdk` 5.29.1** (MSRV Rust 1.95) built with **`cargo-near` 0.22.0**. `near-sdk-js` is effectively unmaintained: last release 2.0.0 in June 2024, last repo push March 2025, and NEAR's docs say they "focus on Rust". `cargo-near` has native Windows binaries, and a contract wasm builds natively. However, **ABI generation still fails under MSVC** (open issues #188 and #388; `--no-abi` works). More decisively, **the local test sandbox (`near-sandbox` / `near-workspaces`) ships no Windows binary** (only Linux x86-64 and macOS ARM64; Windows tracking issue #78 has been open since 2022). Native Windows Rust also needs the MSVC C++ Build Tools for the host linker. So use **WSL2 (Ubuntu) for contracts**, with no Docker. The escrow pattern is a small state machine keyed by PO id, funded through `ft_on_transfer`, paying out with `ft_transfer` + a rollback callback. The near-examples FT-auction (`ft_on_transfer` + `ft_transfer`) is the closest official template.

**Confidence:** high for the versions (crates.io, npm and GitHub release APIs today) and for the Windows sandbox gap (source and README of `near-sandbox-rs`, open issue). Medium for the Windows `cargo-near` ABI failure: the issue and fix PR are still open, but the newest `cargo-near` might partly work around it. Low for the disk figures, which are estimates and were not measured.

**Decision recommended:** Write both contracts in Rust (one Cargo workspace: `contracts/spend-policy`, `contracts/po-escrow`), build and test them inside WSL2 Ubuntu with `cargo near build non-reproducible-wasm`, and keep `CARGO_TARGET_DIR` on the WSL filesystem. Test with near-sdk unit tests (`testing_env!`) plus `near-sandbox` + `near-api` integration tests. Keep everything off-chain in TypeScript with **`near-api-js` 7.3.1**, and use **`near-cli-rs` 0.30.1** for scripts and manual checks.

## Details

### Current versions (verified 2026-10-22)
| Tool | Stable | Pre-release | Notes |
|---|---|---|---|
| `near-sdk` (crate) | **5.29.1** (2026-09-17) | 5.30.0-rc.1 (2026-10-19) | README: MSRV **1.95.0** |
| `cargo-near` (crate / GitHub) | **0.22.0** (2026-07-14) | 0.23.0-rc.2 (2026-10-19) | Windows `.msi` and `cargo-near-installer.ps1` published per release |
| `near-sandbox` (crate) | **0.3.16** (2026-09-04) | 0.4.0-rc.2 | default sandbox node `2.14.0-rc.4`; platforms: Linux x86-64, macOS ARM64 |
| `near-workspaces` (crate) | **0.23.0** (2026-07-09) | 0.24.0-rc.2 | still released; newer near-examples use `near-sandbox` + `near-api` instead |
| `near-api` (crate) | **0.8.6** (2026-04-15) | — | Rust client used by near-examples tests |
| `near-cli-rs` (crate / npm / GitHub) | **0.30.1** (2026-09-02) | 0.31.0-rc.2 | Windows `.msi` published |
| `near-sdk-contract-tools` (crate) | 4.0.0 (2026-04-13) | — | optional: Owner/Rbac/Pause/NEP-297 helpers (compatibility with 5.29 not checked) |
| `near-api-js` (npm) | **7.3.1** (2026-08-12) | 7.0.0-rc.7 tag | v7 is a single package; replaces the old split `@near-js/*` packages (2.5.1, Nov 2025), with a migration guide |
| `near-kit` (npm) | 0.20.2 (2026-09-24) | — | alternative TS client listed in NEAR docs; has post-quantum key support |
| `near-sdk-js` (npm) | 2.0.0 (**2024-06-07**) | — | repo last pushed 2025-03-28 |
| `near-workspaces` (npm) | 5.0.0 (2025-03-13) | — | JS sandbox tests; same platform limits |
| `near-sandbox` (npm) | 0.3.4 (2026-09-04) | — | |
| `near-cli` (legacy JS CLI, npm) | 4.0.13 (2024-03) | — | do not use; `near-cli-rs` is current |

Network facts (RPC `EXPERIMENTAL_protocol_config`, testnet): protocol 88; `max_gas_burnt` per receipt and `max_total_prepaid_gas` = **1,000 Tgas**; gas price 1e8 yocto/gas (0.0001 NEAR per Tgas); storage 1e19 yocto/byte. RPC: prefer `https://test.rpc.fastnear.com` (the default in the near-api-js README). `rpc.testnet.near.org` still answers.

### Rust vs JS
| | Rust `near-sdk` | JS `near-sdk-js` |
|---|---|---|
| Maintenance | releases monthly; repo pushed today | no release since June 2024 |
| Docs and examples | all official tutorials (FT, auctions, cross-contract) | docs say documentation "focuses on Rust" |
| FT receiver helpers | `near-contract-standards` `FungibleTokenReceiver`, `ext_ft_core` | manual |
| Gas and size | small wasm, predictable gas | larger (embedded QuickJS), higher gas |
| Judges | Rust contracts read as "serious" to Illia, Mert and others | unusual, and the SDK is stale |

Rust wins clearly. The contracts are small (two state machines plus a map), so Rust's learning curve is not a real cost for Claude Code.

### Windows 11 findings
- **Building:** `cargo-near` installs natively (PowerShell installer or MSI). Per issue #188, `cargo near build --no-abi` and plain `cargo build --target wasm32-unknown-unknown --release` succeed on Windows. ABI generation fails with MSVC linker LNK2019 errors (fix PR #388 is still open). Native Rust on Windows also needs **Visual Studio C++ Build Tools** (several GB) for build scripts and proc-macros.
- **Testing:** `near-sandbox-rs` README: "MacOS (ARM64) or Linux (x86) for sandbox execution". `near-workspaces-rs` issue #78 "Windows builds" is open, and #159 (`compile_error!("Unsupported platform")`) was closed as its duplicate in March 2026. So **sandbox integration tests cannot run on native Windows.**
- **Docker** is only needed for `cargo near build reproducible-wasm` (verifiable builds for explorer source verification). That is optional, so skip it to save disk.
- **WSL2 caveat** (NEAR quickstart): near-cli-rs may fail to save keys to the system keychain in WSL. Use `save-to-legacy-keychain` (`~/.near-credentials`), or keep CLI signing on Windows and let WSL only build and test.
- **Disk (estimates, unmeasured):** WSL2 Ubuntu around 2 GB; rustup stable + `wasm32-unknown-unknown` around 1.5 GB; workspace `target/` with near-sdk + near-api + tokio for tests around 3–6 GB (run `cargo clean` regularly); the sandbox binary is about 100 MB and per-test state is temporary. Total is about 7–10 GB, within the 15–25 GB budget. Native Windows would add about 6 GB for VS Build Tools and still could not run the sandbox.
- **Performance tip:** keep the source on `C:\Dev` (shared with Windows editors) but set `CARGO_TARGET_DIR=~/target/day-one` in WSL. Building on `/mnt/c` is slow.
- **On "no local NEAR node" (brief §13):** `near-sandbox` is an ephemeral, single-process test chain started and killed by `cargo test`, not a synced node. I consider it within the rule, but it is a decision for the human. Fallback without it: unit tests with `testing_env!` (no cross-contract calls), plus a scripted integration test against testnet using throwaway sub-accounts (slower, network-dependent).

### PO escrow pattern (recommended shape)
State, one entry per PO in `near_sdk::store::LookupMap<PoId, Po>` (plus `IterableMap` if we want listing):
```
Po { po_id, buyer, supplier, token: AccountId, amount: U128,
     status: AwaitingFunds | Funded | Received | Released | Refunded | Cancelled,
     receiver_role: AccountId (dock), qc_role: AccountId, created_at, funded_at, ... }
```
Methods (all state changes emit NEP-297 events, see task 9):
- `create_po(po_id, supplier, amount, ...)`: callable **only by the spend-policy contract** (`predecessor == policy_id`), after policy approval. Alternatively, the policy contract passes all PO fields in `msg` and the escrow creates the PO inside `ft_on_transfer`, which saves one cross-contract hop and is simpler.
- `ft_on_transfer(sender_id, amount, msg) -> PromiseOrValue<U128>`: require `predecessor == token` (USDC) and `sender_id == policy_id` (only the treasury funds POs). Parse `msg = {"po_id": ...}`, require `AwaitingFunds` and an exact amount, set `Funded`, return `U128(0)`. On a business-rule refusal, **return `U128(amount)`** (auto-refund) rather than panicking.
- `confirm_receipt(po_id)`: `predecessor == po.receiver_role` (dock account via relayer); `Funded → Received`.
- `qc_release(po_id)`: `predecessor == po.qc_role`; `Received → Released` (pending). Calls `ext_ft_core::ext(token).with_attached_deposit(1 yocto).with_static_gas(30 Tgas).ft_transfer(supplier, amount, Some(memo))`, then `.then(Self::ext(self_id).with_static_gas(10 Tgas).on_payout(po_id))`.
- `#[private] on_payout(po_id, #[callback_result] r)`: on error, revert to `Received` and emit `payout_failed`. Use an explicit `Paying` status during the in-flight promise so `qc_release` cannot run twice.
- `cancel(po_id)`: buyer or director, only while `Funded` and before receipt. Refunds `ft_transfer` to the policy/treasury with the same callback pattern. Optional `deadline` for supplier non-delivery.
- Views: `get_po(po_id)`, `list_pos(from, limit)`.

Rules to keep:
- Every account that receives USDC (supplier agents, treasury) must be registered with the USDC contract first (`storage_deposit`, 0.00125 NEAR), so the setup script handles it. The escrow can't easily check registration synchronously; the rollback callback covers this.
- `ft_transfer` needs exactly 1 yocto, so only **contracts or full-access keys** can move USDC. Function-call keys (Kevin, relayed staff) can never move tokens directly (see task 1). This is good: "keys scope what, contracts decide how much."
- The contract account needs NEAR for its own storage (about 0.003–0.005 NEAR per PO record, from 1e19 yocto/byte × roughly 300–500 bytes). Either fund the contract at deploy (testnet NEAR is free) or have `create_po` require an attached deposit from the policy contract.
- Release split (receipt, then QC) is optional for the spine; one `release` gated on QC is the minimum. Keep both if the dock-photo beat stays in the demo.
- Consider merging escrow into the policy contract if time is short. One contract removes a cross-contract hop and one deployment, at the cost of a less legible "rules vs money" split. Default: two crates, as in the brief.

### Existing examples to learn from (all checked today)
- `near-examples/auctions-tutorial/contract-rs/03-bid-with-fts`: `ft_on_transfer` with a predecessor check, refund via `ft_transfer` + 1 yocto, `claim()` payout. Its tests use `near-sandbox` 0.3 + `near-api` 0.8 + `cargo-near-build` and deploy a prebuilt FT wasm (`tests/fungible_token.wasm`). **Use this as the template for our integration tests** (deploy an FT wasm in the sandbox to stand in for USDC).
- `near-examples/FT` (pushed Feb 2026): canonical NEP-141, including a `defi` receiver contract used in tests.
- `near-examples/cross-contract-calls`: callback and `#[callback_result]` patterns.
- `near-examples/near-workspaces-examples`: if we prefer `near-workspaces`.
- No maintained "PO escrow" example exists in near-examples. A GitHub search for "near escrow ft_on_transfer" returned no notable repos, so our contract is original work.

### Commands (inside WSL2 Ubuntu; for Nov 1+, not to run now)
```
rustup toolchain install stable   # >= 1.95
rustup target add wasm32-unknown-unknown
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
cargo near new po-escrow          # template includes sandbox tests and CI workflow
cargo near build non-reproducible-wasm
cargo test                        # unit + sandbox integration
near contract deploy <escrow>.testnet use-file target/near/po_escrow.wasm with-init-call new json-args '{...}' ...
```
Server side (Windows/Node): `npm i near-api-js@7.3.1`; read calls go through `provider.callFunction`, writes through `account.callFunction({contractId, methodName, args, gas: teraToGas('30'), deposit})`.

## Open questions for the human
1. Is WSL2 (Ubuntu) already installed, or may Phase 1 install it (about 7–10 GB with the Rust toolchain)? Native Windows is possible for builds but not for sandbox tests.
2. Does the "no local NEAR node" rule allow the ephemeral `near-sandbox` test binary (about 100 MB, runs only during `cargo test`)?

## Sources
- https://crates.io/api/v1/crates/near-sdk, /cargo-near, /near-workspaces, /near-sandbox, /near-cli-rs, /near-api, /near-sdk-contract-tools — versions and dates (accessed 2026-10-22)
- https://registry.npmjs.org/near-api-js, /near-sdk-js, /near-workspaces, /near-sandbox, /near-cli, /@near-js/client, /near-kit, /near-cli-rs — versions and dates (accessed 2026-10-22)
- https://github.com/near/near-sdk-rs (README) — MSRV 1.95.0 (accessed 2026-10-22)
- https://github.com/near/cargo-near (README; releases API) — PowerShell installer, Windows MSI, `non-reproducible-wasm` vs Docker `reproducible-wasm`, Git dependency (accessed 2026-10-22)
- https://github.com/near/cargo-near/issues/188 and /pull/388 — Windows MSVC ABI-generation failure; `--no-abi` works; fix still open (accessed 2026-10-22)
- https://github.com/near/near-sandbox-rs — "MacOS (ARM64) or Linux (x86)"; `DEFAULT_NEAR_SANDBOX_VERSION = "2.14.0-rc.4"` (accessed 2026-10-22)
- https://github.com/near/near-workspaces-rs/issues/78 and /issues/159 — no Windows sandbox binaries; open (accessed 2026-10-22)
- https://github.com/near/near-sdk-js and https://api.github.com/repos/near/near-sdk-js — last push 2025-03-28 (accessed 2026-10-22)
- https://docs.near.org/smart-contracts/quickstart — Rust-first docs; WSL keychain note; `cargo near new` (accessed 2026-10-22)
- https://docs.near.org/tools/near-api — near-api-js and near-kit as JS options; `near-api` crate (accessed 2026-10-22)
- https://github.com/near/near-api-js (README) — v7 single package, `Account.callFunction`, FastNEAR testnet RPC (accessed 2026-10-22)
- https://docs.near.org/api/rpc/providers — FastNEAR `test.rpc.fastnear.com`, other free providers (accessed 2026-10-22)
- https://github.com/near-examples/auctions-tutorial/tree/main/contract-rs/03-bid-with-fts — `ft_on_transfer` template; sandbox + near-api test pattern (accessed 2026-10-22)
- https://docs.rs/near-sdk/5.29.1/near_sdk/attr.near.html — `#[near(event_json(...))]`, store collections (accessed 2026-10-22)
- RPC `EXPERIMENTAL_protocol_config` on testnet — protocol 88, 1,000 Tgas limits, storage price (accessed 2026-10-22)

## Addendum 2026-10-25

- **RPC:** the docs.near.org provider table no longer lists `rpc.testnet.near.org`, and marks `*.near.org` endpoints deprecated; it still answers today (protocol 88). Primary stays `test.rpc.fastnear.com` (FastNear docs also name `rpc.testnet.fastnear.com`; API key optional). Add `near-testnet.drpc.org` as a second fallback.
- **Versions:** near-sdk 5.29.1 still stable (5.30.0-rc.1 on Oct 19); cargo-near 0.22.0 (0.23.0-rc.2); near-sandbox 0.3.16 (0.4.0-rc.2). The NEAR devtools status post marks near-workspaces-rs "deprecating" in favour of near-sandbox + near-api, which is our choice. Do not take rc lines mid-hackathon.
- **Merge decision:** BUILD_ANALYSIS §4.2 recommends merging escrow into the policy contract now rather than on Nov 4 (OPEN_QUESTIONS #21).
- **Test FT:** the global FT contract `ft.globals.primitives.testnet` exists (hash `3vaopJ7aRoivvzZLngPQRBEd8VJr2zPLTxQfnRCoFgNX`, 275 KB); `new_default_meta` decimals are undocumented, so check `ft_metadata` after deploy and redeploy with 6 if it differs.
- nearcore 2.14 also set `burnt_gas_reward` to 0 and rejects an empty `method_name`; neither affects this design.
