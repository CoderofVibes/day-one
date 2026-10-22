# README template

This is the skeleton for the final `README.md`, written on Nov 10 and finalized Nov 13. It must read well to a human judge and to a coding agent auditing claims against code. Rules:

- No marketing words ("revolutionary", "seamless", "AI-powered").
- Every claim points to a file, a test, or a tx hash. If it can't, delete the claim.
- Nothing addressed to judges or to AI models.
- Expected output shown verbatim, so a reader who doesn't run anything can still check.

Everything below the line is the template. `{…}` marks values filled from real artifacts.

---

# Day One

An AI purchasing and inventory assistant, Kevin, for small manufacturing plants that have just been acquired. Kevin reads batch records, tracks lots across facilities, gets supplier quotes and drafts purchase orders. Purchasing runs on NEAR: a contract enforces Kevin's spending limits, the ops director approves big orders by text, and suppliers are paid in a stablecoin when QC releases the delivery. Plant staff see dollars and POs, never wallets or gas.

Built at NEAR HACKATHON (Nov 1–14, 2026). Tracks: `realworld`, `business`, `security`, `agents`{, `privacy`}{, `swarms`}. All company data is fictional. Runs on NEAR testnet.

## The problem

{3–5 sentences: roll-ups of small family manufacturers; integration wall; paper batch records and hand-keyed ERP; shared inventory across plants corrupted by another plant's errors; purchasing done by phone and email. One sourced stat.}

## Try it (no keys needed)

Requires Node 24. Step 5 requires Linux, macOS or WSL2.

1. `npm ci` → installs with no secrets.
2. `npm run demo` → runs the full loop from seed data using recorded testnet transactions. Ends with:
   ```
   {last 6 lines of data/replay/transcript.txt}
   ```
3. `npm run verify -- data/batch-records/BR-B-1045.json` → `MATCH` and the anchoring tx link.
4. Change one quantity in that file by 1 g and repeat step 3 → `MISMATCH`.
5. `npm run test:contracts` → {N} tests pass, including `over_limit_po_is_refused` and `director_approval_then_retry_succeeds`.

Optional: `npm run demo -- --ui` opens the web UI at {url} and steps through the same run. `npm run demo:live` runs against testnet with your own accounts (see `.env.example`).

## What happens in the demo

{Numbered list mirroring DEMO_SCRIPT steps 1–12, one sentence each, staff view and chain view.}

## Why NEAR

Kevin doesn't need crypto. The acquirer, the plant and the supplier do: one spending rule none of them can quietly change, and settlement none of them controls.

1. **Accounts and keys are the org chart.** {tree}. Kevin's key can call only {methods}. Note: a parent account has no control over a sub-account after creation; authority comes from keys and contract checks.
2. **Enforced, not logged.** The limit is in `contracts/spend-policy`. Over-limit attempts fail on-chain: {explorer link to refused tx}.
3. **Neutral settlement.** Suppliers are their own accounts outside Acme's tree. Escrow pays them on QC release, not net-30.
4. **Staff hold no tokens.** The director's approval is a meta-transaction (NEP-366) signed with the director's own key and paid for by Day One's relayer: {explorer link}.
5. **Tamper-evident records.** Record fingerprints are stored in contract state; anyone can recompute and compare.

## Claims and evidence

| Claim | Code | Test | On testnet |
|---|---|---|---|
| Kevin cannot exceed his per-PO limit | `contracts/spend-policy/src/lib.rs` `submit_po` | `over_limit_po_is_refused` | {refused tx} |
| Only the director can approve, and only exact terms | `approve_po` | `approve_from_non_director_panics`, `mismatched_terms_after_approval_panics` | {approve tx} |
| Kevin's key cannot move tokens | key layout in `scripts/setup-testnet` | — | {view_access_key_list output} |
| Staff actions are relayer-paid | `server/relayer/` | `relayed_approval_passes_predecessor_check` | {relayed tx} |
| Funds release only after QC | `contracts/po-escrow` `qc_release` | `release_before_receipt_panics` | {release tx} |
| Records are anchored and verifiable | `anchor_batch`, `scripts/verify` | `anchor_is_append_only` | {anchor tx} |
| Same contracts settle in Circle USDC | USDC deployment | — | {PO-1047 txs} |
| Inference runs in an attested TEE {if tagged} | `server/attestation/` | `verify_attestation_fixture` | {report fixture} |
| Supplier agents transact from their own accounts {T1} | `agents/suppliers/` | {test} | {quote anchor tx} |

## What is on-chain and what is not

| On NEAR testnet | Off-chain (SQLite) |
|---|---|
| Spend limits, caps, approver, pause | Formulas, batch contents, lot quantities |
| PO authorization and refusals | Line-item prices, quotes (hash only on-chain) |
| Director approvals | Staff names and roles |
| Escrow, release, refunds; PO total and supplier | Record salts |
| Record fingerprints (sha256) | LLM prompts and responses (signed fixtures) |

## Architecture

{Mermaid diagram from docs/ARCHITECTURE.md §2, trimmed.} Contracts: Rust near-sdk {version}. Server: TypeScript, near-api-js {version}, SQLite. LLM: NEAR AI Cloud {model} {and fallback}.

## Who pays, and why it lasts

The acquirer pays per plant onboarded, sold to private-equity buy-and-build platforms, where add-on acquisitions are most deals. The moat is plant-floor workflow, operating data (formulas, lot genealogy, yield variance) and policy contracts that keep working whichever ERP the parent company runs. Kevin keeps small plants running and their people employed; the purchaser becomes the person who supervises the agents.

## Limitations

- Testnet only. Suppliers are simulated agents. SMS is simulated in the UI.
- {Token note: main demo settles in DTUSD, a test token we deployed, because the Circle faucet gives 20 USDC per 2 hours; PO-1047 settles in Circle testnet USDC.}
- Staff keys are held by the server because the phone is simulated. Production would use a login provider (e.g. NEAR Auth) to supply each person's key.
- PO totals and supplier accounts are visible on-chain; line items and prices are not.
- {Vision route note if not in TEE.}
- Contract accounts still hold full-access keys so we can redeploy; deleting them is a post-hackathon step.
- Audit-friendly records, not a compliance claim.
- Commits before Nov 1, 2026 are planning documents only (`docs/`); all code was written during the hackathon.

## Roadmap

ERP connectors (NetSuite first); real SMS; NEAR Auth login for staff; NEAR Intents to pay suppliers on other chains; multi-signer approval for very large POs; Merkle-batched anchors; more document types.

## Built with

Built by {name} with Claude Code. Planning docs: `docs/`. Conventions for coding agents: `AGENTS.md`.
