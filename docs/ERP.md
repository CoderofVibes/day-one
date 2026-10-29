# The acquirer's ERP — a NetSuite-shaped mock and the Day One connector

**Built Oct 28, 2026 on branch `erp-mock`** (decision: OPEN_QUESTIONS #32; spec: PLAN.md "Acquirer ERP integration"). Everything below runs from a clean clone with no keys.

Plain statement for judges and readers: `erp/` is a **mock** of a NetSuite-shaped REST API, built so Day One has a realistic acquirer system of record to integrate with. It is not NetSuite and claims no NetSuite compatibility; the record names and field style are borrowed, the set is small. The real deliverable is the **connector interface** in `server/src/erp-connector/types.ts`: what Day One promises to an ERP and what it needs back. A NetSuite adapter would implement the same interface against the real `/services/rest/record/v1` endpoints.

---

## 1. Why an ERP at all

Acme Holdings keeps its books in an ERP. When it buys Hollow Pine (Plant B), the plant's purchasing must land in those books on day one: approved vendors, purchase orders, receipts, vendor bills, the 3-way match, payments, inventory value and the general ledger. Day One runs the plant floor and the money rails; it must not become a second set of books. So:

- **Integration, not duplication.** Every record has exactly one owner. Records cross the boundary by ID: PO number, Day One lot code, batch number, transaction hash. Neither side stores the other's records.
- **The contract stays the enforced layer.** Spend limits, approvals and the supplier allowlist are contract rules (AGENTS.md "Enforced, not logged"). The ERP records the contract's verdict (approved by whom, in which transaction); it never re-decides a limit, and it adds only rules the contract does not have.
- **Inventory balances are derived, never typed in.** The ERP's quantity and value per item per location are the sum of transactions the connector posts from Day One's lot event log. Lot detail stays in Day One; each ERP line carries the Day One lot code.

## 2. Ownership

| Record | Owner | Crosses the boundary as |
|---|---|---|
| Vendor master: legal name, status (`approved`, `onHold`, `blocked`), verified payout account, bill tolerances, terms | ERP | Day One reads it; before every `submit_po` Kevin checks that the vendor is `approved` and that the account the contract will pay is the vendor master's verified payout account |
| Item master (raw materials, packaging, lab supplies, finished goods), locations (Acme's plants), chart of accounts, approval matrix, users and roles | ERP | Day One addresses items by material code and locations by facility code |
| Purchase order terms (lines, prices, freight, `po_hash`) and the contract's verdict | Day One (Kevin drafts; the contract escrows) | Mirrored into the ERP by PO number with the funding and approval tx hashes |
| Lots, lot states, genealogy, batch records, the plant inventory ledger | Day One | Each ERP inventory line references its Day One lot code and, for issues, the batch number |
| Item-level inventory: quantity and value per item per location per status | ERP (derived) | Posted by the connector: item receipts, QC status changes, issues to production, waste, counts, transfers, opening balances at cutover |
| Vendor bills, the 3-way match, bill approval | ERP | Kevin hands the bill over after reading it; the ERP matches it to its PO and receipts and answers with its verdict |
| Escrow and the payment to the supplier | Day One's contract (`qc_release` pays) | Written back as a vendor payment applied to the bill, with the tx hash and explorer link |
| General ledger journal lines, audit trail | ERP | Read-only view and API |

Kevin is a user in the ERP (`kevin.dayone`, role `connector`) with the permissions the connector needs and no more: read vendors and items; create purchase orders, item receipts, inventory adjustments, transfers and status changes; create vendor bills; create vendor payments. He cannot edit the vendor master, approve a bill, sign a PO for HQ or post a journal entry.

## 3. What was built

```
erp/                                  @day-one/erp — the mock (depends on nothing else in the repo)
  src/schema.ts, migrations/          24 STRICT tables in SQLite (better-sqlite3 + Drizzle); data/runtime/erp.db
  src/seed/data.ts, index.ts          masters: accounts, locations, users, 12 vendors, 36 items, settings, approval matrix
  src/seed/history.ts                 migrated AP history: the 7 invoices of FICTIONAL_DATA §13 and 6 checks
  src/posting/                        journal, inventory, purchasing, payables: every write goes through here
  src/match.ts                        the 3-way match and the duplicate key (pure functions)
  src/approval.ts                     the approval matrix, read from the database
  src/api.ts, http/router.ts          the REST shape, roles, NetSuite-style records and errors
  src/http/views.ts                   the read-only web view
  src/server.ts                       npm run erp
server/src/erp-connector/
  types.ts                            ErpConnector — the interface (the deliverable)
  mock-netsuite.ts                    the adapter over the mock's REST shape (in-process or HTTP transport)
  sync.ts                             Day One's ledger → ERP transactions, idempotent on Day One keys
  rebuild.ts                          masters + cutover sync + AP history, in seconds
agents/kevin/src/erp.ts               where Kevin's workflow calls the connector
scripts/erp-seed.ts, erp-demo.ts      npm run erp:seed, npm run erp:demo
```

### 3.1 The API (NetSuite record style, loosely)

Base path `/services/rest/record/v1`; `GET …/metadata-catalog` lists the record types. Records carry `id`, `tranId`, `tranDate`, reference fields as `{ id, refName }`, sublists as `{ items: [...] }`, status fields as `{ id, refName }`, and custom body fields prefixed `custbody_` / `custentity_` / `custitem_`. Collections return `{ links, count, hasMore, items, offset, totalResults }` and, unlike NetSuite, return full records; `?limit`, `?offset` and `?<field>=<value>` filters work. Creates answer `201` with the record and a `Location` header (NetSuite answers `204` with the header). Errors use NetSuite's `{ type, title, status, "o:errorDetails": [{ detail, "o:errorCode" }] }`. Auth is `Authorization: Bearer <token>` per seeded user; the demo tokens are in `erp/src/seed/data.ts` and `ERP_TOKEN_<USERNAME>` overrides any of them. The web view needs no token.

| Resource | Methods | Notes |
|---|---|---|
| `vendor` | GET list, GET id or code, GET `!byPayoutAccount?account=` | `custentity_vendor_status`, `custentity_dayone_payout_account`, `custentity_vb_po_qty_tolerance` (%), `custentity_vb_po_amt_tolerance` (%), `custentity_vb_ir_qty_difference` |
| `inventoryItem`, `location`, `account`, `approvalRule` | GET | masters; `cost` on an item is the standard cost for opening balances |
| `purchaseOrder` | GET, POST, PATCH | `tranId` = Day One PO number; `custbody_contract_verdict`, `custbody_contract_reason`, `custbody_near_funding_tx`, `custbody_near_approval_tx`, `custbody_near_approved_by`, `custbody_dayone_po_hash`; PATCH records a new verdict, or (controller) `approvalStatus: approved`; GET `…/{po}/billStatus` answers "is there an approved bill for this PO" |
| `purchaseOrder/{po}/!transform/itemReceipt` | POST | lines with `inventoryDetail.inventoryAssignment.items[].receiptInventoryNumber` = Day One lot code, status `quarantine` |
| `itemReceipt`, `inventoryAdjustment`, `inventoryTransfer`, `inventoryStatusChange` | GET, POST | adjustments carry `custbody_reason` (`opening`, `production`, `waste`, `count`, `return`); a status change with `createdFrom` = the PO releases or returns a received lot |
| `inventoryBalance` | GET list (`?location=`, `?item=`) | derived: quantity, value and average cost per item, location and status |
| `purchaseOrder/{po}/!transform/vendorBill`, `vendorBill` | POST, GET, PATCH | the match runs on save: `custbody_match_status`, `custbody_match_exceptions`, `approvalStatus`, `custbody_duplicate_of`, `custbody_price_drift`, `receipts`; PATCH (AP manager) decides a held bill with `approvalNote` |
| `vendorPayment` | GET, POST | `apply.items[].doc` or `createdFrom` (the PO); `custbody_near_tx`, `custbody_near_explorer_url`; `custbody_on_account` when no approved bill took it |
| `journalEntry`, `trialBalance`, `auditTrail` | GET | every posting; debits = credits; who did what and when |

### 3.2 Web view (`http://localhost:8087/`)

Overview, vendor bills with match status and exceptions, purchase orders with the contract's verdict and the ERP's approval, inventory by location, the general ledger with a trial balance, payments, vendors, the audit trail. Server-rendered HTML, one stylesheet. Dollars, PO numbers, invoice numbers and lot codes; no wallets, keys, gas or token names (a test checks every page). A payment shows a settlement reference and a "verify" link to the explorer.

### 3.3 Posting rules

Money is integer micro-dollars (6 decimals) as everywhere in the repo; quantities are integers in Day One's base units (mg, each) and the API shows them in the item's unit (kg, ea), with unit prices kept to six decimals (a bottle costs $0.021). Stock comes in at its receipt price, or the item's standard cost at cutover, and goes out carrying the lot's own share of its remaining value, exact to the micro-dollar; the balances view reports the item's average cost.

| Event (from Day One) | ERP transaction | Journal |
|---|---|---|
| Cutover: a lot on hand with no PO | `inventoryAdjustment` `opening` into quarantine, at standard cost; then the lot's QC history | Dr Inventory / Cr Opening balance equity (acquisition) |
| Dock receipt against a PO | `itemReceipt`, status `quarantine`, at the PO price | Dr Inventory / Cr Accrued purchases (received not billed) |
| QC release | `inventoryStatusChange` quarantine → good | none (the quantity becomes available) |
| QC reject on a PO lot | `inventoryStatusChange` → rejected, then an adjustment `return`; the PO's received quantity drops | Dr Accrued purchases / Cr Inventory |
| Issue to production (confirmed batch record) | one `inventoryAdjustment` `production` per batch, memo = batch number | Dr Work in process / Cr Inventory |
| Waste | `inventoryAdjustment` `waste` | Dr Production waste / Cr Inventory |
| Count adjustment, a pre-cutover lot sent back to its vendor, a transfer shortfall | `inventoryAdjustment` `count` | Dr/Cr Inventory adjustments |
| Transfer between plants | `inventoryTransfer` for the shipped quantity; a `count` at the destination for any shortfall (the ASC-261009-01 case: 200 kg shipped, 187.450 kg received, 12.550 kg booked as a count, "under review in Day One") | none for the transfer itself |
| Vendor bill (once approved) | `vendorBill` | Dr Accrued purchases (lines) + Dr Freight-in / Cr Accounts payable |
| Payment (escrow release, or a check in the history) | `vendorPayment` applied to the bill | Dr Accounts payable / Cr Purchasing escrow clearing (or Cash) |
| Budget funded into the contract (seeded once) | `journalEntry` | Dr Purchasing escrow clearing / Cr Cash |

The inventory ledger and the journal lines are append-only (triggers); corrections are new postings. Tested invariants: every journal balances; quantity and value per item, location and status equal the sum of posted movements; after the cutover sync the ERP's quantities equal Day One's lot balances for every material at every plant; the trial balance's debits equal its credits after the seed, the cutover, the AP history and the whole demo loop.

### 3.4 The 3-way match

On `vendorBill` save, per line against the PO and against the item receipts for that PO:

- quantity billed vs ordered, within the vendor's quantity tolerance (`vb_po_qty_tolerance`, basis points)
- amount billed vs ordered, within the vendor's amount tolerance (`vb_po_amt_tolerance`)
- quantity billed vs received and not yet billed, within an absolute difference limit (`vb_ir_qty_difference`); nothing received at all is its own exception
- freight exact against the PO; the total must be the lines plus freight; the vendor must be the PO's; a closed PO takes no bills

Limits live on the vendor record with subsidiary defaults in `settings` (2% quantity, 1% amount, 0 difference), the way NetSuite's 3 Way Match Vendor Bill Approval reads them from the vendor, item or subsidiary. Every exception carries a code, the line, what was billed, ordered and received, and the tolerance applied, e.g. `{ code: "AMT_VS_PO", line: 1, billed: 5565000000, ordered: 4970000000, tolerance: "1%" }`, with a plain sentence for Marcy.

**Duplicate invoice.** Before matching: same vendor and the same normalized invoice number (upper-case alphanumerics, a reissue suffix such as `-R`, `COPY` or `REISSUED` removed, so `OFH-3317-R` is `OFH3317`), or same vendor, same PO and same amount within 30 days. A duplicate is saved `rejected` with `custbody_duplicate_of`, never posts and can never be approved or paid.

**Price drift** (the bookkeeper pack's alert, FEATURES_V2 §2) is not a match exception: a bill at the PO's price matches. The ERP notes it on the bill (`custbody_price_drift`) when a unit price is more than 10% over the vendor's last approved bill for the item: PEC-55388 at $9.35/kg against $8.20/kg on PEC-55120, +14.0%.

### 3.5 The approval matrix (on top of the contract, never instead of it)

Rows in `approval_rules`, evaluated in order within a scope; readable at `/approvalRule`:

| Scope | Condition | Required | Why it is not a contract rule |
|---|---|---|---|
| purchase order | vendor `blocked` | rejected | Acme's AP policy; the contract's supplier list is checked independently by `submit_po` |
| purchase order | vendor `onHold` | the HQ controller signs, in addition to the contract's verdict | the contract knows `Conditional` (director); Acme adds a second signature |
| purchase order | total over $25,000 | the HQ controller signs, in addition to the contract's verdict | the contract has no HQ tier |
| purchase order | otherwise | the contract's verdict is the approval: `funded` with its tx, or the director's `approve_po` tx; `awaitingApproval` is pending; `refused` is rejected with the contract's own words | the ERP never evaluates the per-PO limit, the monthly limit, the category cap or the supplier list |
| vendor bill | duplicate | rejected; nobody can approve it | AP policy |
| vendor bill | any match exception | the AP manager decides, with a reason recorded | AP policy |
| vendor bill | matched, over $10,000 | the AP manager approves | AP policy |
| vendor bill | matched, at most $10,000 | approved automatically | AP policy |

A payment arrives when the escrow releases, whatever the paperwork says. The ERP applies it to the approved bill for that PO; with no approved bill it is held on the vendor's account with the reason (`custbody_on_account`), for Marcy.

### 3.6 The connector interface (`server/src/erp-connector/types.ts`)

```ts
interface ErpConnector {
  readonly system: string;                                     // "mock-netsuite" | "netsuite" …
  getVendor(code): Promise<ErpVendor | null>;
  listVendors(filter?): Promise<ErpVendor[]>;
  verifyPayee({ vendorCode, account }): Promise<PayeeCheck>;   // approved, and the verified payout account
  pushPurchaseOrder(po: PoMirror): Promise<ErpRef>;            // by PO number, with the contract's verdict
  recordContractVerdict(poNo, verdict): Promise<ErpRef>;
  postItemReceipt(receipt): Promise<ErpRef>;                   // lines with Day One lot codes, into quarantine
  postQcDecision(decision): Promise<ErpRef>;                   // release → good; reject → returned, receipt reversed
  postInventoryMovement(movement): Promise<ErpRef>;            // opening, production, waste, count, return, transfer
  postVendorBill(bill): Promise<BillResult>;                   // the ERP's match and approval verdict come back
  getBillForPo(poNo): Promise<BillResult | null>;
  recordPayment(payment): Promise<PaymentResult>;              // tx hash + explorer link; applied or held on account
  getInventory(filter?): Promise<InventoryBalance[]>;
}
```

What it promises: every post is idempotent on its Day One key (posting a receipt or a movement twice returns the existing record with `created: false`); money is micro-dollars and quantities are base units, the adapter converts; a refusal comes back as `ErpConnectorError` with the ERP's code (`VENDOR_NOT_IN_MASTER`, `PO_NOT_APPROVED`, `DUPLICATE_INVOICE` …). The mock adapter talks to the ERP through a transport: `inProcessTransport(router, token)` for tests and the replayed demo, `httpTransport(baseUrl, token)` for a running ERP. `sync.ts` walks Day One's purchase orders and lot events into these calls, so the same code does the cutover and a later catch-up.

### 3.7 Where Kevin's workflow calls it (`agents/kevin/src/erp.ts`)

The hooks are optional (`DemoDeps.erp`); `npm run demo` and its transcript do not change. `npm run erp:demo` runs the same replayed loop with the connector attached and prints each step's `erp:` lines.

| Demo step | Connector call | What the ERP answers |
|---|---|---|
| cutover (before step 0) | `sync.ts`: 6 history POs, 6 receipts, 5 transfers, 9 issues to production, 49 QC decisions, 44 adjustments; then the migrated AP history | balances derived, none typed in; 6 bills matched, OFH-3317-R rejected as a duplicate of OFH-3317, PEC-55388 price drift +14.0% noted |
| 2 Ray confirms BR-B-1045 | `postInventoryMovement` production: 9 lots, 1,000.492 kg | `ADJ-54`, Dr Work in process / Cr Inventory |
| 6, 7, 9 POs | `verifyPayee` before each `submit_po`; `pushPurchaseOrder` after the contract answers, then again after the director's approval and the funding | PO-1041 approved on the contract's verdict; PO-1042 pending while refused, approved once funded, with both tx hashes |
| 10 Delivery | `postItemReceipt` (700 kg ASC, lot ASC-261116-01, quarantine); Kevin reads Northgate's invoice and `postVendorBill` | `IR-7`; NG-INV-24190 matched, approved for payment |
| 11 QC release | `postQcDecision` release; the escrow pays; `recordPayment` with the `qc_release` tx; `pushPurchaseOrder` again with the final verdict | `ISC-50` quarantine → good; `VP-7` $5,150.00 applied to NG-INV-24190; PO-1042's mirror marked paid |

After the run: Plant B holds 1,010 kg of ascorbic acid at $7,171.00; AP is zero; the trial balance is $160,997.60 on each side.

### 3.8 Attack suite additions (`npm run test:attacks`, 7 attacks, replay with no keys)

5. **Duplicate invoice.** NG-INV-24190 for PO-1042 is matched and paid in full (settlement ref = the recorded `qc_release` tx). The same invoice sent again as `NG-INV-24190-R` ("reissued", same $5,150.00) is rejected as a duplicate; nobody can approve it. The contract shows PO-1042 `Released`: the escrow paid once.
6. **Split purchase.** Two lab-chemical POs sized from the live cap headroom ($695.00 each when recorded: both under the $2,500 per-PO limit, together $2,002.00 against the $2,000.00 monthly cap). The ERP's matrix has no category cap, by design, and clears both. The contract funded PO-T9101 (spend $1,307.00) and refused PO-T9102: "$695.00 would take lab chemical spending this month to $2,002.00, over the cap of $2,000.00; director approval required." HQ cancelled PO-T9101 afterwards; the budget is back at 19,238 DTUSD with 612 escrowed for PO-1041.
7. **Ghost vendor.** A PO to Harrow Chemical Co. (`harrow-chemical.testnet`): the connector refuses to mirror it (`VENDOR_NOT_IN_MASTER`), `get_supplier` on the contract is null, and `submit_po` is refused ("not an approved supplier; no approval can override this"). Two independent layers.

The chain fixture (`data/replay/attacks-chain.json`) was re-recorded live on Oct 28 with the three new attacks (5 transactions). The model answers (`attacks-llm.json`) are the earlier recording: in the live re-record the vision model misread the genuine invoice's PO field once, which would have made the unchanged attack 2 fail; that flakiness is a model issue, not an ERP one, and is worth a note in LESSONS.

### 3.9 Reconciliation (`npm run erp:reconcile`, replay with no keys)

Three sets of books, matched by ID and compared; nothing is changed. `server/src/erp-connector/reconcile.ts` reads Day One's ledger as the demo left it, the ERP it posted to, and the spend-policy contract (view calls only), and prints MATCH or MISMATCH per check with the numbers; exit 1 on any mismatch.

| Check | What must agree |
|---|---|
| Inventory | Day One's lot balances per material and plant = the ERP's derived balances (45 pairs); the ERP's inventory accounts = its lot values |
| Purchase orders | every Day One PO past draft has an ERP mirror by number with the same total, vendor, verdict and funding tx; for POs on the contract, the contract's amount, payee account (= Day One's vendor account = the ERP's verified payout account) and status agree with both |
| Payments | every `qc_release` Day One recorded is `Released` on the contract and is one ERP payment with the same tx hash and amount, applied to a matched, approved, paid-in-full bill; every ERP escrow payment maps back to such a release |
| Escrow | the ERP's escrow clearing account (1050) = the contract's budget + amount in escrow ($19,850.00 = $19,238.00 + $612.00 when recorded) |
| Contract POs not in Day One | throwaway and rehearsal POs are allowed while cancelled or refunded; one that holds or has paid money fails |
| General ledger | debits = credits; accounts payable = open approved bills |

The first live run found a real gap: after QC release the ERP's PO mirror still said `funded` while Day One and the contract said paid, because Kevin's release hook posted the status change and the payment but not the final verdict. The hook now records it (`erp: purchaseOrder PO-1042 — contract verdict recorded: paid`). The contract views are recorded in `data/replay/reconcile-chain.json`; `-- --live` reads the contract now (still no keys), `-- --record` rewrites the fixture. The same function can run nightly against the live contract and post the result to Muse; that is not scheduled yet.

## 4. Running it

| Task | Command |
|---|---|
| Rebuild the ERP from scratch (masters, cutover sync from a fresh Day One seed, migrated AP history; about 3 s) | `npm run erp:seed` (`-- --json`) → `data/runtime/erp.db` |
| Start the ERP: API and web view | `npm run erp` → http://localhost:8087/ (`ERP_PORT`, `ERP_DB`, `--reseed`) |
| The demo loop with the ERP attached (replay of the recorded testnet run, no keys) | `npm run erp:demo` (`-- --json`, `--memory`) |
| The attack suite, seven attacks | `npm run test:attacks` |
| Reconcile Day One, the ERP and the contract (replay of recorded views, no keys; `-- --live` reads testnet now, `-- --record` rewrites the fixture, `-- --json`) | `npm run erp:reconcile` → MATCH per check, exit 0 |
| Tests (ERP: 38; connector, sync and reconciliation: 6; attack suite and Kevin: 66; 241 in all) | `npm test` |

A call against the running ERP:

```bash
curl -s -H "Authorization: Bearer demo-token-viewer" "http://localhost:8087/services/rest/record/v1/vendorBill?custbody_match_status=duplicate"
```

## 5. For the README (ready to paste)

> **Acquirer ERP integration.** Acme's books live in `erp/`, a mock of a NetSuite-shaped REST API (vendor, inventoryItem, location, purchaseOrder, itemReceipt, vendorBill, vendorPayment, journalEntry). It is a mock, not NetSuite; the deliverable is the connector interface in `server/src/erp-connector/`. The ERP owns the vendor master with verified payout accounts, vendor bills and the 3-way match with tolerances, an approval matrix on top of the contract's limits, item-level inventory derived only from posted transactions, and the general ledger. Day One owns lots, batch records and the on-chain escrow. Records cross by PO number, lot code and transaction hash. `npm run erp:demo` replays the demo with the ERP attached; `npm run erp` serves the books at http://localhost:8087/. Three attacks in `npm run test:attacks` use it: duplicate invoice (ERP rule), split purchase (caught by the contract's category cap, not by the ERP), ghost vendor (refused by both). `npm run erp:reconcile` proves the three sets of books agree, record by record: lot balances, PO mirrors, the escrow release against the ERP's payment by transaction hash, and the ERP's escrow account against the contract's budget.

## 6. Limitations (honest list)

- A mock: no SuiteQL, no OAuth, no multi-subsidiary, no tax, no currencies, no item fulfillment or sales side. Field names follow NetSuite's style; the set is small, and collections return full records.
- Costing is per-lot actual cost with integer rounding at each issue; freight is expensed, not landed.
- Finished goods are not received into the ERP because Day One does not yet book output lots; work in process carries the issued material.
- A transfer still in transit in Day One (`transfer_out` without `transfer_in`) is not posted until it arrives.
- The ERP's bill match and Kevin's own invoice screen overlap on amounts. Kevin's screen exists to guard the payee account and to catch text aimed at an assistant; the ERP's match keeps the books. Neither is a contract rule.
- The web view is for a local mock: no login. The API needs a bearer token; the seeded tokens are demo values.

## 7. Files touched outside `erp/`, `server/src/erp-connector/` and the attack suite

For the merge into main (a builder session changes main at the same time):

- `agents/kevin/src/demo.ts`: optional `erp` dependency, `erp` lines on each step, the hook calls, and the invoice read moved from step 12 to the delivery step (the chain and model fixtures keep their order; the transcript is unchanged).
- `agents/kevin/src/erp.ts` (new; the release hook also records the final contract verdict on the mirror) and `agents/kevin/package.json` (export).
- `package.json` (workspace `erp`; scripts `erp`, `erp:seed`, `erp:demo`, `erp:reconcile`), `tsconfig.json` (reference), `package-lock.json`.
- `server/package.json` (dependency on `@day-one/erp`, exports), `server/tsconfig.json` (reference).
- `scripts/erp-seed.ts`, `scripts/erp-demo.ts`, `scripts/erp-reconcile.ts`, `scripts/lib/erp-demo-run.ts` (new; the demo-with-ERP setup shared by the last two); `scripts/attacks.ts` (ERP and PO-1042's recorded transactions passed to the suite).
- `data/replay/attacks-chain.json`, `data/attacks/kevin-signing-key.json` (re-recorded live); `data/replay/reconcile-chain.json` (new: the contract views, recorded live).
- `server/src/erp-connector/sync.test.ts`: a 20 s timeout on the run-twice test, which the new reconciliation tests slow down when they run beside it.
- Not touched, for the main session: the command table in `AGENTS.md` (§4 above has the rows), the README section (§5), `LESSONS.md` (the vision-model note in §3.8), and `PLAN.md`'s "In progress" line.
