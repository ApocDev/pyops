CREATE TABLE `block_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`block_id` integer NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`name` text NOT NULL,
	`icon_kind` text,
	`icon_name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`data` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX `block_snapshots_block_idx` ON `block_snapshots` (`block_id`);