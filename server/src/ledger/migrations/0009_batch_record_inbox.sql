CREATE TABLE `batch_record_inbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_sha256` text NOT NULL,
	`source_file` text NOT NULL,
	`status` text NOT NULL,
	`batch_no` text,
	`facility_id` integer,
	`extraction_json` text,
	`extraction_model` text,
	`summary` text NOT NULL,
	`flags_json` text NOT NULL,
	`error` text,
	`received_at` text NOT NULL,
	`batch_id` integer,
	`outcome` text,
	`confirmed_by` integer,
	`confirmed_at` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batch_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batch_record_inbox_status" CHECK("batch_record_inbox"."status" in ('waiting', 'confirmed', 'set_aside', 'failed'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_record_inbox_fileSha256_unique` ON `batch_record_inbox` (`file_sha256`);