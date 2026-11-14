ALTER TABLE `modules` ADD `eff_quality` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `allow_quality` integer DEFAULT true NOT NULL;