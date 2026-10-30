-- The integration program's decisions (docs/VISION.md §6.12.3).
CREATE TABLE `journey_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stage` integer NOT NULL,
	`item` text NOT NULL,
	`decision` text NOT NULL,
	`staff_id` integer,
	`note` text,
	`decided_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journey_decisions_decision" CHECK("journey_decisions"."decision" in ('started', 'confirmed', 'approved', 'held'))
) STRICT;
