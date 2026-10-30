-- The twenty plant areas (docs/VISION.md §6.12.1). The nine old codes map onto the area that
-- replaced them, so a ledger file seeded before this migration keeps its rows.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`code` text NOT NULL,
	`onboarding_status` text DEFAULT 'grey' NOT NULL,
	`onboarded_at` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "departments_code" CHECK("__new_departments"."code" in ('receiving', 'quarantine', 'rm_storage', 'pkg_storage', 'fg_storage', 'shipping', 'rm_staging', 'weigh_cells', 'formulation', 'tableting', 'bulk_hold', 'bottling', 'labeling', 'cartoning', 'palletizing', 'powder_fill', 'qc_lab', 'purchasing', 'planning', 'accounting')),
	CONSTRAINT "departments_onboarding" CHECK("__new_departments"."onboarding_status" in ('grey', 'onboarding', 'online'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_departments`("id", "facility_id", "code", "onboarding_status", "onboarded_at") SELECT "id", "facility_id", CASE "code" WHEN 'warehouse' THEN 'rm_storage' WHEN 'weigh_dispense' THEN 'weigh_cells' WHEN 'blending' THEN 'formulation' WHEN 'compression' THEN 'tableting' WHEN 'packaging' THEN 'bottling' ELSE "code" END, "onboarding_status", "onboarded_at" FROM `departments`;--> statement-breakpoint
DROP TABLE `departments`;--> statement-breakpoint
ALTER TABLE `__new_departments` RENAME TO `departments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `departments_facilityId_code_unique` ON `departments` (`facility_id`,`code`);