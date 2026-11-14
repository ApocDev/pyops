CREATE TABLE `logistic_robots` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`order` text,
	`speed` real NOT NULL,
	`max_payload_size` integer DEFAULT 1 NOT NULL,
	`max_energy_j` real DEFAULT 0 NOT NULL,
	`energy_per_move_j` real DEFAULT 0 NOT NULL,
	`energy_per_tick_j` real DEFAULT 0 NOT NULL,
	`min_to_charge` real DEFAULT 0.2 NOT NULL,
	`max_to_charge` real DEFAULT 0.95 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roboports` (
	`name` text PRIMARY KEY NOT NULL,
	`display` text,
	`order` text,
	`charging_energy_w` real DEFAULT 0 NOT NULL,
	`logistics_radius` real DEFAULT 0 NOT NULL
);
