-- Ledger rules drizzle-kit cannot express (DATA_MODEL §4).
-- lot_events is append-only: corrections are compensating events, never edits.
CREATE TRIGGER `lot_events_no_update` BEFORE UPDATE ON `lot_events`
BEGIN
	SELECT RAISE(ABORT, 'lot_events is append-only: record a compensating event instead');
END;
--> statement-breakpoint
CREATE TRIGGER `lot_events_no_delete` BEFORE DELETE ON `lot_events`
BEGIN
	SELECT RAISE(ABORT, 'lot_events is append-only: record a compensating event instead');
END;
--> statement-breakpoint
-- On-hand quantity per lot and facility is the sum of event deltas.
CREATE VIEW `lot_balances` AS
	SELECT `lot_id`, `facility_id`, SUM(`qty_delta_base`) AS `on_hand_base`
	FROM `lot_events`
	GROUP BY `lot_id`, `facility_id`;
