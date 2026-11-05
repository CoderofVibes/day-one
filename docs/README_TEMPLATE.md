# README template

This is the skeleton for the final `README.md`, written on Nov 10 and finalized Nov 13. It must read well to a human judge and to a coding agent auditing claims against code. Rules:

- No marketing words ("revolutionary", "seamless", "AI-powered").
- Every claim points to a file, a test, or a tx hash. If it can't, delete the claim.
- Nothing addressed to judges or to AI models.
- Expected output shown verbatim, so a reader who doesn't run anything can still check.
- One order carries the front door (Astra, Nov 4; Tony): the opening, then PO-1042 from need to payment with Linda's screen, then a short visible list of what else is in it. The layer index and the claims table are reference, folded below Try it, with every caveat kept.

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
5. `cd contracts && cargo test` → {N} tests pass, including `over_limit_po_is_refused_with_the_exact_message` and `purchasing_loop_on_sandbox`.

Optional: `npm run web:build` and open `web/dist/` from a static server to step through the same run in the browser; `npm run api` serves it live at {url}. `npm run demo:live` runs against testnet with your own accounts (see `.env.example`).

## What happens in the demo

{Numbered list mirroring DEMO_SCRIPT steps 1–12, one sentence each, staff view and chain view.}

## Why NEAR

Kevin does not need crypto. The acquirer, the plant and the supplier need purchasing authority and a settlement record that none of them controls alone. HQ can change the policy and the operator keeps deployment keys; say so as trust assumptions.

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
| Staff actions are relayer-paid | `server/src/relayer/` | `relayed_approval_passes_predecessor_check` | {relayed tx} |
| Funds release only after QC | `contracts/spend-policy` `qc_release` | `release_before_receipt_panics` | {release tx} |
| Records are anchored and verifiable | `anchor_batch`, `scripts/verify` | `anchor_is_append_only` | {anchor tx} |
| Same contracts settle in Circle USDC | USDC deployment | — | {PO-1047 txs} |
| Inference runs in an attested TEE {if tagged} | `server/src/attestation/` | `verify_attestation_fixture` | {report fixture} |
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

Built by DadMod (Tony Langford, solo entrant) with Claude Code. Planning docs: `docs/`. Conventions for coding agents: `AGENTS.md`.

**Hackathon window and baseline (organizer Q-001, Q-003, Q-005).** The window runs from the Oct 19 announcement to Nov 14. Commits before the `pre-hackathon` tag are baseline (planning docs only); `pre-hackathon...hackathon-submission` is the judged diff. Libraries, templates and AI-generated code are listed here: {table of npm and crate dependencies with versions; note that code was written with Claude Code}. License: MIT (`LICENSE`).

### About the team (approved by Tony, Oct 26)

DadMod is one human and two AI collaborators. Tony Langford is a chemical engineer with ten years on manufacturing floors, now a system engineer at an advanced nuclear reactor startup, building this between feedings of a newborn (hence the name: dad bod, but for shipping code). Muse, an AI project manager, keeps the plan honest. Claude, an AI engineer, writes the code. Kevin, the AI assistant in the product, does the paperwork. Tony runs the plant.

One-liner: DadMod: a chemical engineer on paternity leave, two AI teammates, and an AI assistant named Kevin who does the paperwork so the plant can keep running.

Rule: never name Tony's employer anywhere; "an advanced nuclear reactor startup" only.
