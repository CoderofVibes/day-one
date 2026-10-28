-- Rules drizzle-kit cannot express (docs/ERP.md §3.3).
-- The inventory ledger and the general ledger are append-only: corrections are new postings.
CREATE TRIGGER `inventory_movements_no_update` BEFORE UPDATE ON `inventory_movements`
BEGIN
	SELECT RAISE(ABORT, 'inventory_movements is append-only: post a correcting movement instead');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_movements_no_delete` BEFORE DELETE ON `inventory_movements`
BEGIN
	SELECT RAISE(ABORT, 'inventory_movements is append-only: post a correcting movement instead');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_lines_no_update` BEFORE UPDATE ON `journal_lines`
BEGIN
	SELECT RAISE(ABORT, 'journal_lines is append-only: post a reversing entry instead');
END;
--> statement-breakpoint
CREATE TRIGGER `journal_lines_no_delete` BEFORE DELETE ON `journal_lines`
BEGIN
	SELECT RAISE(ABORT, 'journal_lines is append-only: post a reversing entry instead');
END;
--> statement-breakpoint
-- Quantity and value on hand per item, location and status: the sum of posted movements.
CREATE VIEW `inventory_balances` AS
	SELECT `item_id`, `location_id`, `inventory_status`,
		SUM(`quantity_delta_base`) AS `quantity_on_hand_base`,
		SUM(`value_delta_usdc`) AS `value_usdc`
	FROM `inventory_movements`
	GROUP BY `item_id`, `location_id`, `inventory_status`;
