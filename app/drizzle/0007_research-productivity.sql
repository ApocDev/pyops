CREATE TABLE `tech_productivity_bonuses` (
	`technology` text NOT NULL,
	`recipe` text DEFAULT '' NOT NULL,
	`modifier` real NOT NULL,
	PRIMARY KEY(`technology`, `recipe`)
);
--> statement-breakpoint
CREATE INDEX `tpb_recipe_idx` ON `tech_productivity_bonuses` (`recipe`);--> statement-breakpoint
ALTER TABLE `recipes` ADD `maximum_productivity` real;