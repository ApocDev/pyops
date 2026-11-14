ALTER TABLE `beacons` ADD `interference` text;--> statement-breakpoint
ALTER TABLE `crafting_machines` ADD `beacon_interference_exempt` integer DEFAULT false NOT NULL;