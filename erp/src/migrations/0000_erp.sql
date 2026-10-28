CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`acct_number` text NOT NULL,
	`acct_name` text NOT NULL,
	`acct_type` text NOT NULL,
	`is_inactive` integer DEFAULT false NOT NULL,
	CONSTRAINT "accounts_type" CHECK("accounts"."acct_type" in ('bank', 'otherCurrentAsset', 'accountsPayable', 'otherCurrentLiability', 'equity', 'costOfGoodsSold', 'expense'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_acctNumber_unique` ON `accounts` (`acct_number`);--> statement-breakpoint
CREATE TABLE `approval_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`rule_no` integer NOT NULL,
	`description` text NOT NULL,
	`min_total_usdc` integer,
	`max_total_usdc` integer,
	`vendor_status` text,
	`match_status` text,
	`requires` text NOT NULL,
	`approver_role` text,
	CONSTRAINT "approval_rules_scope" CHECK("approval_rules"."scope" in ('purchaseOrder', 'vendorBill')),
	CONSTRAINT "approval_rules_requires" CHECK("approval_rules"."requires" in ('contractVerdict', 'controller', 'apManager', 'auto', 'reject'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_rules_scope_ruleNo_unique` ON `approval_rules` (`scope`,`rule_no`);--> statement-breakpoint
CREATE TABLE `audit_trail` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`user_id` integer NOT NULL,
	`action` text NOT NULL,
	`record_type` text NOT NULL,
	`record_id` integer,
	`tran_id` text,
	`detail` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_trail_action" CHECK("audit_trail"."action" in ('create', 'update', 'approve', 'reject', 'post', 'login'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `inventory_adjustment_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`adjustment_id` integer NOT NULL,
	`line` integer NOT NULL,
	`item_id` integer NOT NULL,
	`lot_number` text NOT NULL,
	`inventory_status` text NOT NULL,
	`adjust_qty_base` integer NOT NULL,
	`unit_cost_usdc` integer NOT NULL,
	`amount_usdc` integer NOT NULL,
	FOREIGN KEY (`adjustment_id`) REFERENCES `inventory_adjustments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_adjustment_lines_status" CHECK("inventory_adjustment_lines"."inventory_status" in ('quarantine', 'good', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_adjustment_lines_adjustmentId_line_unique` ON `inventory_adjustment_lines` (`adjustment_id`,`line`);--> statement-breakpoint
CREATE TABLE `inventory_adjustments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`external_id` text NOT NULL,
	`location_id` integer NOT NULL,
	`tran_date` text NOT NULL,
	`reason` text NOT NULL,
	`account_id` integer NOT NULL,
	`memo` text,
	`journal_id` integer,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_adjustments_reason" CHECK("inventory_adjustments"."reason" in ('opening', 'production', 'waste', 'count', 'return'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_adjustments_tranId_unique` ON `inventory_adjustments` (`tran_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_adjustments_externalId_unique` ON `inventory_adjustments` (`external_id`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer NOT NULL,
	`source_line` integer NOT NULL,
	`item_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`inventory_status` text NOT NULL,
	`lot_number` text NOT NULL,
	`quantity_delta_base` integer NOT NULL,
	`value_delta_usdc` integer NOT NULL,
	`posted_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_movements_source" CHECK("inventory_movements"."source_type" in ('itemReceipt', 'inventoryAdjustment', 'inventoryTransfer', 'inventoryStatusChange')),
	CONSTRAINT "inventory_movements_status" CHECK("inventory_movements"."inventory_status" in ('quarantine', 'good', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `inventory_status_change_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`change_id` integer NOT NULL,
	`line` integer NOT NULL,
	`item_id` integer NOT NULL,
	`lot_number` text NOT NULL,
	`quantity_base` integer NOT NULL,
	`previous_status` text NOT NULL,
	`revised_status` text NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `inventory_status_changes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_status_change_lines_from" CHECK("inventory_status_change_lines"."previous_status" in ('quarantine', 'good', 'rejected')),
	CONSTRAINT "inventory_status_change_lines_to" CHECK("inventory_status_change_lines"."revised_status" in ('quarantine', 'good', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_status_change_lines_changeId_line_unique` ON `inventory_status_change_lines` (`change_id`,`line`);--> statement-breakpoint
CREATE TABLE `inventory_status_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`external_id` text NOT NULL,
	`location_id` integer NOT NULL,
	`tran_date` text NOT NULL,
	`memo` text,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_status_changes_tranId_unique` ON `inventory_status_changes` (`tran_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_status_changes_externalId_unique` ON `inventory_status_changes` (`external_id`);--> statement-breakpoint
CREATE TABLE `inventory_transfer_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transfer_id` integer NOT NULL,
	`line` integer NOT NULL,
	`item_id` integer NOT NULL,
	`lot_number` text NOT NULL,
	`inventory_status` text NOT NULL,
	`quantity_base` integer NOT NULL,
	`amount_usdc` integer NOT NULL,
	FOREIGN KEY (`transfer_id`) REFERENCES `inventory_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_transfer_lines_status" CHECK("inventory_transfer_lines"."inventory_status" in ('quarantine', 'good', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_transfer_lines_transferId_line_unique` ON `inventory_transfer_lines` (`transfer_id`,`line`);--> statement-breakpoint
CREATE TABLE `inventory_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`external_id` text NOT NULL,
	`from_location_id` integer NOT NULL,
	`to_location_id` integer NOT NULL,
	`tran_date` text NOT NULL,
	`memo` text,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`from_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_transfers_tranId_unique` ON `inventory_transfers` (`tran_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_transfers_externalId_unique` ON `inventory_transfers` (`external_id`);--> statement-breakpoint
CREATE TABLE `item_receipt_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receipt_id` integer NOT NULL,
	`line` integer NOT NULL,
	`po_line_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`quantity_base` integer NOT NULL,
	`rate_usdc` integer NOT NULL,
	`amount_usdc` integer NOT NULL,
	`lot_number` text NOT NULL,
	`inventory_status` text NOT NULL,
	FOREIGN KEY (`receipt_id`) REFERENCES `item_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_receipt_lines_status" CHECK("item_receipt_lines"."inventory_status" in ('quarantine', 'good', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `item_receipt_lines_receiptId_line_unique` ON `item_receipt_lines` (`receipt_id`,`line`);--> statement-breakpoint
CREATE TABLE `item_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`external_id` text NOT NULL,
	`po_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`tran_date` text NOT NULL,
	`memo` text,
	`journal_id` integer,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `item_receipts_tranId_unique` ON `item_receipts` (`tran_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `item_receipts_externalId_unique` ON `item_receipts` (`external_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` text NOT NULL,
	`display_name` text NOT NULL,
	`item_class` text NOT NULL,
	`units_type` text NOT NULL,
	`base_units_per_unit` integer NOT NULL,
	`asset_account_id` integer NOT NULL,
	`cost_usdc` integer DEFAULT 0 NOT NULL,
	`is_inactive` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`asset_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "items_class" CHECK("items"."item_class" in ('rawMaterial', 'packaging', 'labSupply', 'finishedGood'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `items_itemId_unique` ON `items` (`item_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`tran_date` text NOT NULL,
	`memo` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` integer,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_entries_source" CHECK("journal_entries"."source_type" in ('itemReceipt', 'inventoryAdjustment', 'vendorBill', 'vendorPayment', 'manual'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_entries_tranId_unique` ON `journal_entries` (`tran_id`);--> statement-breakpoint
CREATE TABLE `journal_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`journal_id` integer NOT NULL,
	`line` integer NOT NULL,
	`account_id` integer NOT NULL,
	`debit_usdc` integer DEFAULT 0 NOT NULL,
	`credit_usdc` integer DEFAULT 0 NOT NULL,
	`memo` text,
	`location_id` integer,
	`vendor_id` integer,
	FOREIGN KEY (`journal_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_lines_one_side" CHECK(("journal_lines"."debit_usdc" = 0) <> ("journal_lines"."credit_usdc" = 0)),
	CONSTRAINT "journal_lines_positive" CHECK("journal_lines"."debit_usdc" >= 0 and "journal_lines"."credit_usdc" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `journal_lines_journalId_line_unique` ON `journal_lines` (`journal_id`,`line`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`external_id` text NOT NULL,
	`city` text
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_externalId_unique` ON `locations` (`external_id`);--> statement-breakpoint
CREATE TABLE `purchase_order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_id` integer NOT NULL,
	`line` integer NOT NULL,
	`item_id` integer NOT NULL,
	`quantity_base` integer NOT NULL,
	`rate_usdc` integer NOT NULL,
	`amount_usdc` integer NOT NULL,
	`quantity_received_base` integer DEFAULT 0 NOT NULL,
	`quantity_billed_base` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_order_lines_poId_line_unique` ON `purchase_order_lines` (`po_id`,`line`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`external_id` text NOT NULL,
	`vendor_id` integer NOT NULL,
	`location_id` integer NOT NULL,
	`tran_date` text NOT NULL,
	`status` text NOT NULL,
	`approval_status` text NOT NULL,
	`approved_by_user_id` integer,
	`approval_note` text,
	`freight_usdc` integer DEFAULT 0 NOT NULL,
	`total_usdc` integer NOT NULL,
	`memo` text,
	`custbody_dayone_category` text,
	`custbody_dayone_po_hash` text,
	`custbody_contract_verdict` text NOT NULL,
	`custbody_contract_reason` text,
	`custbody_near_funding_tx` text,
	`custbody_near_approval_tx` text,
	`custbody_near_approved_by` text,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_orders_status" CHECK("purchase_orders"."status" in ('pendingApproval', 'pendingReceipt', 'partiallyReceived', 'pendingBilling', 'fullyBilled', 'closed', 'rejected')),
	CONSTRAINT "purchase_orders_approval" CHECK("purchase_orders"."approval_status" in ('pendingApproval', 'approved', 'rejected')),
	CONSTRAINT "purchase_orders_verdict" CHECK("purchase_orders"."custbody_contract_verdict" in ('funded', 'awaitingApproval', 'refused', 'cancelled', 'refunded', 'paid'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_tranId_unique` ON `purchase_orders` (`tran_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_externalId_unique` ON `purchase_orders` (`external_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
) STRICT;
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`token` text,
	`external_id` text,
	`location_id` integer,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "users_role" CHECK("users"."role" in ('administrator', 'controller', 'apManager', 'approver', 'connector', 'viewer', 'system'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_token_unique` ON `users` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_externalId_unique` ON `users` (`external_id`);--> statement-breakpoint
CREATE TABLE `vendor_bill_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` integer NOT NULL,
	`line` integer NOT NULL,
	`po_line_id` integer,
	`item_id` integer NOT NULL,
	`description` text,
	`quantity_base` integer NOT NULL,
	`rate_usdc` integer NOT NULL,
	`amount_usdc` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `vendor_bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_line_id`) REFERENCES `purchase_order_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_bill_lines_billId_line_unique` ON `vendor_bill_lines` (`bill_id`,`line`);--> statement-breakpoint
CREATE TABLE `vendor_bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`normalized_tran_id` text NOT NULL,
	`external_id` text,
	`vendor_id` integer NOT NULL,
	`po_id` integer,
	`tran_date` text NOT NULL,
	`due_date` text,
	`terms` text NOT NULL,
	`freight_usdc` integer DEFAULT 0 NOT NULL,
	`total_usdc` integer NOT NULL,
	`memo` text,
	`match_status` text NOT NULL,
	`match_exceptions_json` text DEFAULT '[]' NOT NULL,
	`approval_status` text NOT NULL,
	`approved_by_user_id` integer,
	`approval_note` text,
	`duplicate_of_id` integer,
	`price_drift_json` text,
	`status` text NOT NULL,
	`amount_paid_usdc` integer DEFAULT 0 NOT NULL,
	`journal_id` integer,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`duplicate_of_id`) REFERENCES `vendor_bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vendor_bills_terms" CHECK("vendor_bills"."terms" in ('net30', 'onQcRelease')),
	CONSTRAINT "vendor_bills_match" CHECK("vendor_bills"."match_status" in ('matched', 'exception', 'duplicate')),
	CONSTRAINT "vendor_bills_approval" CHECK("vendor_bills"."approval_status" in ('pendingApproval', 'approved', 'rejected')),
	CONSTRAINT "vendor_bills_status" CHECK("vendor_bills"."status" in ('open', 'paidInFull', 'rejected'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_bills_externalId_unique` ON `vendor_bills` (`external_id`);--> statement-breakpoint
CREATE TABLE `vendor_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tran_id` text NOT NULL,
	`external_id` text NOT NULL,
	`vendor_id` integer NOT NULL,
	`tran_date` text NOT NULL,
	`account_id` integer NOT NULL,
	`amount_usdc` integer NOT NULL,
	`payment_method` text NOT NULL,
	`applied_bill_id` integer,
	`custbody_near_tx` text,
	`custbody_near_explorer_url` text,
	`memo` text,
	`journal_id` integer,
	`created_by_user_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`applied_bill_id`) REFERENCES `vendor_bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vendor_payments_method" CHECK("vendor_payments"."payment_method" in ('escrowRelease', 'check'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_payments_tranId_unique` ON `vendor_payments` (`tran_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vendor_payments_externalId_unique` ON `vendor_payments` (`external_id`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_id` text NOT NULL,
	`company_name` text NOT NULL,
	`status` text NOT NULL,
	`payout_account` text,
	`payout_verified_at` text,
	`terms` text DEFAULT 'net30' NOT NULL,
	`vb_po_qty_tolerance_bp` integer,
	`vb_po_amt_tolerance_bp` integer,
	`vb_ir_qty_difference_base` integer,
	`comments` text,
	CONSTRAINT "vendors_status" CHECK("vendors"."status" in ('approved', 'onHold', 'blocked')),
	CONSTRAINT "vendors_terms" CHECK("vendors"."terms" in ('net30', 'onQcRelease'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_entityId_unique` ON `vendors` (`entity_id`);