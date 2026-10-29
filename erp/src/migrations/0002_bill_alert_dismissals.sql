CREATE TABLE `bill_alert_dismissals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` integer NOT NULL,
	`alert` text NOT NULL,
	`alert_key` text NOT NULL,
	`note` text NOT NULL,
	`user_id` integer NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `vendor_bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_alert_dismissals_alert" CHECK("bill_alert_dismissals"."alert" in ('priceDrift', 'duplicateInvoice'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_alert_dismissals_billId_alertKey_unique` ON `bill_alert_dismissals` (`bill_id`,`alert_key`);
--> statement-breakpoint
-- Dismissals are part of the record trail: never changed, never deleted (docs/ERP.md §3.4).
CREATE TRIGGER `bill_alert_dismissals_no_update` BEFORE UPDATE ON `bill_alert_dismissals`
BEGIN
	SELECT RAISE(ABORT, 'bill_alert_dismissals is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `bill_alert_dismissals_no_delete` BEFORE DELETE ON `bill_alert_dismissals`
BEGIN
	SELECT RAISE(ABORT, 'bill_alert_dismissals is append-only');
END;
