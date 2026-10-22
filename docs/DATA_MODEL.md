# Data model — Day One

The off-chain ledger is SQLite (`data/dayone.db`, gitignored, rebuilt by the demo command) via better-sqlite3 13.0.3 and Drizzle 0.45.4. The Drizzle schema in `server/ledger/schema.ts` is the code form of this document and must stay in sync with it. Rationale: research 18.

---

## 1. Conventions

- `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, STRICT tables.
- **Quantities are integers in a base unit per dimension:** mass in **mg**, volume in **µL**, count in **each**. No floats. "Tracked to the gram" over hundreds of millions of tablets needs exact sums.
- **Money is integer token base units** (6 decimals) in `*_usdc` columns, identical to on-chain amounts. Only the UI formats dollars.
- Timestamps are ISO-8601 UTC text from the demo clock, so seeded runs are identical.
- Every entity has an integer PK plus a readable unique code (`PO-1042`, `ASC-261009-01`, `BR-B-1045`) used by the demo script and README.
- **Hybrid event sourcing:** lot movements and states are an append-only, hash-chained event log. Reference data is ordinary mutable rows.

---

## 2. Organization

| Table | Key columns |
|---|---|
| `facilities` | `code` (ACME, A, B, C), `name`, `role` (`hq`, `sister`, `acquired`, `packaging`), `near_account_id`, `onboarding_status` (`grey`, `onboarding`, `online`) |
| `departments` | `facility_id`, `code` (`receiving`, `warehouse`, `weigh_dispense`, `blending`, `compression`, `packaging`, `qc_lab`, `purchasing`, `accounting`), `onboarding_status`, `onboarded_at` |
| `staff` | `facility_id`, `name`, `role` (`purchaser`, `ops_director`, `receiving`, `qc`, `accounting`, `hq_integration`), `near_account_id` (nullable) |

## 3. Reference data

| Table | Key columns |
|---|---|
| `units` | `code` (`mg`, `g`, `kg`, `lb`, `uL`, `mL`, `L`, `each`, `tablet`), `dimension` (`mass`, `volume`, `count`), `to_base_num`, `to_base_den` (rational factors) |
| `material_unit_conversions` | `material_id`, `unit_code` (e.g. `bag`, `case`, `drum`), `to_base_num`, `to_base_den` |
| `materials` | `code` (ASC, MCC…), `name`, `category` (`active`, `excipient`, `packaging`, `lab_chemical`), `dimension`, `base_unit`, `reorder_point_base`, `reorder_qty_base`, `default_lead_time_days` |
| `products` | `code` (P-VC500…), `name`, `tablet_weight_mg`, `standard_batch_tablets`, `expected_yield_bp` (9000 = 90.00%) |
| `formulas` | `product_id`, `version`, `status` (`draft`, `active`, `retired`), `effective_from` |
| `formula_lines` | `formula_id`, `material_id`, `qty_per_batch_base`, `overage_bp`, `tolerance_bp` (50 = ±0.5%) |
| `vendors` | `code`, `name`, `near_account_id`, `qualification_status` (`qualified`, `conditional`, `unqualified`, `suspended`), `qualified_on`, `requalify_due_on`, `notes` |
| `vendor_materials` | `vendor_id`, `material_id`, `vendor_item_code`, `approved_source` |

Kevin's purchase rules read `qualification_status`: `unqualified` and `suspended` are excluded from ranking; `conditional` always routes to approval. These mirror, but do not replace, the contract's limits. The contract decides money; the ledger decides which vendor Kevin is allowed to ask.

## 4. Lots (events are the truth)

| Table | Key columns |
|---|---|
| `lots` | `lot_code` (unique), `material_id`, `vendor_id`, `vendor_lot_code`, `po_line_id` (nullable), `produced_by_batch_id` (nullable), `current_facility_id`, `state`, `expires_on`. `state` and `current_facility_id` are a **projection** written only by the event writer. |
| `lot_events` | `seq` (unique, global), `lot_id`, `kind`, `from_state`, `to_state`, `qty_delta_base`, `facility_id`, `department_id`, `ref_type` (`po`, `transfer`, `batch`, `count`, `qc`), `ref_id`, `actor_type` (`staff`, `kevin`, `supplier_agent`, `system`), `actor_id`, `reason`, `occurred_at`, `recorded_at`, `prev_hash`, `event_hash` |
| `lot_balances` (view) | `lot_id`, `facility_id`, `on_hand_base = SUM(qty_delta_base)` |

**States:** `on_order → en_route → received → quarantine → released → in_use → consumed | wasted`, plus `quarantine → rejected` and `released → wasted` (expiry or damage). Transfers change facility, not state.

**Event kinds:** `ordered`, `shipped`, `received`, `quarantined`, `released`, `rejected`, `issued`, `returned`, `consumed`, `wasted`, `transfer_out`, `transfer_in`, `count_adjust`.

**Rules:**
1. One function, `appendLotEvent(tx, event)`, validates the transition, computes `event_hash = sha256(canonical_json(event) || prev_hash)`, inserts, and updates the projection, inside one SQLite transaction.
2. Triggers block `UPDATE` and `DELETE` on `lot_events`.
3. Corrections are compensating events (`count_adjust` with a reason). Nothing is edited.
4. `rebuildProjections()` replays all events; a test asserts it matches the cached projection.
5. Available inventory excludes `quarantine`, `rejected`, `on_order` and `en_route`.

## 5. Transfers and discrepancies

| Table | Key columns |
|---|---|
| `transfers` | `transfer_no`, `lot_id`, `from_facility_id`, `to_facility_id`, `qty_shipped_base`, `qty_received_base`, `state` (`requested`, `in_transit`, `received`, `discrepancy`, `resolved`), `out_event_id`, `in_event_id` |
| `discrepancies` | `kind` (`transfer_qty`, `count_vs_book`, `yield_variance`, `unrecorded_consumption`), `facility_id`, `lot_id`, `expected_base`, `observed_base`, `detected_by`, `status` (`open`, `proposed_adjustment`, `adjusted`, `dismissed`), `explanation`, `proposed_event_json` |

The seeded `ASC-261009-01` case: shipped 200,000,000 mg, received 187,450,000 mg, phantom 12,550,000 mg at Plant A (FICTIONAL_DATA §8).

## 6. Production and genealogy

| Table | Key columns |
|---|---|
| `batch_records` | `batch_no`, `product_id`, `formula_id`, `facility_id`, `started_at`, `completed_at`, `theoretical_tablets`, `actual_tablets`, `yield_bp` (derived), `waste_base`, `source_file`, `source_sha256`, `extraction_json`, `extraction_model`, `status` (`draft`, `confirmed`, `rejected`), `confirmed_by`, `confirmed_at`, `record_hash`, `salt` |
| `batch_inputs` | `batch_id`, `lot_id`, `material_id`, `expected_base`, `actual_base`, `field_confidence`, `issue_event_id` — **backward genealogy** |
| `batch_outputs` | `batch_id`, `output_lot_id` — **forward genealogy** |
| `extraction_flags` | `batch_id`, `field_path`, `kind` (`low_confidence`, `out_of_tolerance`, `unit_mismatch`, `unknown_lot`, `correction_detected`), `message`, `resolved_by`, `resolved_value` |

## 7. Purchasing

| Table | Key columns |
|---|---|
| `forecasts` | `material_id`, `facility_id`, `horizon_days`, `projected_need_base`, `on_hand_base`, `on_order_base`, `shortfall_base`, `method_note`, `created_at` |
| `rfqs` | `rfq_no`, `material_id`, `qty_base`, `need_by`, `facility_id`, `created_by` |
| `quotes` | `rfq_id`, `vendor_id`, `unit_price_usdc` (per base-unit multiple, see below), `lead_time_days`, `valid_until`, `status` (`received`, `accepted`, `declined`, `excluded`), `exclusion_reason`, `quote_hash`, `chain_tx_id` |
| `purchase_orders` | `po_no`, `vendor_id`, `ship_to_facility_id`, `category` (`raw_material`, `packaging`, `lab_chemical`), `total_usdc`, `status`, `po_hash`, `created_by`, `need_by` |
| `po_lines` | `po_id`, `line_no`, `material_id`, `qty_base`, `unit`, `unit_price_usdc`, `extended_usdc`, `quote_id` |
| `approvals` | `po_id`, `approver_staff_id`, `channel` (`sms_sim`), `request_text`, `response_text`, `state` (`requested`, `approved`, `declined`, `expired`), `requested_at`, `responded_at`, `refused_tx_id`, `approve_tx_id` |
| `receipts` | `po_id`, `facility_id`, `packing_slip_file`, `packing_slip_sha256`, `match_status` (`matched`, `mismatch`), `mismatch_notes`, `received_by`, `received_at` |
| `qc_decisions` | `lot_id`, `po_id`, `decision` (`released`, `rejected`), `decided_by`, `decided_at`, `chain_tx_id` |

**PO status:** `draft → submitted → (authorized | refused) → awaiting_approval → approved → funded → received → released → paid`, with `cancelled` and `rejected` as exits. `refused` is a normal, expected state.

**Prices:** store `unit_price_usdc` per the PO line's unit (e.g. per kg) and compute `extended_usdc` with integer math; round half up at the line level only.

**`po_hash`:** sha256 of the canonical PO (vendor, lines, total, need-by, salt). It binds the director's approval to exact terms.

## 8. Chain evidence

| Table | Key columns |
|---|---|
| `chain_tx` | `network`, `mode` (`live`, `replay`), `kind` (`submit_po`, `approve_po`, `reject_po`, `fund_escrow`, `confirm_receipt`, `qc_release`, `qc_reject`, `refund`, `anchor`, `quote`, `storage_deposit`, `ft_transfer`), `signer_id`, `predecessor_id`, `receiver_id`, `method`, `args_json` (no secrets), `via_relayer`, `token`, `tx_hash`, `status` (`pending`, `success`, `refused`, `failed`), `error_message`, `events_json`, `block_height`, `explorer_url`, `related_type`, `related_id`, `created_at` |
| `anchors` | `subject_type` (`batch_record`, `lot_events_range`, `receipt`), `ref_id`, `from_seq`, `to_seq`, `hash`, `prev_hash`, `chain_tx_id`, `anchored_at` |
| `llm_calls` | `task` (`extract_batch_record`, `match_packing_slip`, `explain_ranking`, `draft_message`), `provider`, `model`, `tier` (`private_tee`, `external`), `request_sha256`, `response_sha256`, `chat_id`, `signature_verified`, `fixture_path`, `latency_ms`, `cost_estimate_usdc`, `created_at` |
| `attestations` | `provider`, `model`, `nonce`, `signing_address`, `tdx_status`, `gpu_status`, `compose_hash_ok`, `report_path`, `verified_at` |

`refused` means the contract panicked by design (policy refusal), shown red with the message. `failed` means something broke and is a bug.

## 9. Replay fixtures

`data/replay/` (committed) holds:
- `chain/*.json` — recorded RPC results for each demo transaction, keyed by step, with real tx hashes
- `llm/*.json` — recorded LLM requests and responses with NEAR AI Cloud signatures
- `attestation/report.json` — one recorded attestation report
- `transcript.txt` — the text form of the behind-the-curtain view for the full demo run

Replay mode loads the seed, runs the same workflow, and substitutes fixtures for network calls. Seeded event timestamps make hashes identical to the recorded live run.
