# contracts/dtusd

Day One Test USD (DTUSD): a plain NEP-141 fungible token with 6 decimals, the testnet stand-in for USDC that demo POs settle in, so PO-1042 can be a real $5,150.00 (CONTRACTS.md §2, decision #22). Built on `near-contract-standards`. `new(owner_id, total_supply)` mints the whole supply to Acme's treasury; there is no later minting. The icon is our own "D1" mark, never the USDC logo.

The sandbox test in `../spend-policy/tests/sandbox.rs` uses this token.
