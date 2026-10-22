# 9. Record anchoring

**Question:** What is the cheapest credible way to anchor hashes of off-chain records (batch records, lot genealogy, approvals, movements) on NEAR: one stored hash per record, Merkle-root batching, or NEP-297 event logs only? What does storage cost now? Should anchoring be folded into the escrow or the policy contract? How does a judge verify an anchor?

**Answer:** Storage on NEAR costs **1e19 yoctoNEAR per byte (0.00001 NEAR/byte, about 100 KB per NEAR)**, plus a 40-byte overhead per trie record. A stored 32-byte hash keyed by a short record id, with small metadata, is about 100–160 bytes, or **about 0.001–0.0016 NEAR per anchor**. Gas is about 0.0003–0.0005 NEAR per transaction. For our scale (tens to a few hundred records in a demo) that is trivial on testnet. Event-only anchoring is cheaper (gas only), but it can only be checked through an explorer or indexer. Non-archival RPC nodes garbage-collect transactions after a few epochs (testnet epochs are 43,200 blocks), so a judge checking after Nov 16 would need NearBlocks or an archival RPC. **Store the hash in contract state and emit a NEP-297 event too.** That way a judge can verify with one free `view` call that never expires, and the explorer shows a readable event. Merkle-root batching is the right production pattern but adds proof tooling we don't need for the demo.

**Confidence:** high for storage price, record overhead and log limits (read from the live protocol config) and for the NEP-297 format and near-sdk `event_json` macro. Medium for the exact RPC garbage-collection window: the default of about 5 epochs comes from nearcore defaults I did not re-verify, and block time varies.

**Decision recommended:** Fold anchoring into the **spend-policy contract** as `anchor(kind, ref_id, sha256_hex, prev?)` and `anchor_batch(Vec<…>)`, callable only by registered agent accounts (Kevin's function-call key already targets this contract). Each record's hash includes its parents' hashes (genealogy as a hash chain). Every anchor is stored in a `LookupMap` and emitted as a `dayone` NEP-297 `record_anchored` event. Ship a `verify` script that a judge can run with no keys.

## Details

### Live protocol numbers (testnet RPC `EXPERIMENTAL_protocol_config`, protocol 88)
- `storage_amount_per_byte` = `10000000000000000000` yocto (1e-5 NEAR)
- `num_extra_bytes_record` = 40 (overhead per key-value pair in the trie)
- `num_bytes_account` = 100
- Logs: `max_number_logs` = 100, `max_total_log_length` = 16,384 bytes per receipt, so an `anchor_batch` of about 50 events (about 250 bytes each) fits
- Gas price: 1e8 yocto/gas, so 5 Tgas is about 0.0005 NEAR

### Options compared
| Pattern | On-chain cost per record | Judge verification | Durability | Effort |
|---|---|---|---|---|
| **A. Per-record hash in state + event** | about 0.001–0.0016 NEAR storage + gas (batching N per tx shares the gas) | one `view` call: `get_anchor(ref_id)`; plus the event on the explorer | permanent while the contract lives | low |
| B. Merkle root per batch (e.g. per day or per demo run) + event | about 0.001 NEAR per *batch* | needs the leaf, the proof path and a script to recompute the root | permanent | medium (proof generation, canonical leaf ordering) |
| C. Events only (NEP-297 log, no state) | gas only (about 0.0003 NEAR) | explorer/indexer (NearBlocks) or archival RPC with the tx hash; a contract cannot read its own past logs | depends on indexers; plain RPC forgets after GC | lowest |

Storage estimate for A: key = 1-byte collection prefix + Borsh string `ref_id` (4 + ~16 bytes); value = `Anchor { kind: u8, hash: [u8;32], prev: Option<[u8;32]>, by: AccountId(~20 bytes), at: u64 }`, about 95 bytes; plus 40 overhead, so about 155 bytes, or **about 0.0016 NEAR**. 300 anchors is about 0.5 NEAR (testnet, free). On mainnet at scale, B wins. Note this as the roadmap in CONTRACTS.md.

### What gets anchored (and what doesn't)
- **Batch record** (confirmed extraction): `sha256(canonical_json(record) + salt)`.
- **Lot genealogy**: each batch's genealogy record lists its input lot ids and *their* last anchored hashes, so the batch hash commits to its inputs (a hash chain, which is the audit-friendly story). `prev` holds the hash of the previous state of the same lot.
- **Lot state transitions** (quarantine, released and so on) and **cross-facility transfers**.
- **Approvals and payments** are *already* on-chain as transactions (`approve(po_id)` in policy; fund/release in escrow). Don't double-anchor them; reference their tx hashes in the off-chain record instead.
- **Privacy:** add a random 16-byte salt per record, stored off-chain. Without it, low-entropy records (a PO with a price, a lot with a quantity) could be brute-forced from the public hash. Fictional fixture files ship with their salts so judges can verify.
- **Canonicalisation:** use RFC 8785 JSON Canonicalization (JCS) or a fixed key-sorted serializer in one shared TS module, so the verify script and the server hash identically.

### Contract surface (in spend-policy)
```rust
#[near(event_json(standard = "dayone"))]
pub enum DayOneEvent {
    #[event_version("1.0.0")]
    RecordAnchored { kind: String, ref_id: String, hash: String, prev: Option<String>, by: AccountId },
    // policy/escrow events live in the same enum: PoRefused, PoApproved, PoFunded, PoReleased ...
}
pub fn anchor(&mut self, kind: RecordKind, ref_id: String, hash: Base64VecU8 /* or hex String */, prev: Option<String>);
pub fn anchor_batch(&mut self, items: Vec<AnchorInput>);   // cap at ~50 for the log limit
pub fn get_anchor(&self, ref_id: String) -> Option<AnchorView>;
```
- Access: `require!(self.agents.contains(&env::predecessor_account_id()))`. Re-anchoring an existing `ref_id` panics (append-only). Corrections become new `ref_id`s with `prev` pointing back.
- Emits `EVENT_JSON:{"standard":"dayone","version":"1.0.0","event":"record_anchored","data":{...}}` (NEP-297: `EVENT_JSON:` prefix + `standard`, `version`, `event`, optional `data`).
- Storage is paid from the contract's balance (fund it at deploy). Function-call keys can't attach deposits, so Kevin cannot pay per call.

### Why the policy contract, not the escrow
- Kevin's function-call key is already scoped to the policy contract, so anchoring needs no second key.
- The escrow should stay minimal and money-only, because it is the contract most worth keeping auditable. Its fund/release transactions are records in themselves.
- A separate anchor contract is also fine (an account can hold several function-call keys), but it costs one more deployment and one more account for little gain. Choose it only if the policy contract grows past easy review.

### How a judge verifies an anchor
1. **No keys, one command (replay mode):** `npm run verify -- data/batch-records/BR-0412.json`. This canonicalises the file with its salt, computes sha256, calls `get_anchor("BR-0412")` via public RPC (`https://test.rpc.fastnear.com`), prints MATCH or MISMATCH, and prints the NearBlocks link of the anchoring transaction (stored in the replay fixture).
2. **Manually:** `near contract call-function as-read-only <policy>.testnet get_anchor json-args '{"ref_id":"BR-0412"}' network-config testnet now`, then compare with `sha256sum` of the canonical bytes (the README shows how to produce them).
3. **Explorer:** open the tx on `testnet.nearblocks.io`. The receipt logs show the `EVENT_JSON` with `ref_id` and `hash`.
4. **Tamper demo:** edit one gram in the fixture, rerun verify, and get MISMATCH. This is a five-second beat for the video and a perfect "do X → see Y" README step.

## Open questions for the human
None. This is a technical choice; record it in CONTRACTS.md.

## Sources
- RPC `https://rpc.testnet.near.org` `EXPERIMENTAL_protocol_config` — `storage_amount_per_byte` 1e19, `num_extra_bytes_record` 40, log limits 100 / 16,384 B, `epoch_length` 43,200, gas price 1e8 (accessed 2026-10-22)
- https://github.com/near/NEPs/blob/master/neps/nep-0297.md — event format: `EVENT_JSON:` prefix, `standard`/`version`/`event`/`data` (accessed 2026-10-22; nomicon.io/Standards/EventsFormat redirects here)
- https://docs.rs/near-sdk/5.29.1/near_sdk/attr.near.html — `#[near(event_json(standard = ...))]` with `#[event_version]` and `.emit()`; `store::LookupMap`/`IterableMap` (accessed 2026-10-22)
- https://docs.near.org/api/rpc/providers — archival RPC endpoints "severely rate limited" on the free tier (accessed 2026-10-22)
- https://api-testnet.nearblocks.io/ — indexer API used to list testnet transactions (accessed 2026-10-22)
- https://www.rfc-editor.org/rfc/rfc8785 — JSON Canonicalization Scheme (referenced; not fetched)
