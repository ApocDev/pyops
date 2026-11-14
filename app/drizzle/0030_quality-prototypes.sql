CREATE TABLE `qualities` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`level` integer DEFAULT 0 NOT NULL,
	`next` text,
	`next_probability` real DEFAULT 0 NOT NULL,
	`chain_probability` real DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`module_speed_multiplier` real DEFAULT 1 NOT NULL,
	`module_productivity_multiplier` real DEFAULT 1 NOT NULL,
	`module_consumption_multiplier` real DEFAULT 1 NOT NULL,
	`module_pollution_multiplier` real DEFAULT 1 NOT NULL,
	`module_quality_multiplier` real DEFAULT 1 NOT NULL,
	`crafting_machine_speed_multiplier` real DEFAULT 1 NOT NULL,
	`crafting_machine_energy_usage_multiplier` real DEFAULT 1 NOT NULL,
	`crafting_machine_module_slots_bonus` integer DEFAULT 0 NOT NULL,
	`beacon_power_usage_multiplier` real DEFAULT 1 NOT NULL,
	`beacon_module_slots_bonus` integer DEFAULT 0 NOT NULL,
	`lab_research_speed_multiplier` real DEFAULT 1 NOT NULL,
	`lab_module_slots_bonus` integer DEFAULT 0 NOT NULL,
	`mining_drill_module_slots_bonus` integer DEFAULT 0 NOT NULL,
	`science_pack_drain_multiplier` real DEFAULT 1 NOT NULL,
	`tool_durability_multiplier` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tech_quality_unlocks` (
	`technology` text NOT NULL,
	`quality` text NOT NULL,
	PRIMARY KEY(`technology`, `quality`)
);
--> statement-breakpoint
ALTER TABLE `beacons` ADD `quality_affects_module_slots` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `beacons` ADD `distribution_effectivity_bonus_per_quality_level` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `crafting_machines` ADD `quality_affects_module_slots` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crafting_machines` ADD `quality_affects_energy_usage` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `crafting_machines` ADD `crafting_speed_quality_multiplier` text;--> statement-breakpoint
ALTER TABLE `crafting_machines` ADD `energy_usage_quality_multiplier` text;--> statement-breakpoint
ALTER TABLE `crafting_machines` ADD `module_slots_quality_bonus` text;--> statement-breakpoint
ALTER TABLE `labs` ADD `quality_affects_module_slots` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `labs` ADD `uses_quality_drain_modifier` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `mining_drills` ADD `quality_affects_module_slots` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `modules` ADD `speed_quality_multiplier` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `modules` ADD `productivity_quality_multiplier` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `modules` ADD `consumption_quality_multiplier` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `modules` ADD `pollution_quality_multiplier` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `modules` ADD `quality_quality_multiplier` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `allow_speed` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `allow_consumption` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `allow_pollution` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `can_set_quality` integer DEFAULT false NOT NULL;