PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recipe_products` (
	`recipe` text NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`amount` real,
	`amount_min` real,
	`amount_max` real,
	`probability` real DEFAULT 1 NOT NULL,
	`temperature` real,
	`ignored_by_productivity` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`recipe`, `idx`)
);
--> statement-breakpoint
INSERT INTO `__new_recipe_products`("recipe", "idx", "kind", "name", "amount", "amount_min", "amount_max", "probability", "temperature", "ignored_by_productivity") SELECT "recipe", "idx", "kind", "name", "amount", "amount_min", "amount_max", "probability", "temperature",
	-- ignored_by_productivity was a 0/1 flag; it is now an AMOUNT (Factorio 2.0
	-- semantics). Map the legacy 1 to the product's (average) amount — i.e. keep
	-- the old fully-ignored behavior — until the next data sync re-imports the
	-- real per-product values from the dump.
	CASE WHEN "ignored_by_productivity" = 1
		THEN coalesce("amount", ("amount_min" + "amount_max") / 2.0, 0)
		ELSE "ignored_by_productivity" END
FROM `recipe_products`;--> statement-breakpoint
DROP TABLE `recipe_products`;--> statement-breakpoint
ALTER TABLE `__new_recipe_products` RENAME TO `recipe_products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `prod_recipe_idx` ON `recipe_products` (`recipe`);--> statement-breakpoint
CREATE INDEX `prod_name_idx` ON `recipe_products` (`name`);