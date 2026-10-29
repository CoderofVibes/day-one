# contracts/spend-policy

One NEAR contract that holds a plant's budget, enforces each purchasing agent's limits, records director approvals, escrows every authorized PO until QC releases it, and stores record fingerprints. It also holds the supplier credentials, group purchasing pools and sealed quote rounds. Spec: [`docs/CONTRACTS.md`](../../docs/CONTRACTS.md).

| File | What it holds |
|---|---|
| `src/lib.rs` | State, methods, `submit_po` checks, the escrow state machine, pooled POs, anchoring |
| `src/credentials.rs` | Supplier credentials: categories, expiry, revocation, the delivery record and suspension after QC rejects (§3.1) |
| `src/sealed.rs` | Sealed-bid quote rounds: commit window, reveal window, award only to a revealed quote (§10) |
| `src/events.rs` | NEP-297 events, standard `dayone_spend_policy` |
| `src/util.rs` | Dollar formatting for refusal messages, the `YYYYMM` spend period, hash checks |
| `src/tests.rs`, `src/tests/`, `src/sealed/tests.rs` | Unit tests (CONTRACTS.md §7), including group purchasing and credentials; token transfers are mocked |
| `tests/sandbox.rs` | The purchasing loop and group purchasing on a local node with the DTUSD token |
| `tests/credentials_sandbox.rs` | The four supplier-credential attacks on a local node, and their recording for `npm run test:attacks` |
| `tests/sealed_round.rs` | A sealed round on a local node with real block time: late commit, early reveal and mismatched reveal refused |

Build and test on Linux, macOS or WSL2, from `contracts/`:

```bash
cargo test
```

```bash
cd spend-policy && cargo near build non-reproducible-wasm
```

`cargo test` also runs the files in `tests/`: they build this contract and `../dtusd`, start a local NEAR node (near-sandbox downloads its binary on first use), and send real transactions with real token transfers.
