# Group purchasing — three plants, one PO

**Built Oct 28, 2026 on branch `group-buy`** (decision: OPEN_QUESTIONS #33, Tony's order (a); plan item "Group purchasing across three plants", SPEC `swarms` row). Everything below runs from a clean clone with no keys.

Plain statement for judges: Acme's plants pool their need for one material into one request for quotes. The supplier agents bid on the pooled volume from their own NEAR accounts. Kevin picks the winner with the same qualification rules as a single-plant buy, and one pooled purchase order is split across the plants. **The coordination itself is the on-chain transaction**: each plant pledges to the pool from its own account, and the `spend-policy` contract charges each plant's share to that plant's own limits, waits for every director whose plant needs one, and funds one escrow. No plant can be made to spend past its limits because another plant joined.

---

## 1. What a judge sees

```bash
npm run demo:group
```

prints the recorded run and `Transcript matches data/replay/group-transcript.txt.` (`-- --json` adds one JSON line). The run, on the demo clock of Nov 10, 2026:

| Step | What happens | On chain |
|---|---|---|
| 0 | Each plant's purchasing agent and its per-PO limit, read from the contract | `get_agent_policy` ×3 |
| 1 | Each plant forecasts ascorbic acid for the next 10 days. Plant A needs 700 kg for a VC500 batch moved to Riverside; Plant B needs 700 kg; Plant C has no planned use | — |
| 2 | Plant B's Kevin opens pool `RFQ-G-2611` and pledges 700 kg; Plant A's Kevin joins from its own account. Each pledges at most what it would pay alone at the $7.10/kg on file. Plant C stays out | `open_pool`, `join_pool` |
| 3 | One RFQ for 1,400 kg over the supplier bus. Northgate and Ridgeway reach their volume breaks ($6.65 and $6.80/kg); QuickChem is cheapest and excluded (not qualified). Each supplier anchors its quote's fingerprint from its own account; QuickChem's anchor is refused by the contract | `anchor` ×3 (one refused) |
| 4 | Kevin allocates by quantity: Plant A $4,745.00, Plant B $4,745.00, total $9,490.00, and places one pooled PO. The contract refuses it: both shares are over their plants' $2,500 per-PO limits, and the refusal names both. Kevin asks the contract (`explain_pooled_po`) which shares wait and texts those plants' directors | `submit_pooled_po` ✗ refused |
| 5 | Linda (Plant B) and Dana (Plant A) each text YES. Each approval is for that director's own plant's share only, signed with their key and paid for by the relayer. After the last one, Kevin's identical retry funds one escrow of $9,490.00 | `approve_po` ×2 (relayed), `submit_pooled_po` ✓ |
| 6 | Northgate accepts and ships 1,400 kg to Plant B, the hub. Tommy confirms; 700 kg is earmarked for Riverside. Priya releases; Northgate is paid once | `accept_po`, `mark_shipped`, `confirm_receipt`, `qc_release` |
| 7 | Each plant's committed spend this month, from the contract: Plant A $4,745.00, Plant B $4,745.00, Plant C $0.00 | `get_spent` ×3 |

Savings shown to staff: $810.00 against the price on file (two plants at $7.10/kg plus freight each, versus one pooled order at $6.65/kg plus one freight).

The three-plant web view (`npm run web`, "Three plants") shows the same pool as a "Group purchasing" block: one line per plant with its quantity, share and approver, and the pooled PO with its savings.

## 2. What the contract enforces (CONTRACTS.md §9)

- A pool is opened and joined only by registered, active purchasing agents allowed the pool's category. A pledge carries the plant's quantity and the most it will pay for its share.
- A pooled PO is placed by a member. Every allocation line must name a member, stay within that plant's pledge, and the lines must add up to the PO total exactly. The PO id is a normal PO id: it can be used once, by either path.
- Each share is checked against its plant's agent exactly as `submit_po` checks a plain PO: per-PO limit, monthly limit (that agent's committed spend plus the share), conditional supplier, and the category cap on the pooled total. A share that fails needs that plant's director: `approve_po` with `po_id = "<po_id>/<plant agent>"`, the share's amount, supplier, category and `po_hash`, from the approver named in that agent's policy. Another plant's director cannot approve it.
- If any share still waits, the whole PO is refused and the reason names every waiting share, so directors can act in parallel. Approvals are consumed when the PO funds, and expire after 24 hours like any approval.
- An unapproved supplier and a short budget cannot be approved away, for a pool as for a plain PO.
- On pass, one escrow record is funded; `budget` and `escrowed` move as for a plain PO; each plant's agent is charged its share in its monthly spend; `get_pool_lines(po_id)` keeps the allocation with who approved each share. Receiving, QC, payout, QC reject and HQ cancel are the existing methods, through the placing plant's roles; a refund gives each plant its share back.
- A pool takes one PO and then no more pledges.

Tested in `contracts/spend-policy/src/tests/group.rs` (16 unit tests, one per refusal and per happy path) and `tests/sandbox.rs` (`group_purchasing_on_sandbox`, on a local node with the DTUSD token).

## 3. What Kevin does, and does not

- Kevin runs each plant's own forecast and pools only plants with planned use. A plant with no planned batches that use the material pools nothing, whatever its stock level says.
- Kevin never checks a limit himself. After a refusal he calls `explain_pooled_po`, a read-only view that runs the same checks, to learn which shares wait and why; that is what decides whom he texts.
- Allocation is by quantity, in whole base units, with the rounding remainder on the hub's line, so the shares add up exactly.
- The pooled RFQ goes over the same bus as a single-plant RFQ; the supplier agents answer from their price lists with volume breaks (`agents/suppliers/src/pricing.ts`), and anchor their quotes as before. The ranking rules are unchanged: an unqualified vendor is excluded even when cheapest.
- The hub plant takes the delivery under its own receiving and QC roles. The other plants' quantities are earmarked; moving them is the existing transfer flow and is not part of this run.
- No ERP hooks yet: the pooled PO is not mirrored into the mock ERP (docs/ERP.md). That is a follow-up.

## 4. Recording without testnet: the local sandbox

Two other features changed the same contract in parallel, so this branch does not redeploy `spend-policy` to testnet. The recorded run comes from a **local NEAR sandbox** instead: `scripts/lib/sandbox.ts` starts the `near-sandbox` binary the contract tests download in WSL, writes the demo's accounts (their testnet names) into genesis with fresh keys, and `scripts/lib/dayone-sandbox.ts` deploys and configures both contracts the way `npm run deploy:testnet` does, plus one purchasing agent per plant. The same TypeScript then runs against it unchanged; only the network name differs.

```bash
npm run demo:group -- --sandbox             # run it live on a local sandbox (WSL)
npm run demo:group -- --sandbox --record --web   # and rewrite the fixtures, transcript and web data
```

Prerequisite: one `cargo test` run in `contracts/` (AGENTS.md), which downloads the sandbox binary and builds both wasm files under `~/dayone-target`; `cargo clean` removes them again, so run the tests once more before recording. A sandbox recording carries transaction hashes no public explorer knows; the transcript says so instead of printing explorer links, and quote proofs are written to `data/quotes/` only from a testnet recording.

## 5. Moving it to testnet (for the merge)

After the three contract branches are merged and `spend-policy` is redeployed once:

1. **Accounts.** The group buy needs a purchasing agent and a director per plant. Create `kevin.plant-a.acme-holdings.testnet`, `director.plant-a…`, `kevin.plant-c…` and `director.plant-c…` the way `setup-testnet` creates Plant B's (function-call keys for `submit_po`, `submit_pooled_po`, `open_pool`, `join_pool`, `anchor`, `anchor_batch` on the agents; `approve_po`, `reject_po` on the directors; keys in `.near-credentials/testnet/`). Plant B's existing Kevin key needs the three new methods added to its function-call key, or a second key.
2. **Policy.** `set_agent_policy` for the two new agents (names "Kevin at Plant A" and "Kevin at Plant C", $2,500 per PO; `scripts/lib/dayone-sandbox.ts` `PLANT_AGENTS` is the reference). Plant B's policy is unchanged.
3. **Relayer.** `allPlantsStaff()` in `scripts/lib/dayone-sandbox.ts` is the staff list the relayer carries for the group demo (Plant B's dock and QC plus the three directors); `npm run demo:group -- --live` uses it.
4. **Record.** `npm run demo:group -- --live --record --web` after `npm run rehearse` and with `PO-G-2001` unused on the contract. The transcript then prints explorer links and the quote proofs land in `data/quotes/`.

## 6. Files

```
contracts/spend-policy/src/lib.rs          open_pool, join_pool, submit_pooled_po, explain_pooled_po, get_pool, get_pool_lines; refund by share
contracts/spend-policy/src/events.rs       pool_opened, pool_joined, pooled_po_authorized
contracts/spend-policy/src/tests/group.rs  unit tests; tests/sandbox.rs group_purchasing_on_sandbox
agents/kevin/src/groupBuy.ts               the flow: forecasts, pool, pooled RFQ, allocation, per-plant approvals, delivery, books
agents/suppliers/src/pricing.ts            volume breaks for the supplier agents
scripts/demo-group.ts                      npm run demo:group (replay, --sandbox, --live, --record, --web, --json)
scripts/lib/sandbox.ts, dayone-sandbox.ts  the local sandbox and Day One's deployment on it
data/replay/group-chain.json, group-salts.json, group-transcript.txt   the recorded run
web/src/data/group-buy.json                what the three-plant view shows
server/src/ledger/schema.ts, migrations/0006_group_buy_tx_kinds.sql   the three new chain_tx kinds
```
