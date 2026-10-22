# 18. Inventory ledger (database, driver, ORM, schema)

**Question:** SQLite or Postgres for a demo that must run from a clean clone with one command and no secrets? Which Node SQLite driver (better-sqlite3 vs built-in `node:sqlite`), on which Node LTS? Which query layer (Drizzle vs Kysely vs raw SQL)? What schema covers facilities, departments, materials, units and conversions, formulas/BOM, vendors, lots and their state machine, transfers, batch records, genealogy, POs, quotes, approvals, the chain-tx log and anchors? Event-sourced movements or mutable state?

**Answer:** **SQLite**, as a single file created by the demo command. Postgres needs a server (Docker or an install) and a connection string, and gives nothing at this scale. Use **better-sqlite3 13.0.3**: its first N-API release (July 2026) ships prebuilt binaries inside the npm package, so a clean `npm install` has no install script, no compile step and no separate binary download. It requires Node ≥22. Pair it with **Drizzle ORM 0.45.4 + drizzle-kit 0.31.11** (stable). The TypeScript schema doubles as readable documentation for AI judges, and drizzle-kit emits plain `.sql` migrations we commit. Built-in `node:sqlite` is the zero-dependency alternative, but it is still "Stability 1.2 – Release candidate" on both Node 24.22.1 and 26.12.1. Drizzle's `node-sqlite` driver exists only in the 1.0 release candidates (rc.5, published 2026-10-21), and Kysely supports it only through a community dialect. Model lot quantities and states as an **append-only, hash-chained `lot_events` log** with derived balances (event-sourced), and keep reference data mutable.

**Confidence:** high on versions, Node schedule and node:sqlite status (npm registry, nodejs.org docs and nodejs/Release read today). Medium-high that better-sqlite3 13 installs cleanly on Windows/Linux/macOS with no toolchain: the package has no install script and is ~27 MB unpacked with bundled prebuilds, and the release notes say platforms without a prebuild compile. This should be verified on Nov 1 with a real `npm ci` on Windows and in WSL.

**Decision recommended:** Use SQLite (`data/dayone.db`, gitignored, rebuilt by `npm run demo`) via better-sqlite3 13.0.3 + Drizzle 0.45.4. Run Node 24 LTS (≥24.15) or Node 26 (Active LTS from 2026-10-28), with `"engines": { "node": ">=22.13" }`. Put all DB access behind `server/ledger/` so a later switch to `node:sqlite` is a one-file change. Make `lot_events` append-only, with UPDATE/DELETE blocked by triggers and a `prev_hash → event_hash` chain that the anchoring job (task 9) commits on-chain.

## Details

### SQLite vs Postgres for this demo

| | SQLite (recommended) | Postgres | PGlite 0.5.11 (Postgres in WASM) |
|---|---|---|---|
| Clean clone, one command, no secrets | Yes: file created on first run | Needs Docker/install + `DATABASE_URL` | Yes, in-process |
| Disk / install | ~27 MB package | Docker image hundreds of MB, or a full install | ~26 MB package |
| Fits a ledger of ~30 materials, a few hundred lots, thousands of events | Easily | Overkill | Fine |
| Reset for deterministic demo | Delete file, migrate, seed (< 1 s) | Drop/create DB | Same as SQLite |
| AI judge can inspect | `sqlite3 data/dayone.db` or any viewer | Needs a running server | Harder (in-process only) |
| Roadmap story | "Swap to Postgres via Drizzle dialect when multi-tenant" | | |

### Driver options (Node, read 2026-10-22)

| | better-sqlite3 13.0.3 (recommended) | `node:sqlite` built-in |
|---|---|---|
| Status | Mature; v13 = first N-API release, prebuilds bundled; engines `node >=22` | **Release candidate (1.2)**: RC since v24.15.0 and v25.7.0; unflagged since v22.13.0 / v23.4.0 |
| API | Sync, prepared statements, `.transaction()` helper | Sync. On Node 26 the class is renamed `Database` (`DatabaseSync` is a deprecated alias, DEP0210); Node 24 still documents `DatabaseSync`. Name churn is a risk. |
| Install risk | Low (no install script). Compiles only on a platform without a prebuild. | None |
| ORM support | Drizzle stable (`drizzle-orm/better-sqlite3`), Kysely core `SqliteDialect` | Drizzle only in 1.0 RC (`drizzle-orm/node-sqlite`, `npm i drizzle-orm@rc`); Kysely via community `kysely-node-native-sqlite` |
| Security note | | CVE-2026-58041 (`createTagStore()` stale statements) fixed in 24.18.1 / 26.5.1, so require a patched Node if used |

**Node LTS today (2026-10-22):** Node 24 "Krypton" is LTS (latest 24.22.1, 2026-10-20) and moved to Maintenance on 2026-10-20 per the release schedule. Node 26 is Current (26.12.1) and becomes **Active LTS on 2026-10-28**, before the build window. Node 22 is Maintenance until 2027-04-30. Vite 8.3.5 needs `^20.19.0 || >=22.12.0`. **Recommend Node 24.22.x for development**, switching to 26 LTS only if a dependency requires it. `node` is not currently installed on the dev machine (checked from Git Bash), so install it before Nov 1. Commit an `.nvmrc` / `"engines"` field so judges see the target.

### Query layer

| | Drizzle 0.45.4 (recommended) | Kysely 0.29.7 | Raw SQL |
|---|---|---|---|
| Schema as code | Yes: `sqliteTable(...)` reads like the data model | Types only; schema lives in migrations | `.sql` files |
| Migrations | drizzle-kit generates committed `.sql` | Own migrator, hand-written | Hand-written |
| Type safety | Full | Full (query builder) | Manual |
| AI-judge legibility | High | Medium | High for SQL readers, but no types |
| Risk | Large package (~17 MB) and 1.0 imminent; pin 0.45.4, do not chase the RC | Engines `node >=22` | Most code to write |

Kysely is the better query builder purists' choice, but Drizzle's schema file is the artifact a judge reads to understand the domain. Use Drizzle's `sql` template for the few projections that are clearer in SQL.

### Conventions

- `PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;` and STRICT tables.
- **Quantities are integers in a base unit per dimension:** mass in **mg**, volume in **µL**, count in **each**. "Tracked to the gram" with ~10% waste on hundreds of millions of tablets needs exact sums, so no floats.
- **Money is integer USDC base units** (6 decimals, `*_usdc` columns), matching the NEP-141 contract and avoiding cents↔chain conversions. Display formatting happens in the UI only.
- Timestamps are ISO-8601 UTC text. Demo timestamps come from the seed/demo clock, so they are deterministic.
- IDs are short readable codes (`PO-1042`, `LOT-MCC-2611`) as unique columns next to integer PKs, so the demo script and README can reference them.

### Schema sketch (for DATA_MODEL.md; not code before Nov 1)

**Org and reference data (mutable)**
- `facilities(id, code, name, role['acquired'|'sister'|'hq'], near_account_id, onboarding_status['grey'|'onboarding'|'online'])`
- `departments(id, facility_id→, code['receiving'|'warehouse'|'qc_lab'|'blending'|'compression'|'packaging'|'purchasing'|'accounting'], name, onboarding_status, onboarded_at)`
- `staff(id, facility_id→, name, role['purchaser'|'ops_director'|'receiving'|'qc'|'accounting'], phone_fictional, near_account_id nullable)`
- `units(code PK['mg'|'g'|'kg'|'lb'|'uL'|'mL'|'L'|'each'|'tablet'], dimension['mass'|'volume'|'count'], to_base_num, to_base_den)` (rational factors: `lb = 45359237/100 mg`)
- `material_unit_conversions(material_id→, unit_code→, to_base_num, to_base_den)` for material-specific packs (`case = 2000 each`, `drum = 25 kg`)
- `materials(id, code, name, category['active'|'excipient'|'packaging'|'lab_chemical'|'equipment'], dimension, base_unit→, reorder_point_base, safety_stock_base, default_lead_time_days, shelf_life_days)`
- `products(id, code, name, tablet_weight_mg, standard_batch_tablets)`
- `formulas(id, product_id→, version, status['draft'|'active'|'retired'], effective_from)`
- `formula_lines(formula_id→, material_id→, qty_per_batch_base, overage_bp, tolerance_bp)` (expected consumption; extraction is validated against this, task 14)
- `vendors(id, code, name, near_account_id, qualification_status['unqualified'|'pending'|'qualified'|'suspended'|'disqualified'], qualified_on, requalify_due_on, notes)`
- `vendor_materials(vendor_id→, material_id→, vendor_item_code, approved_source bool)`

**Lots (state cached, events are truth)**
- `lots(id, lot_code UNIQUE, material_id→, vendor_id→, vendor_lot_code, po_line_id→ nullable, produced_by_batch_id→ nullable, current_facility_id→, state['on_order'|'en_route'|'received'|'quarantine'|'released'|'in_use'|'consumed'|'wasted'|'rejected'], expires_on)`. `state` and `current_facility_id` are a **projection**, rewritten only by the event writer.
- `lot_events(id, seq UNIQUE, lot_id→, kind, from_state, to_state, qty_delta_base, facility_id→, department_id→, ref_type['po'|'transfer'|'batch'|'count'|'qc'], ref_id, actor_type['staff'|'kevin'|'supplier_agent'|'system'], actor_id, reason, occurred_at, recorded_at, prev_hash, event_hash)`
  - `kind ∈ {ordered, shipped, received, quarantined, released, rejected, issued, returned, consumed, wasted, transfer_out, transfer_in, count_adjust}`
  - Allowed transitions (enforced in `server/ledger/transitions.ts` and covered by tests): `on_order→en_route→received→quarantine→released→in_use→(consumed|wasted)`, plus `quarantine→rejected` and `released→wasted` (expiry/damage). `transfer_out/transfer_in` move facility without changing state.
- `lot_balances` (view or projection table): `lot_id, facility_id, on_hand_base` = `SUM(qty_delta_base)` grouped from `lot_events`.

**Cross-facility transfers**
- `transfers(id, transfer_no, lot_id→, from_facility_id→, to_facility_id→, qty_shipped_base, qty_received_base nullable, state['requested'|'in_transit'|'received'|'discrepancy'|'resolved'], out_event_id→, in_event_id→)`
- `discrepancies(id, kind['transfer_qty'|'count_vs_book'|'yield_variance'|'unrecorded_consumption'], facility_id→, lot_id→, expected_base, observed_base, detected_by['kevin'|'staff'], status['open'|'explained'|'adjusted'], explanation)` (the planted demo discrepancy lands here)

**Production and genealogy**
- `batch_records(id, batch_no UNIQUE, product_id→, formula_id→, facility_id→, started_at, completed_at, theoretical_tablets, actual_tablets, yield_bp (derived), source_file, source_sha256, extraction_json, extraction_confidence, status['draft'|'confirmed'|'rejected'], confirmed_by→staff, confirmed_at)`
- `batch_inputs(batch_id→, lot_id→, material_id→, expected_base, actual_base, waste_base, field_confidence, issue_event_id→)` (genealogy: which input lots went into which batch)
- `batch_outputs(batch_id→, output_lot_id→)` (finished-goods lots, for forward genealogy)

**Purchasing**
- `rfqs(id, rfq_no, material_id→, qty_base, need_by, facility_id→, created_by['kevin'|'staff'])`
- `quotes(id, rfq_id→, vendor_id→, unit_price_usdc, lead_time_days, valid_until, status['received'|'accepted'|'declined'|'expired'], quote_hash, chain_tx_id→ nullable)` (Tier 1: supplier agents quote on-chain)
- `purchase_orders(id, po_no UNIQUE, vendor_id→, ship_to_facility_id→, category['raw_material'|'packaging'|'lab_chemical'|'equipment'], total_usdc, status['draft'|'submitted'|'refused'|'awaiting_approval'|'approved'|'funded'|'shipped'|'received'|'released'|'paid'|'cancelled'], po_hash, created_by)`
- `po_lines(id, po_id→, line_no, material_id→, qty_base, unit_price_usdc, quote_id→)`
- `approvals(id, po_id→, approver_staff_id→, channel['sms_sim'], request_text, response_text, state['requested'|'approved'|'declined'|'expired'], requested_at, responded_at, refused_tx_id→chain_tx, approve_tx_id→chain_tx)`
- `receipts(id, po_id→, facility_id→, packing_slip_file, packing_slip_sha256, received_by→staff, received_at)` (receiving-dock photo)

**Chain evidence**
- `chain_tx(id, network['testnet'], mode['live'|'replay'], kind['submit_po'|'approve_po'|'fund_escrow'|'release'|'refund'|'anchor'|'quote'|'accept_quote'|'storage_deposit'|'ft_transfer'], signer_id, predecessor_id, receiver_id, method, args_json (never secrets, never prices if private), via_relayer bool, tx_hash, status['pending'|'success'|'refused'|'failed'], error_message (contract panic text for refusals), block_height, explorer_url, related_type, related_id, created_at)`
  - `refused` = the contract panicked by design (policy refusal), shown red with the message. `failed` = something broke.
- `anchors(id, subject_type['lot_events'|'batch_record'|'approval'|'receipt'], from_seq, to_seq, root_sha256, prev_anchor_root, chain_tx_id→, anchored_at)` (one anchor covers a range of the event hash chain)

### Event-sourced movements vs mutable state: recommendation

**Hybrid.** Lot movements and state changes are events. Everything else is ordinary rows.

- **Why events for lots:** the purchaser's real problem is "another plant's errors corrupt my numbers". An append-only log answers "who changed this, when, and from what", and a discrepancy is a visible pair of events, not a silently overwritten number. Genealogy falls out of `issued` events tied to `batch_id`. The hash chain over `lot_events` is exactly what gets anchored on-chain (task 9), so "tamper-evident" is literal: change one past event and every later hash and the anchored root stop matching.
- **Why not full event sourcing everywhere:** vendors, materials and formulas change rarely and have no audit story in the demo. Event-sourcing them costs time and buys nothing.
- **Mechanics:**
  1. A single `appendLotEvent(tx, event)` function, inside a SQLite transaction, validates the transition, computes `event_hash = sha256(canonical_json(event) || prev_hash)`, inserts the event, and updates the `lots` projection.
  2. Triggers `BEFORE UPDATE/DELETE ON lot_events → RAISE(ABORT)`.
  3. Corrections are compensating events (`count_adjust` with a reason), never edits.
  4. `rebuildProjections()` replays all events, and a test asserts the result equals the cached projection.
- **Demo determinism:** the seed is a list of events with fixed timestamps, so `npm run demo` builds an identical DB and identical hashes every run, and the replay-mode anchors match the recorded testnet anchors.

## Open questions for the human

- Is Node 24 LTS acceptable as the pinned runtime? It is in maintenance but is the newest LTS until Oct 28. The alternative is Node 26 once it is LTS on Oct 28.

## Sources

- https://registry.npmjs.org/better-sqlite3/latest — 13.0.3, engines `node >=22`, ~27 MB unpacked, no install script, published 2026-08-05 (accessed 2026-10-22)
- https://github.com/WiseLibs/better-sqlite3/releases — v13.0.0 (21 Jul) first N-API release with prebuilt binaries shipped in the package; v12.10.0 added Node 26 prebuilds (accessed 2026-10-22)
- https://nodejs.org/api/sqlite.html — v26.12.1 docs: Stability 1.2 Release candidate; RC since v25.7.0; unflagged since v22.13.0/v23.4.0; `DatabaseSync` deprecated alias of `Database` (DEP0210); all APIs synchronous (accessed 2026-10-22)
- https://nodejs.org/docs/latest-v24.x/api/sqlite.html — v24.22.1 docs: Stability 1.2 RC since v24.15.0; main class `DatabaseSync` (accessed 2026-10-22)
- https://nodejs.org/dist/index.json — latest LTS v24.22.1 (2026-10-20), Current v26.12.1 (2026-10-21) (accessed 2026-10-22)
- https://github.com/nodejs/Release — Node 26 Active LTS 2026-10-28; Node 24 maintenance from 2026-10-20; Node 22 EOL 2027-04-30 (accessed 2026-10-22)
- https://vulert.com/vuln-db/CVE-2026-58041 — node:sqlite `createTagStore()` CVE, fixed in 24.18.1 / 26.5.1 (accessed 2026-10-22)
- https://registry.npmjs.org/drizzle-orm (dist-tags, versions) — latest 0.45.4 has `better-sqlite3` driver export but no `node-sqlite`; 1.0.0-rc.5 published 2026-10-21 (accessed 2026-10-22)
- https://orm.drizzle.team/docs/connect-node-sqlite — `drizzle-orm/node-sqlite` installed via `drizzle-orm@rc` (accessed 2026-10-22)
- https://registry.npmjs.org/drizzle-kit/latest — 0.31.11 (accessed 2026-10-22)
- https://registry.npmjs.org/kysely/latest — 0.29.7, engines `node >=22.0.0` (accessed 2026-10-22)
- https://kysely.dev/docs/dialects — core dialects incl. SQLite; node:sqlite only via community `kysely-node-native-sqlite` (accessed 2026-10-22)
- https://registry.npmjs.org/@electric-sql/pglite/latest — 0.5.11, ~26 MB unpacked (accessed 2026-10-22)
- https://registry.npmjs.org/vite/latest — engines `^20.19.0 || >=22.12.0` (accessed 2026-10-22)
