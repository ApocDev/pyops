CREATE TABLE `beacon_upkeep` (
	`beacon` text NOT NULL,
	`module` text NOT NULL,
	`item` text NOT NULL,
	`kind` text DEFAULT 'item' NOT NULL,
	`per_sec` real NOT NULL,
	PRIMARY KEY(`beacon`, `module`)
);
