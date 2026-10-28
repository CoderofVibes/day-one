CREATE TABLE `anchors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_type` text NOT NULL,
	`ref_id` integer,
	`from_seq` integer,
	`to_seq` integer,
	`hash` text NOT NULL,
	`prev_hash` text,
	`chain_tx_id` integer,
	`anchored_at` text NOT NULL,
	FOREIGN KEY (`chain_tx_id`) REFERENCES `chain_tx`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "anchors_subject_type" CHECK("anchors"."subject_type" in ('batch_record', 'lot_events_range', 'receipt'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`approver_staff_id` integer NOT NULL,
	`channel` text NOT NULL,
	`request_text` text NOT NULL,
	`response_text` text,
	`state` text DEFAULT 'requested' NOT NULL,
	`requested_at` text NOT NULL,
	`responded_at` text,
	`refused_tx_id` integer,
	`approve_tx_id` integer,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approver_staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refused_tx_id`) REFERENCES `chain_tx`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approve_tx_id`) REFERENCES `chain_tx`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "approvals_channel" CHECK("approvals"."channel" in ('sms_sim')),
	CONSTRAINT "approvals_state" CHECK("approvals"."state" in ('requested', 'approved', 'declined', 'expired'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `attestations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`nonce` text NOT NULL,
	`signing_address` text,
	`tdx_status` text,
	`gpu_status` text,
	`compose_hash_ok` integer,
	`report_path` text,
	`verified_at` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `batch_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`expected_base` integer,
	`actual_base` integer NOT NULL,
	`field_confidence` integer,
	`issue_event_id` integer,
	FOREIGN KEY (`batch_id`) REFERENCES `batch_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_event_id`) REFERENCES `lot_events`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE TABLE `batch_outputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`output_lot_id` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `batch_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`output_lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_outputs_batchId_outputLotId_unique` ON `batch_outputs` (`batch_id`,`output_lot_id`);--> statement-breakpoint
CREATE TABLE `batch_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_no` text NOT NULL,
	`product_id` integer NOT NULL,
	`formula_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`started_at` text,
	`completed_at` text,
	`theoretical_tablets` integer,
	`actual_tablets` integer,
	`yield_bp` integer,
	`waste_base` integer,
	`source_file` text,
	`source_sha256` text,
	`extraction_json` text,
	`extraction_model` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`confirmed_by` integer,
	`confirmed_at` text,
	`record_hash` text,
	`salt` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`formula_id`) REFERENCES `formulas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batch_records_status" CHECK("batch_records"."status" in ('draft', 'confirmed', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_records_batchNo_unique` ON `batch_records` (`batch_no`);--> statement-breakpoint
CREATE TABLE `chain_tx` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`network` text NOT NULL,
	`mode` text NOT NULL,
	`kind` text NOT NULL,
	`signer_id` text NOT NULL,
	`predecessor_id` text,
	`receiver_id` text NOT NULL,
	`method` text NOT NULL,
	`args_json` text NOT NULL,
	`via_relayer` integer DEFAULT false NOT NULL,
	`token` text,
	`tx_hash` text,
	`status` text NOT NULL,
	`error_message` text,
	`events_json` text,
	`block_height` integer,
	`explorer_url` text,
	`related_type` text,
	`related_id` integer,
	`created_at` text NOT NULL,
	CONSTRAINT "chain_tx_mode" CHECK("chain_tx"."mode" in ('live', 'replay')),
	CONSTRAINT "chain_tx_kind" CHECK("chain_tx"."kind" in ('submit_po', 'approve_po', 'reject_po', 'fund_escrow', 'confirm_receipt', 'qc_release', 'qc_reject', 'refund', 'anchor', 'quote', 'storage_deposit', 'ft_transfer')),
	CONSTRAINT "chain_tx_status" CHECK("chain_tx"."status" in ('pending', 'success', 'refused', 'failed'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`code` text NOT NULL,
	`onboarding_status` text DEFAULT 'grey' NOT NULL,
	`onboarded_at` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "departments_code" CHECK("departments"."code" in ('receiving', 'warehouse', 'weigh_dispense', 'blending', 'compression', 'packaging', 'qc_lab', 'purchasing', 'accounting')),
	CONSTRAINT "departments_onboarding" CHECK("departments"."onboarding_status" in ('grey', 'onboarding', 'online'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_facilityId_code_unique` ON `departments` (`facility_id`,`code`);--> statement-breakpoint
CREATE TABLE `discrepancies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`facility_id` integer NOT NULL,
	`lot_id` integer,
	`expected_base` integer NOT NULL,
	`observed_base` integer NOT NULL,
	`detected_by` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`explanation` text,
	`proposed_event_json` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discrepancies_kind" CHECK("discrepancies"."kind" in ('transfer_qty', 'count_vs_book', 'yield_variance', 'unrecorded_consumption')),
	CONSTRAINT "discrepancies_status" CHECK("discrepancies"."status" in ('open', 'proposed_adjustment', 'adjusted', 'dismissed')),
	CONSTRAINT "discrepancies_detected_by" CHECK("discrepancies"."detected_by" in ('staff', 'kevin', 'supplier_agent', 'system'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `extraction_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`field_path` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`resolved_by` integer,
	`resolved_value` text,
	FOREIGN KEY (`batch_id`) REFERENCES `batch_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "extraction_flags_kind" CHECK("extraction_flags"."kind" in ('low_confidence', 'out_of_tolerance', 'unit_mismatch', 'unknown_lot', 'correction_detected'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `facilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`near_account_id` text,
	`onboarding_status` text DEFAULT 'grey' NOT NULL,
	CONSTRAINT "facilities_role" CHECK("facilities"."role" in ('hq', 'sister', 'acquired', 'packaging')),
	CONSTRAINT "facilities_onboarding" CHECK("facilities"."onboarding_status" in ('grey', 'onboarding', 'online'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `facilities_code_unique` ON `facilities` (`code`);--> statement-breakpoint
CREATE TABLE `forecasts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`horizon_days` integer NOT NULL,
	`projected_need_base` integer NOT NULL,
	`on_hand_base` integer NOT NULL,
	`on_order_base` integer NOT NULL,
	`shortfall_base` integer NOT NULL,
	`method_note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE TABLE `formula_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`formula_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`qty_per_batch_base` integer NOT NULL,
	`overage_bp` integer DEFAULT 0 NOT NULL,
	`tolerance_bp` integer NOT NULL,
	FOREIGN KEY (`formula_id`) REFERENCES `formulas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `formula_lines_formulaId_materialId_unique` ON `formula_lines` (`formula_id`,`material_id`);--> statement-breakpoint
CREATE TABLE `formulas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`effective_from` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "formulas_status" CHECK("formulas"."status" in ('draft', 'active', 'retired'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `formulas_productId_version_unique` ON `formulas` (`product_id`,`version`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`tier` text NOT NULL,
	`request_sha256` text NOT NULL,
	`response_sha256` text,
	`chat_id` text,
	`signature_verified` integer,
	`fixture_path` text,
	`latency_ms` integer,
	`cost_estimate_usdc` integer,
	`created_at` text NOT NULL,
	CONSTRAINT "llm_calls_task" CHECK("llm_calls"."task" in ('extract_batch_record', 'match_packing_slip', 'explain_ranking', 'draft_message')),
	CONSTRAINT "llm_calls_tier" CHECK("llm_calls"."tier" in ('private_tee', 'external'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `lot_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`seq` integer NOT NULL,
	`lot_id` integer NOT NULL,
	`kind` text NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`qty_delta_base` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`department_id` integer,
	`ref_type` text,
	`ref_id` integer,
	`actor_type` text NOT NULL,
	`actor_id` integer,
	`reason` text,
	`occurred_at` text NOT NULL,
	`recorded_at` text NOT NULL,
	`prev_hash` text NOT NULL,
	`event_hash` text NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lot_events_kind" CHECK("lot_events"."kind" in ('ordered', 'shipped', 'received', 'quarantined', 'released', 'rejected', 'issued', 'returned', 'consumed', 'wasted', 'transfer_out', 'transfer_in', 'count_adjust')),
	CONSTRAINT "lot_events_to_state" CHECK("lot_events"."to_state" in ('on_order', 'en_route', 'received', 'quarantine', 'released', 'in_use', 'consumed', 'wasted', 'rejected')),
	CONSTRAINT "lot_events_ref_type" CHECK("lot_events"."ref_type" in ('po', 'transfer', 'batch', 'count', 'qc')),
	CONSTRAINT "lot_events_actor_type" CHECK("lot_events"."actor_type" in ('staff', 'kevin', 'supplier_agent', 'system'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `lot_events_seq_unique` ON `lot_events` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `lot_events_eventHash_unique` ON `lot_events` (`event_hash`);--> statement-breakpoint
CREATE TABLE `lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_code` text NOT NULL,
	`material_id` integer NOT NULL,
	`vendor_id` integer,
	`vendor_lot_code` text,
	`po_line_id` integer,
	`produced_by_batch_id` integer,
	`expires_on` text,
	`current_facility_id` integer,
	`state` text,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_line_id`) REFERENCES `po_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`produced_by_batch_id`) REFERENCES `batch_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lots_state" CHECK("lots"."state" in ('on_order', 'en_route', 'received', 'quarantine', 'released', 'in_use', 'consumed', 'wasted', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `lots_lotCode_unique` ON `lots` (`lot_code`);--> statement-breakpoint
CREATE TABLE `material_unit_conversions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`unit_code` text NOT NULL,
	`to_base_num` integer NOT NULL,
	`to_base_den` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `material_unit_conversions_materialId_unitCode_unique` ON `material_unit_conversions` (`material_id`,`unit_code`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`dimension` text NOT NULL,
	`base_unit` text NOT NULL,
	`reorder_point_base` integer,
	`reorder_qty_base` integer,
	`default_lead_time_days` integer,
	FOREIGN KEY (`base_unit`) REFERENCES `units`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "materials_category" CHECK("materials"."category" in ('active', 'excipient', 'packaging', 'lab_chemical')),
	CONSTRAINT "materials_dimension" CHECK("materials"."dimension" in ('mass', 'volume', 'count'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_code_unique` ON `materials` (`code`);--> statement-breakpoint
CREATE TABLE `po_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`line_no` integer NOT NULL,
	`material_id` integer NOT NULL,
	`qty_base` integer NOT NULL,
	`unit` text NOT NULL,
	`unit_price_usdc` integer NOT NULL,
	`extended_usdc` integer NOT NULL,
	`quote_id` integer,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `po_lines_poId_lineNo_unique` ON `po_lines` (`po_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`tablet_weight_mg` integer NOT NULL,
	`standard_batch_tablets` integer NOT NULL,
	`expected_yield_bp` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_no` text NOT NULL,
	`vendor_id` integer NOT NULL,
	`ship_to_facility_id` integer NOT NULL,
	`category` text NOT NULL,
	`total_usdc` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`po_hash` text,
	`created_by` text NOT NULL,
	`need_by` text,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ship_to_facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_orders_category" CHECK("purchase_orders"."category" in ('raw_material', 'packaging', 'lab_chemical')),
	CONSTRAINT "purchase_orders_status" CHECK("purchase_orders"."status" in ('draft', 'submitted', 'authorized', 'refused', 'awaiting_approval', 'approved', 'funded', 'received', 'released', 'paid', 'cancelled', 'rejected')),
	CONSTRAINT "purchase_orders_created_by" CHECK("purchase_orders"."created_by" in ('staff', 'kevin', 'supplier_agent', 'system'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_poNo_unique` ON `purchase_orders` (`po_no`);--> statement-breakpoint
CREATE TABLE `qc_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lot_id` integer NOT NULL,
	`po_id` integer,
	`decision` text NOT NULL,
	`decided_by` integer,
	`decided_at` text NOT NULL,
	`chain_tx_id` integer,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chain_tx_id`) REFERENCES `chain_tx`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qc_decisions_decision" CHECK("qc_decisions"."decision" in ('released', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rfq_id` integer NOT NULL,
	`vendor_id` integer NOT NULL,
	`unit_price_usdc` integer NOT NULL,
	`lead_time_days` integer NOT NULL,
	`valid_until` text,
	`status` text NOT NULL,
	`exclusion_reason` text,
	`quote_hash` text,
	`chain_tx_id` integer,
	FOREIGN KEY (`rfq_id`) REFERENCES `rfqs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chain_tx_id`) REFERENCES `chain_tx`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quotes_status" CHECK("quotes"."status" in ('received', 'accepted', 'declined', 'excluded'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`packing_slip_file` text,
	`packing_slip_sha256` text,
	`match_status` text NOT NULL,
	`mismatch_notes` text,
	`received_by` integer,
	`received_at` text NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "receipts_match_status" CHECK("receipts"."match_status" in ('matched', 'mismatch'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `rfqs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rfq_no` text NOT NULL,
	`material_id` integer NOT NULL,
	`qty_base` integer NOT NULL,
	`need_by` text NOT NULL,
	`facility_id` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rfqs_created_by" CHECK("rfqs"."created_by" in ('staff', 'kevin', 'supplier_agent', 'system'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `rfqs_rfqNo_unique` ON `rfqs` (`rfq_no`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`near_account_id` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_role" CHECK("staff"."role" in ('purchaser', 'ops_director', 'receiving', 'qc', 'accounting', 'hq_integration'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transfer_no` text NOT NULL,
	`lot_id` integer NOT NULL,
	`from_facility_id` integer NOT NULL,
	`to_facility_id` integer NOT NULL,
	`qty_shipped_base` integer NOT NULL,
	`qty_received_base` integer,
	`state` text NOT NULL,
	`out_event_id` integer,
	`in_event_id` integer,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`out_event_id`) REFERENCES `lot_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`in_event_id`) REFERENCES `lot_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfers_state" CHECK("transfers"."state" in ('requested', 'in_transit', 'received', 'discrepancy', 'resolved'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_transferNo_unique` ON `transfers` (`transfer_no`);--> statement-breakpoint
CREATE TABLE `units` (
	`code` text PRIMARY KEY NOT NULL,
	`dimension` text NOT NULL,
	`to_base_num` integer NOT NULL,
	`to_base_den` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "units_dimension" CHECK("units"."dimension" in ('mass', 'volume', 'count'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `vendor_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`vendor_item_code` text,
	`approved_source` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_materials_vendorId_materialId_unique` ON `vendor_materials` (`vendor_id`,`material_id`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`near_account_id` text,
	`qualification_status` text NOT NULL,
	`qualified_on` text,
	`requalify_due_on` text,
	`notes` text,
	CONSTRAINT "vendors_qualification" CHECK("vendors"."qualification_status" in ('qualified', 'conditional', 'unqualified', 'suspended'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_code_unique` ON `vendors` (`code`);