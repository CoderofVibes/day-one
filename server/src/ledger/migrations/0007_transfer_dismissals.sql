CREATE TABLE `transfer_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`from_facility_id` integer NOT NULL,
	`to_facility_id` integer NOT NULL,
	`short_base` integer NOT NULL,
	`dismissed_by` integer,
	`dismissed_at` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dismissed_by`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
