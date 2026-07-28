CREATE TABLE `item_groups` (
	`name` text PRIMARY KEY NOT NULL,
	`order` text
);
--> statement-breakpoint
CREATE TABLE `item_subgroups` (
	`name` text PRIMARY KEY NOT NULL,
	`group` text,
	`order` text
);
--> statement-breakpoint
ALTER TABLE `fluids` ADD `subgroup` text;