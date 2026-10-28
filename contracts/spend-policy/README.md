# contracts/spend-policy

One NEAR contract that holds a plant's budget, enforces each purchasing agent's limits, records director approvals, escrows every authorized PO until QC releases it, and stores record fingerprints. Spec: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md).

| File | What it holds |
|---|---|
| `src/lib.rs` | State, methods, `submit_po` checks, the escrow state machine, anchoring |
| `src/events.rs` | NEP-297 events, standard `dayone_spend_policy` |
| `src/util.rs` | Dollar formatting for refusal messages, the `YYYYMM` spend period, hash checks |
| `src/tests.rs` | Unit tests (CONTRACTS.md §7); token transfers are mocked |

Build and test on Linux, macOS or WSL2, from `contracts/`:

```bash
cargo test
```

```bash
cd spend-policy && cargo near build non-reproducible-wasm
```

Sandbox tests with a real fungible-token wasm are not written yet.
