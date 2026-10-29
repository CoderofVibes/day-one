# 24. Supplier credentials (soulbound tokens) and reputation

**Question:** Can each approved supplier hold an on-chain credential that the spend-policy contract actually checks before it funds a PO (issued by HQ with an expiry and the categories the supplier may sell, revocable), with the supplier's delivery record folded into the same token? What does NEAR's soulbound token standard (NEP-393) say today, and does the credential live in `spend-policy` or in a separate registry contract?

**Answer:** NEP-393 is **Final** (v1.0.0 approved by the Contract Standards Working Group, June 30 2023; a v1.1.0 changelog follows). It splits the work between an **issuer** (mints, renews, revokes) and a **registry** (the balance book), but explicitly allows **one contract to be both**: an issuer may skip the registry, implement the registry's query methods itself and emit the `nep393` events itself. That is the right shape here. `spend-policy` issues the credential, stores it under its own storage prefix, checks it inside `submit_po` with no cross-contract call, and exposes the standard's views (`sbt`, `sbt_tokens`, `sbt_tokens_by_owner`, `sbt_supply`, `sbt_supply_by_owner`, `sbt_metadata`, `sbt_class_metadata`) and events (`mint`, `renew`, `revoke`), so an SBT-aware indexer or wallet reads it like any other SBT. A separate registry such as i-am-human's would put a promise and a callback on the `submit_po` path. Then a refusal is no longer one atomic panic with a plain reason, two contracts have to stay in step, and the gate depends on someone else's deployment. Not worth it for this build.

**Confidence:** high for the standard's status, roles, method signatures, events and revoke semantics (read from the NEP text on GitHub, Oct 28 2026). Medium for how the optional NFT views are picked up by wallets: the standard offers them as an optional `SBTNFT` trait, and I did not test a wallet against them. docs.near.org (via the near-docs MCP server, Oct 28) covers NEP-171/177/178 but has no page on NEP-393 or soulbound tokens. `near-contract-standards` 5.29.1 has no SBT module (checked in the installed crate), so the views are written by hand.

**Decision taken (within the brief of OPEN_QUESTIONS #35):** the credential lives in `spend-policy`, additive, under new storage prefixes. Reputation (released / rejected deliveries, consecutive rejects, last outcome) is part of the same record, and a contract rule suspends a supplier after N consecutive QC rejects (default 2, confirmed by Tony on Oct 28, OPEN_QUESTIONS #36) until HQ reinstates it. Details in CONTRACTS.md §3.1.

## Details

### NEP-393 as of Oct 28 2026 (github.com/near/NEPs, `neps/nep-0393.md`)
- Status Final; author Robert Zaremba; created Sep 12 2022; v1.0.0 approved Jun 30 2023.
- **Roles.** Issuer: an SBT contract that mints, renews, revokes and recovers its tokens and defines their metadata. Registry: keeps the balance book for every issuer, isolates issuers from each other, handles soul transfer and bans. An issuer should use one registry. **An issuer may be its own registry**: it implements the registry query methods, its address is the deployed account, and it emits the events itself.
- **Types.** `TokenId` and `ClassId` are `u64`. `Token { token, owner, metadata }`. `TokenMetadata { class (required, non-zero), issued_at, expires_at, reference, reference_hash }`. **Times are Unix milliseconds.** `IssuerMetadata { spec, name, symbol, icon, base_uri, reference, reference_hash }`, `ClassMetadata { name, symbol, icon, reference, reference_hash }`.
- **Registry views.** `sbt(issuer, token) -> Option<Token>`, `sbts(issuer, tokens)`, `sbt_classes(issuer, tokens)`, `sbt_supply(issuer) -> u64`, `sbt_supply_by_class(issuer, class)`, `sbt_supply_by_owner(account, issuer, class) -> u64`, `sbt_tokens(issuer, from_token, limit, with_expired) -> Vec<Token>`, `sbt_tokens_by_owner(account, issuer, from_class, limit, with_expired) -> Vec<(AccountId, Vec<OwnedToken>)>`, `is_banned(account)`.
- **Issuer views.** `sbt_metadata() -> IssuerMetadata`, `sbt_class_metadata(class) -> Option<ClassMetadata>`.
- **Revoke.** Always emits `revoke`. With `burn = true` the token is removed and `burn` is emitted too. With `burn = false` the token stays and **its expiry is set to the past**. Revoke never bans.
- **Renew** updates `expires_at`. **Expired tokens stay in the registry**; queries with `with_expired = false` leave them out.
- **Events.** Standard `nep393`, version `1.0.0`: `mint { issuer, tokens: [[owner, [ids]]] }`, `renew { issuer, tokens }`, `revoke { issuer, tokens }`, `burn`, `recover`, `ban`, `soul_transfer`, `token_reference`.
- **NEP-171.** SBT "partially follows" NEP-171: `u64` ids, a required class, smaller metadata, no transfer, its own events. NFT-style reads are an optional `SBTNFT` trait (`nft_total_supply`, `nft_tokens_for_owner`, `nft_supply_for_owner`); an issuer that offers them **must not emit NFT events**.

### NEP-171 / NEP-177 views (docs.near.org `primitives/nft/standard`)
- `nft_token(token_id: string) -> { token_id, owner_id, ... } | null`; NEP-177 token metadata has `issued_at`, `expires_at` and `updated_at` in Unix ms, and `extra` for anything else.
- Transfers (`nft_transfer`, `nft_transfer_call`) need 1 yocto and the owner or an approved account. A credential must not be transferable, so the contract offers the read side only. It does not claim to be an NFT contract.

### Where the credential lives: options compared
| Option | `submit_po` path | Refusal | Who can break it | Effort |
|---|---|---|---|---|
| **A. Inside `spend-policy`** (taken) | one contract, synchronous read of a `LookupMap` | one atomic panic with a plain reason, same as every other check | only HQ's owner key changes credentials | low: one module, views by hand |
| B. Own registry contract, `spend-policy` calls it | promise + callback; funding moves into the callback | the refusal is a callback result, not a failed transaction; staff see a "success" transaction that funded nothing | two deployments must agree; a registry upgrade can change the gate | medium-high |
| C. Third-party registry (i-am-human `registry-v2.i-am-human.testnet`) | as B, plus the registry's own issuer rules | as B | another team's deployment and governance | high, and its classes are proof-of-humanity, not vendor approval |

A wins on every axis that matters for the gate. The standard's single-contract case means A gives up nothing that an indexer or wallet reads. What it gives up is a shared registry where another acquirer could see Acme's credentials alongside others. That is a production question: the same token data could be minted into a shared registry later, but `spend-policy` would still check its own copy.

### Design choices (recorded here; the spec is CONTRACTS.md §3.1)
- **One token per supplier.** Re-issuing renews the same token id (`renew` event) and keeps the delivery record. A revoked token is not burned (`burn = false`, so the history stays), and the standard views report its expiry as the revocation time, as NEP-393 prescribes.
- **Additive storage.** No new field in the root state struct: the credentials, the token index, the token counter and the suspension rule sit under their own byte-string prefixes (`cred:s`, `cred:t`, `cred:n`, `cred:r`), opened per call. Byte strings rather than new `StorageKey` variants, so the two other sessions changing this contract cannot pick the same prefix by adding variants in a different order. Existing method signatures are unchanged.
- **The credential is the permission.** `submit_po` refuses a supplier whose credential is missing, revoked, expired, suspended or without the PO's category, before the approval branch, so no director approval overrides it. The status (`Qualified` / `Conditional`) stays in the existing supplier list; `issue_credential` writes both.
- **Reputation counts settled outcomes only.** A delivery counts as released when the payout transfer succeeds (`on_payout`), not when QC clicks release, so a failed payout and a second release never count twice. A QC reject counts at once. HQ's `cancel` is not a delivery and does not count.
- **Times.** The contract stores nanoseconds like every other field; the NEP-393 views convert to milliseconds.
- **Rehearsals reject Northgate.** `npm run rehearse` ends with a QC reject of a throwaway PO to Northgate. With the default rule two rehearsals in a row (with no release between them) suspend Northgate. So the rehearsal prints Northgate's delivery record after the reject, prints HQ's `reinstate_supplier` command when Northgate is suspended, and stops before placing a PO if Northgate is already suspended. A live demo's PO-1042 release ends the run of rejects.

### Sources
- NEP-393 text: https://github.com/near/NEPs/blob/master/neps/nep-0393.md (read Oct 28 2026)
- NFT standard page: https://docs.near.org/primitives/nft/standard (near-docs MCP, Oct 28 2026)
- i-am-human registry (NEP-393 registry implementation, testnet `registry-v2.i-am-human.testnet`): https://github.com/near-ndc/i-am-human (README, Oct 28 2026)
