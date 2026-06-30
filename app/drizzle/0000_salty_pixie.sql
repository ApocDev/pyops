CREATE TABLE IF NOT EXISTS `beacons` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`distribution_effectivity` real,
	`module_slots` integer DEFAULT 0 NOT NULL,
	`energy_usage_w` real,
	`hidden` integer DEFAULT false NOT NULL,
	`allowed_effects` text,
	`allowed_module_categories` text,
	`profile` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `belts` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`order` text,
	`speed` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `block_flows` (
	`block_id` integer NOT NULL,
	`item` text NOT NULL,
	`kind` text NOT NULL,
	`role` text NOT NULL,
	`rate` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bf_item_role_idx` ON `block_flows` (`item`,`role`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bf_block_idx` ON `block_flows` (`block_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `block_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`sort_order` integer,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `block_machines` (
	`block_id` integer NOT NULL,
	`machine` text NOT NULL,
	`recipe` text NOT NULL,
	`count` real NOT NULL,
	PRIMARY KEY(`block_id`, `machine`, `recipe`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bm_machine_idx` ON `block_machines` (`machine`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`icon_kind` text,
	`icon_name` text,
	`data` text NOT NULL,
	`electricity_w` real,
	`solve_status` text,
	`data_fingerprint` text,
	`sort_order` integer,
	`group_id` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `built_machines` (
	`name` text NOT NULL,
	`recipe` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`name`, `recipe`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`seq` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cm_conv_idx` ON `conversation_messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`model` text,
	`reasoning_effort` text,
	`last_input_tokens` integer,
	`last_output_tokens` integer,
	`last_total_tokens` integer,
	`last_model_id` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cost_analysis` (
	`scope` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`cost` real NOT NULL,
	PRIMARY KEY(`scope`, `name`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `crafting_machines` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`kind` text NOT NULL,
	`crafting_speed` real NOT NULL,
	`module_slots` integer DEFAULT 0 NOT NULL,
	`energy_usage_w` real,
	`energy_source` text,
	`allowed_effects` text,
	`allowed_module_categories` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drill_resource_categories` (
	`drill` text NOT NULL,
	`resource_category` text NOT NULL,
	PRIMARY KEY(`drill`, `resource_category`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fluids` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`order` text,
	`default_temperature` real,
	`max_temperature` real,
	`fuel_value_j` real,
	`heat_capacity_j` real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inserters` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`order` text,
	`rotation_speed` real NOT NULL,
	`extension_speed` real NOT NULL,
	`pickup_x` real NOT NULL,
	`pickup_y` real NOT NULL,
	`drop_x` real NOT NULL,
	`drop_y` real NOT NULL,
	`bulk` integer DEFAULT false NOT NULL,
	`base_stack_bonus` integer DEFAULT 0 NOT NULL,
	`max_belt_stack_size` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `items` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`subgroup` text,
	`order` text,
	`stack_size` integer,
	`weight` real,
	`fuel_value_j` real,
	`fuel_category` text,
	`spoil_result` text,
	`spoil_ticks` integer,
	`burnt_result` text,
	`plant_result` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `items_subgroup_idx` ON `items` (`subgroup`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `loaders` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`order` text,
	`speed` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `machine_categories` (
	`machine` text NOT NULL,
	`category` text NOT NULL,
	PRIMARY KEY(`machine`, `category`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mc_category_idx` ON `machine_categories` (`category`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `machine_fuel_categories` (
	`machine` text NOT NULL,
	`fuel_category` text NOT NULL,
	PRIMARY KEY(`machine`, `fuel_category`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mining_drills` (
	`name` text PRIMARY KEY NOT NULL,
	`mining_speed` real NOT NULL,
	`module_slots` integer DEFAULT 0 NOT NULL,
	`energy_usage_w` real,
	`energy_source` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `module_limitations` (
	`module` text NOT NULL,
	`recipe` text NOT NULL,
	PRIMARY KEY(`module`, `recipe`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `module_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`modules` text NOT NULL,
	`beacons` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `modules` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`category` text,
	`hidden` integer DEFAULT false NOT NULL,
	`tier` integer,
	`eff_speed` real DEFAULT 0 NOT NULL,
	`eff_productivity` real DEFAULT 0 NOT NULL,
	`eff_consumption` real DEFAULT 0 NOT NULL,
	`eff_pollution` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text,
	`body` text,
	`sort_order` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `production_stats` (
	`name` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`produced` real NOT NULL,
	`consumed` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recipe_categories` (
	`name` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recipe_ingredients` (
	`recipe` text NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	`min_temp` real,
	`max_temp` real,
	PRIMARY KEY(`recipe`, `idx`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ing_recipe_idx` ON `recipe_ingredients` (`recipe`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ing_name_idx` ON `recipe_ingredients` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recipe_products` (
	`recipe` text NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`amount` real,
	`amount_min` real,
	`amount_max` real,
	`probability` real DEFAULT 1 NOT NULL,
	`temperature` real,
	`ignored_by_productivity` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`recipe`, `idx`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `prod_recipe_idx` ON `recipe_products` (`recipe`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `prod_name_idx` ON `recipe_products` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `recipes` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`kind` text DEFAULT 'real' NOT NULL,
	`category` text,
	`energy_required` real,
	`enabled` integer DEFAULT true NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`allow_productivity` integer DEFAULT false NOT NULL,
	`allowed_module_categories` text,
	`main_product` text,
	`subgroup` text,
	`order` text,
	`source_entity` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `recipes_category_idx` ON `recipes` (`category`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `recipes_kind_idx` ON `recipes` (`kind`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `task_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`ref_kind` text NOT NULL,
	`ref_name` text NOT NULL,
	`sort_order` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_links_task_idx` ON `task_links` (`task_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_links_ref_idx` ON `task_links` (`ref_kind`,`ref_name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `task_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`sort_order` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_steps_task_idx` ON `task_steps` (`task_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`title` text,
	`body` text,
	`status` text DEFAULT 'open' NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`priority` text,
	`priority_reason` text,
	`priority_at` integer,
	`sort_order` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `task_parent_idx` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tech_ingredients` (
	`technology` text NOT NULL,
	`name` text NOT NULL,
	`amount` real NOT NULL,
	PRIMARY KEY(`technology`, `name`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ti_tech_idx` ON `tech_ingredients` (`technology`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tech_prerequisites` (
	`technology` text NOT NULL,
	`prerequisite` text NOT NULL,
	PRIMARY KEY(`technology`, `prerequisite`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tp_prereq_idx` ON `tech_prerequisites` (`prerequisite`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tech_stack_bonuses` (
	`technology` text NOT NULL,
	`effect` text NOT NULL,
	`modifier` real NOT NULL,
	PRIMARY KEY(`technology`, `effect`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tech_unlocks` (
	`technology` text NOT NULL,
	`recipe` text NOT NULL,
	PRIMARY KEY(`technology`, `recipe`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tu_recipe_idx` ON `tech_unlocks` (`recipe`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `technologies` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`order` text,
	`unit_count` real,
	`enabled` integer DEFAULT true NOT NULL,
	`is_turd` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `turd_replacements` (
	`sub_tech` text NOT NULL,
	`old_recipe` text NOT NULL,
	`new_recipe` text NOT NULL,
	PRIMARY KEY(`sub_tech`, `old_recipe`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tr_old_idx` ON `turd_replacements` (`old_recipe`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `turd_selections` (
	`master_tech` text PRIMARY KEY NOT NULL,
	`sub_tech` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch())
);
