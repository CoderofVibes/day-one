CREATE TABLE `production_plan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_no` text NOT NULL,
	`product_id` integer NOT NULL,
	`facility_id` integer NOT NULL,
	`planned_for` text NOT NULL,
	`batch_tablets` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "production_plan_status" CHECK("production_plan"."status" in ('planned', 'done', 'cancelled'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `production_plan_batchNo_unique` ON `production_plan` (`batch_no`);