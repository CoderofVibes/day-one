# contracts/spend-policy

One NEAR contract that holds a plant's budget, enforces each purchasing agent's limits, records director approvals, escrows every authorized PO until QC releases it, and stores record fingerprints. Spec: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md).

| File | What it holds |
|---|---|
| `src/lib.rs` | State, methods, `submit_po` checks, the escrow state machine, anchoring |
| `src/events.rs` | NEP-297 events, standard `dayone_spend_policy` |
| `src/util.rs` | Dollar formatting for refusal messages, the `YYYYMM` spend period, hash checks |
| `src/tests.rs` | Unit tests (CONTRACTS.md §7); token transfers are mocked |
| `tests/sandbox.rs` | The purchasing loop on a local node with the DTUSD token |

Build and test on Linux, macOS or WSL2, from `contracts/`:

```bash
cargo test
```

```bash
cd spend-policy && cargo near build non-reproducible-wasm
```

`cargo test` also runs `tests/sandbox.rs`: it builds this contract and `../dtusd`, starts a local NEAR node (near-sandbox downloads its binary on first use), and walks the demo's purchasing loop with real token transfers.
