ALTER TABLE `items` ADD `type` text;--> statement-breakpoint
ALTER TABLE `qualities` ADD `default_multiplier` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `qualities` ADD `science_capacity_multiplier` real DEFAULT 1 NOT NULL;