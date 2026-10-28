PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_extraction_flags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`field_path` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`resolved_by` integer,
	`resolved_value` text,
	FOREIGN KEY (`batch_id`) REFERENCES `batch_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "extraction_flags_kind" CHECK("__new_extraction_flags"."kind" in ('low_confidence', 'out_of_tolerance', 'unit_mismatch', 'unknown_lot', 'correction_detected', 'yield_variance'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_extraction_flags`("id", "batch_id", "field_path", "kind", "message", "resolved_by", "resolved_value") SELECT "id", "batch_id", "field_path", "kind", "message", "resolved_by", "resolved_value" FROM `extraction_flags`;--> statement-breakpoint
DROP TABLE `extraction_flags`;--> statement-breakpoint
ALTER TABLE `__new_extraction_flags` RENAME TO `extraction_flags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;