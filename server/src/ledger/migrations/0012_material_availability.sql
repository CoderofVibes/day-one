ALTER TABLE transfers ADD COLUMN expected_usable_on text;
--> statement-breakpoint
ALTER TABLE purchase_orders ADD COLUMN expected_usable_on text;
