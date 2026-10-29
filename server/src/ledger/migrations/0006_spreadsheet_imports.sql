CREATE TABLE `spreadsheet_imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`sheet` text NOT NULL,
	`as_of` text NOT NULL,
	`rows_found` integer NOT NULL,
	`lots_posted` integer NOT NULL,
	`review_json` text NOT NULL,
	`resolutions_json` text NOT NULL,
	`posted_by` integer,
	`posted_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`posted_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `spreadsheet_imports_file` ON `spreadsheet_imports` (`facility_id`,`file_sha256`);