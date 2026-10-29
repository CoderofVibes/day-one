PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chain_tx` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`network` text NOT NULL,
	`mode` text NOT NULL,
	`kind` text NOT NULL,
	`signer_id` text NOT NULL,
	`predecessor_id` text,
	`receiver_id` text NOT NULL,
	`method` text NOT NULL,
	`args_json` text NOT NULL,
	`via_relayer` integer DEFAULT false NOT NULL,
	`token` text,
	`tx_hash` text,
	`status` text NOT NULL,
	`error_message` text,
	`events_json` text,
	`block_height` integer,
	`explorer_url` text,
	`related_type` text,
	`related_id` integer,
	`created_at` text NOT NULL,
	CONSTRAINT "chain_tx_mode" CHECK("__new_chain_tx"."mode" in ('live', 'replay')),
	CONSTRAINT "chain_tx_kind" CHECK("__new_chain_tx"."kind" in ('submit_po', 'approve_po', 'reject_po', 'accept_po', 'mark_shipped', 'fund_escrow', 'confirm_receipt', 'qc_release', 'qc_reject', 'refund', 'anchor', 'quote', 'storage_deposit', 'ft_transfer', 'open_pool', 'join_pool', 'submit_pooled_po')),
	CONSTRAINT "chain_tx_status" CHECK("__new_chain_tx"."status" in ('pending', 'success', 'refused', 'failed'))
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_chain_tx`("id", "network", "mode", "kind", "signer_id", "predecessor_id", "receiver_id", "method", "args_json", "via_relayer", "token", "tx_hash", "status", "error_message", "events_json", "block_height", "explorer_url", "related_type", "related_id", "created_at") SELECT "id", "network", "mode", "kind", "signer_id", "predecessor_id", "receiver_id", "method", "args_json", "via_relayer", "token", "tx_hash", "status", "error_message", "events_json", "block_height", "explorer_url", "related_type", "related_id", "created_at" FROM `chain_tx`;--> statement-breakpoint
DROP TABLE `chain_tx`;--> statement-breakpoint
ALTER TABLE `__new_chain_tx` RENAME TO `chain_tx`;--> statement-breakpoint
PRAGMA foreign_keys=ON;