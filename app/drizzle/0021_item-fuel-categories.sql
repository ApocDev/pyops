ALTER TABLE `items` ADD `fuel_categories` text;--> statement-breakpoint
-- Keep projects imported before this change working without a re-sync.
UPDATE `items` SET `fuel_categories` = json_array(`fuel_category`) WHERE `fuel_category` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `items` DROP COLUMN `fuel_category`;
