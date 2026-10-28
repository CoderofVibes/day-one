# The acquirer's ERP — a NetSuite-shaped mock and the Day One connector

**Status: build plan (Oct 28, 2026), branch `erp-mock`.** This file becomes the ERP's documentation as the build lands; the plan at the bottom turns into the record of what shipped. Decision: OPEN_QUESTIONS #32 (Tony, Oct 28); spec: PLAN.md "Acquirer ERP integration".

Plain statement for judges and readers: `erp/` is a **mock** of a NetSuite-shaped REST API, built so Day One has a realistic acquirer system of record to integrate with. It is not NetSuite and does not claim NetSuite compatibility. The real deliverable is the **connector interface** in `server/src/erp-connector/`: what Day One promises to an ERP and what it needs back. A NetSuite adapter would implement the same interface against the real `/services/rest/record/v1` endpoints.

---

## 1. Why an ERP at all

Acme Holdings keeps its books in an ERP. When it buys Hollow Pine (Plant B), the plant's purchasing must land in those books on day one: approved vendors, purchase orders, receipts, vendor bills, the 3-way match, payments, inventory value and the general ledger. Day One runs the plant floor and the money rails; it must not become a second set of books. So:

- **Integration, not duplication.** Every record has exactly one owner. Records cross the boundary by ID: PO number, Day One lot ID, batch number, transaction hash.
- **The contract stays the enforced layer.** Spend limits, approvals and the supplier allowlist are contract rules (AGENTS.md "Enforced, not logged"). The ERP records the contract's verdict (approved by whom, in which transaction); it never re-decides a limit, and it adds only rules the contract does not have.
- **Inventory balances are derived, never typed in.** The ERP's quantity and value per item per location are the sum of transactions the connector posts from Day One's lot event log. Lot detail stays in Day One; ERP lines carry the Day One lot ID.

## 2. Ownership

| Record | Owner | Crosses the boundary as |
|---|---|---|
| Vendor master: legal name, status (`approved`, `onHold`, `blocked`), verified payout account, bill tolerances | ERP | Day One reads it; Kevin may only order from `approved` vendors whose payout account equals the account the contract will pay |
| Item master (raw materials, packaging, lab supplies, finished goods), locations (Acme's plants), chart of accounts, approval matrix, users and roles | ERP | Day One maps its material codes to item IDs by code |
| Purchase order terms (lines, prices, freight, `po_hash`) and the contract's verdict | Day One (Kevin drafts; the contract escrows) | Mirrored into the ERP by PO number, with the funding and approval tx hashes |
| Lots, lot states, genealogy, batch records, plant inventory ledger | Day One | Each ERP inventory line references the Day One lot ID and batch number |
| Item-level inventory: quantity and value per item per location per status | ERP (derived) | Posted by the connector: item receipts, status changes on QC, issues to production, waste, transfers, counts, opening balances at cutover |
| Vendor bills, 3-way match, bill approval | ERP | Kevin hands the bill over after reading it; the ERP matches it to its PO and receipts |
| Escrow, payment to the supplier | Day One's contract (`qc_release` pays) | Written back to the ERP as a vendor payment applied to the bill, with the tx hash and explorer link |
| General ledger journal lines, audit trail | ERP | Read-only view and API |

Kevin is a user in the ERP (`kevin.dayone`, role "Day One connector") with the permissions the connector needs and no more: read vendors and items; create purchase orders, item receipts, inventory adjustments, transfers and status changes; create vendor bills; create vendor payments. He cannot edit the vendor master, approve a bill or post a journal entry directly.

## 3. Shape

```
erp/                                 @day-one/erp — the mock ERP (no dependency on the rest of the repo)
  src/schema.ts, migrations/         SQLite via better-sqlite3 + Drizzle, STRICT tables, data/runtime/erp.db
  src/seed/                          masters, chart of accounts, approval matrix, users; migrated AP history
  src/posting/                       the posting engine: inventory, journals, audit (every write goes through it)
  src/match.ts                       3-way match with tolerances; duplicate-invoice check
  src/approval.ts                    approval matrix evaluation
  src/http/                          NetSuite-shaped routes and the read-only web view
  src/server.ts                      npm run erp → http://localhost:8087
  src/*.test.ts                      Vitest
server/src/erp-connector/
  types.ts                           ErpConnector: the interface Day One promises to implement against
  mock-netsuite.ts                   the adapter for erp/ over its REST shape (fetch; in-process for tests)
  sync.ts                            Day One ledger → ERP transactions (lot events, POs, receipts), idempotent
  *.test.ts                          round trip, ghost vendor, payee verification
scripts/erp-demo.ts                  npm run erp:demo — the replayed demo loop with the ERP attached
```

### 3.1 The API (NetSuite record style, loosely)

Base path `/services/rest/record/v1`. Collections return `{ links, count, hasMore, items: [{ id, links }], offset, totalResults }`; records return the full object with `id`, `tranId`, `tranDate`, reference fields as `{ id, refName }`, sublists as `{ items: [...] }`, status fields as `{ id, refName }`, custom body fields prefixed `custbody_`. Create returns `204` with a `Location` header; errors are `{ type, title, status, "o:errorDetails": [{ detail, "o:errorCode" }] }`. Auth is a bearer token per user (seeded demo tokens, overridable by env). Write access is checked against the user's role.

| Resource | Methods | Notes |
|---|---|---|
| `vendor` | GET list, GET id | `entityId`, `companyName`, `custentity_dayone_payout_account`, `custentity_vendor_status` (`approved`, `onHold`, `blocked`), `custentity_vb_po_qty_tolerance` (%), `custentity_vb_po_amt_tolerance` (%), `custentity_vb_ir_qty_difference` (absolute, base units) |
| `inventoryItem` | GET list, GET id | `itemId`, `displayName`, `unitsType`, `assetAccount`, `cost` (standard cost for opening balances), `custitem_dayone_material` |
| `location` | GET list, GET id | Acme Riverside, Hollow Pine (Plant B), Acme Lakeview |
| `account` | GET list | chart of accounts |
| `purchaseOrder` | GET, POST, PATCH | `tranId` = Day One PO number, `externalId` = the same, `approvalStatus`, `custbody_dayone_po_hash`, `custbody_near_funding_tx`, `custbody_near_approval_tx`, `custbody_contract_verdict` |
| `purchaseOrder/{id}/!transform/itemReceipt` | POST | lines with `inventoryDetail.inventoryAssignment.items[].receiptInventoryNumber` = Day One lot ID and `inventoryStatus` = `quarantine` |
| `itemReceipt` | GET list, GET id | |
| `inventoryStatusChange` | POST | QC release (`quarantine → good`) or rejection (`quarantine → rejected`) for a lot |
| `inventoryAdjustment` | POST | issues to production (batch number in `memo`, reason `production`), waste, counts, opening balances at cutover |
| `inventoryTransfer` | POST | Day One transfers between plants |
| `inventoryBalance` | GET list | derived: `item`, `location`, `inventoryStatus`, `quantityOnHand`, `value`, `averageCost` |
| `purchaseOrder/{id}/!transform/vendorBill` | POST | the bill; the ERP runs the 3-way match on save |
| `vendorBill` | GET list, GET id, PATCH | `tranId` = the vendor's invoice number, `custbody_match_status` (`matched`, `exception`), `custbody_match_exceptions`, `approvalStatus` (`pendingApproval`, `approved`, `rejected`), `custbody_duplicate_of` |
| `vendorPayment` | GET list, POST | `apply.items[].doc` = the bill, `custbody_near_tx`, `custbody_near_explorer_url`; an unmatched payment lands as a prepayment on account |
| `journalEntry` | GET list, GET id | every posting; `line.items[]` with `account`, `debit`, `credit`, `memo` |
| `trialBalance` | GET | debits = credits, by account |
| `auditTrail` | GET list | who, what, when, record |

### 3.2 Web view (read-only, `/`)

Bills with match status and exceptions; inventory by location; the general ledger and a trial balance; the audit trail. Server-rendered HTML, one stylesheet, no framework. Staff-facing: dollars, PO numbers, invoice numbers, lot IDs. No wallets, keys, gas or token names. A payment shows a settlement reference and a "verify" link to the explorer.

### 3.3 Posting rules (the accounting the mock does)

Money is integer micro-dollars (6 decimals) as everywhere in the repo; quantities are integers in Day One's base units (mg, each) and the API presents them in the item's unit (kg, ea). Costing is moving average per item and location.

| Event (from Day One) | ERP transaction | Journal |
|---|---|---|
| Cutover: lots on hand with no PO | `inventoryAdjustment` (reason `opening`), valued at the item's standard cost | Dr Inventory / Cr Opening balance equity (acquisition) |
| Dock receipt against a PO | `itemReceipt`, status `quarantine`, valued at PO price | Dr Inventory / Cr Accrued purchases (received not billed) |
| QC release | `inventoryStatusChange` quarantine → good | none (same inventory account; the quantity becomes available) |
| QC reject, return to vendor | `inventoryStatusChange` to `rejected`, then `inventoryAdjustment` out | Dr Accrued purchases / Cr Inventory (the receipt is reversed) |
| Issue to production (confirmed batch record) | `inventoryAdjustment` (reason `production`, memo = batch no.) at average cost | Dr Work in process / Cr Inventory |
| Waste | `inventoryAdjustment` (reason `waste`) | Dr Production waste / Cr Inventory |
| Count adjustment | `inventoryAdjustment` (reason `count`) | Dr/Cr Inventory adjustments expense |
| Transfer between plants | `inventoryTransfer` | none (quantity and value move between locations) |
| Vendor bill | `vendorBill` | Dr Accrued purchases (lines) + Dr Freight-in / Cr Accounts payable |
| Payment (escrow release) | `vendorPayment` applied to the bill | Dr Accounts payable / Cr Purchasing escrow clearing |
| Budget funded into the contract (seeded once) | `journalEntry` | Dr Purchasing escrow clearing / Cr Cash |

Invariants tested: every journal balances; inventory quantity and value per item/location/status equal the sum of posted movement lines; the trial balance's debits equal its credits after every demo step.

### 3.4 3-way match

On `vendorBill` save, per line against the PO and against the receipts for that PO:

- quantity billed vs ordered: within the vendor's `vb_po_qty_tolerance` (%)
- amount billed vs ordered: within the vendor's `vb_po_amt_tolerance` (%)
- quantity billed vs received: within the vendor's `vb_ir_qty_difference` (absolute); a bill for more than was received is an exception whatever the tolerance
- freight and total vs the PO
- vendor on the bill = vendor on the PO; PO must exist and be open

Tolerances live on the vendor record with subsidiary defaults (2% quantity, 1% amount, 0 difference), the way NetSuite's 3 Way Match Vendor Bill Approval reads them from the vendor, item or subsidiary. Every exception carries a code, the line, what was billed, ordered and received, and the tolerance applied: `{ code: "QTY_OVER_RECEIPT", line: 1, billed: 700, received: 675, tolerance: 0 }`.

**Duplicate invoice.** Before matching: same vendor and the same normalized invoice number (upper-case, non-alphanumerics removed, a trailing reissue suffix such as `-R`, `R`, `-COPY`, `REISSUE` stripped), or same vendor, same PO and same amount within 30 days of an existing bill. A duplicate is saved with `approvalStatus: rejected`, `custbody_duplicate_of` pointing at the original, and can never be paid.

**Price drift** (bookkeeper pack, FEATURES_V2 §2) is not a match exception: a bill at the PO's price matches. The ERP notes it on the bill (`custbody_price_drift`) when the unit price is more than 10% over the same vendor's last billed price for the item.

### 3.5 Approval matrix (on top of the contract, never instead of it)

Stored as rows in `approval_rules` (seeded; readable at `/approvalRule`):

| Scope | Condition | Required | Why it is not a contract rule |
|---|---|---|---|
| purchase order | any | the contract's verdict recorded: `funded` with a funding tx; over Kevin's limits, the director's `approve_po` tx | the ERP does not evaluate the per-PO limit, the monthly limit, the category cap or the supplier allowlist; it stores who approved and in which transaction |
| purchase order | total > $25,000 | HQ controller (Jordan Pike) in the ERP, in addition to the contract's approval | the contract has no HQ tier; this is Acme's internal policy |
| purchase order | vendor `onHold` | HQ controller | the contract knows `Conditional` (director); Acme adds a second signature |
| vendor bill | matched and total ≤ $10,000 | auto-approved | AP policy |
| vendor bill | matched and total > $10,000 | AP manager (Marcy Allen) | AP policy |
| vendor bill | any exception | AP manager, with a reason recorded | AP policy |
| vendor bill | duplicate | rejected; nobody can approve it | AP policy |
| vendor payment | bill `approved` | allowed | the escrow pays on QC release; the ERP records the payment and, when the bill is not approved, holds it as a prepayment for Marcy |

### 3.6 The connector interface (`server/src/erp-connector/types.ts`)

```ts
interface ErpConnector {
  readonly system: string;                     // "mock-netsuite" | "netsuite" …
  // vendor master
  getVendor(code: string): Promise<ErpVendor | null>;
  listVendors(filter?: { status?: ErpVendorStatus }): Promise<ErpVendor[]>;
  verifyPayee(input: { vendorCode: string; account: string }): Promise<PayeeCheck>;  // approved and the verified account
  // purchasing
  pushPurchaseOrder(po: PoMirror): Promise<ErpRef>;          // mirror by PO number with the contract's verdict
  recordContractVerdict(poNo: string, verdict: ContractVerdict): Promise<ErpRef>;
  closePurchaseOrder(poNo: string, reason: "cancelled" | "refunded"): Promise<ErpRef>;
  // inventory
  postItemReceipt(receipt: ReceiptPost): Promise<ErpRef>;    // lines with Day One lot ids, status quarantine
  postQcDecision(decision: QcPost): Promise<ErpRef>;         // release → good; reject → rejected and reversed
  postInventoryMovement(movement: MovementPost): Promise<ErpRef>;  // production issue, waste, count, transfer, opening
  // accounts payable
  postVendorBill(bill: BillPost): Promise<BillResult>;       // the ERP's match and approval status come back
  getBill(ref: { poNo: string } | { invoiceNo: string }): Promise<BillResult | null>;
  recordPayment(payment: PaymentPost): Promise<PaymentResult>;  // tx hash + explorer link; applied to the approved bill
  // derived reads
  getInventory(filter?: { location?: string; item?: string }): Promise<InventoryBalance[]>;
}
```

Every post is idempotent on its Day One key (`externalId`): posting the same receipt or movement twice returns the existing ERP record. The mock adapter talks to the ERP over its REST shape through a `fetch`-like function, so tests and the replayed demo run it in-process and `npm run erp` runs it over HTTP.

### 3.7 Where Kevin's workflow calls it

Hooks are optional (`DemoDeps.erp?`); the transcript of `npm run demo` does not change. `npm run erp:demo` runs the same replayed loop with the connector attached and prints the ERP's lines.

| Demo step | Connector call |
|---|---|
| 0 Load seed | cutover sync from Day One's ledger: history POs and receipts, opening lots, transfers, batch issues, waste → inventory by location; then the migrated AP history (FICTIONAL_DATA §13 bills, paid by check) is matched: 6 matched, OFH-3317-R rejected as a duplicate, PEC-55388 noted for price drift |
| 2 Ray confirms BR-B-1045 | `postInventoryMovement` production issue per lot (ASC 187.450 kg from ASC-261009-01, 224.900 kg from ASC-260921-02, …) |
| 6, 7, 9 POs | before submit: `verifyPayee` (vendor approved, payout account = the account the contract will pay); after the contract answers: `pushPurchaseOrder` with the verdict (funded tx, refused reason, then the director's approval tx and the funding tx) |
| 10 Delivery | `postItemReceipt` for PO-1042: 700 kg, lot ASC-261116-01, quarantine |
| before 11 | Kevin reads Northgate's invoice and `postVendorBill` → matched, auto-approved |
| 11 QC release | `postQcDecision` (release); the escrow pays; `recordPayment` with the `qc_release` tx and explorer link, applied to the bill |

### 3.8 Attack suite additions (`npm run test:attacks`, same format, numbers in the evidence)

5. **Duplicate invoice.** NG-INV-24190 for PO-1042 is posted, then posted again as `NG-INV-24190-R` ("reissued") with the same $5,150.00. The ERP rejects the second: `DUPLICATE_INVOICE`, duplicate of the first, which is already paid (tx). Nothing can be paid twice: the escrow for PO-1042 was released once and the contract has no second payout.
6. **Split purchase.** Two lab-chemical POs sized to pass the $2,500 per-PO limit but together over the `lab_chemical` monthly cap of $2,000. The ERP's matrix is satisfied by both (it has no category cap, by design). The contract funds the first and refuses the second with its exact message and the running total; the first is then cancelled by HQ so the budget returns. Held when the refusal names the cap.
7. **Ghost vendor.** A PO to "Harrow Chemical Co." (`harrow-chemical.testnet`), which is in neither the vendor master nor the contract's supplier list. The connector refuses to mirror it (`VENDOR_NOT_IN_MASTER`); the contract refuses `submit_po` ("is not an approved supplier; no approval can override this.").

Attacks 6 and 7 add chain calls, so the suite's fixtures are re-recorded live once (`npm run test:attacks -- --record`); attacks 1–4 are unchanged.

## 4. Running it

| Task | Command |
|---|---|
| Rebuild the ERP from seed (masters, cutover sync from a fresh Day One seed, migrated AP history) | `npm run erp:seed` → `data/runtime/erp.db` |
| Start the ERP (API and web view) | `npm run erp` → http://localhost:8087 |
| The demo loop with the ERP attached (replay, no keys) | `npm run erp:demo` (`-- --json`) |
| Tests | `npm test` (ERP and connector tests are part of the suite) |

## 5. Limitations (honest list)

- A mock: no SuiteQL, no OAuth, no multi-subsidiary, no tax, no currencies. Field names follow NetSuite's style; the set is small.
- Costing is moving average with integer rounding at each issue; no landed-cost allocation (freight is expensed).
- Finished goods are not received into the ERP because Day One does not yet book output lots; work in process carries the issued material.
- The ERP's bill match and Kevin's own invoice screen overlap on amounts; Kevin's screen exists to guard the payee account and to catch text aimed at an assistant, the ERP's to keep the books. Neither is a contract rule.

---

## 6. Build plan (Oct 28)

Small commits, `npm run check` green before each. Order:

1. `erp/` workspace skeleton: package, tsconfig, Drizzle schema and migration, `openErp`, money and quantity helpers, the seed of masters (locations, accounts, items with standard costs, vendors with payout accounts and tolerances, users and roles, approval rules). Tests: schema is STRICT, seed loads, vendor statuses.
2. Posting engine: journals, inventory balances (qty, value, average cost), audit trail; adjustments, transfers, status changes. Tests: balances = sum of movements; journals balance.
3. Purchasing documents: purchase orders (mirror + verdict), item receipts from a PO, approval matrix for POs. Tests.
4. Vendor bills: 3-way match with tolerances, duplicate check, price-drift note, bill approval matrix, vendor payments (applied vs prepayment). Tests for every tolerance edge.
5. REST shape: router (in-process), auth and roles, errors, collections, transforms; `server.ts`; web view. Tests through the router.
6. Connector: `types.ts`, `mock-netsuite.ts`, `sync.ts` (Day One lot events → movements; history POs and receipts), migrated AP history loader. Tests: round trip, idempotency, ghost vendor, payee check.
7. Kevin hooks (minimal edits in `agents/kevin/src/demo.ts`): optional `erp` dep, the invoice read moved before QC release, hook calls; `scripts/erp-demo.ts`; `npm run erp:seed`, `erp`, `erp:demo` in root `package.json`.
8. Attack suite: attacks 5–7 in `agents/kevin/src/attacks.ts` and `scripts/attacks.ts`; live re-record of the fixtures; HQ cancel of the split PO.
9. This document finished; README section text ready to paste (README itself is not edited on this branch).
