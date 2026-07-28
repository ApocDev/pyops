CREATE TABLE `labs` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`researching_speed` real DEFAULT 1 NOT NULL,
	`module_slots` integer DEFAULT 0 NOT NULL,
	`energy_usage_w` real,
	`energy_source` text,
	`pollution_per_min` real,
	`allowed_effects` text,
	`allowed_module_categories` text,
	`inputs` text,
	`hidden` integer DEFAULT false NOT NULL,
	`tile_width` integer,
	`tile_height` integer
);
--> statement-breakpoint
ALTER TABLE `technologies` ADD `unit_time` real;