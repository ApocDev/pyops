CREATE TABLE `undo_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `undo_current` (
	`id` integer PRIMARY KEY NOT NULL,
	`action_id` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `undo_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action_id` integer NOT NULL,
	`tbl` text NOT NULL,
	`row_id` integer NOT NULL,
	`stmt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `undo_log_action_idx` ON `undo_log` (`action_id`);--> statement-breakpoint
-- Undo triggers (#90), per the sqlite.org/undoredo.html pattern: each write to a
-- USER-PLANNING table logs its inverse statement into undo_log, but ONLY while
-- the current-action marker (undo_current) is set by withUndoAction — untracked
-- writes are simply not logged (fail-soft). Reference data, caches
-- (block_flows/block_machines), live-state tables and the undo tables themselves
-- deliberately have NO triggers. Hand-written: drizzle cannot model triggers.
-- If a later migration adds a column to one of these tables, it must DROP and
-- recreate that table's triggers (undo.test.ts enforces coverage).
CREATE TRIGGER `undo_blocks_insert` AFTER INSERT ON `blocks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'blocks',NEW.`id`,
    'DELETE FROM `blocks` WHERE `id`='||NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_blocks_update` AFTER UPDATE ON `blocks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'blocks',OLD.`id`,
    'UPDATE `blocks` SET '||'`name`='||quote(OLD.`name`)||','||'`icon_kind`='||quote(OLD.`icon_kind`)||','||'`icon_name`='||quote(OLD.`icon_name`)||','||'`data`='||quote(OLD.`data`)||','||'`electricity_w`='||quote(OLD.`electricity_w`)||','||'`solve_status`='||quote(OLD.`solve_status`)||','||'`data_fingerprint`='||quote(OLD.`data_fingerprint`)||','||'`sort_order`='||quote(OLD.`sort_order`)||','||'`group_id`='||quote(OLD.`group_id`)||','||'`created_at`='||quote(OLD.`created_at`)||','||'`updated_at`='||quote(OLD.`updated_at`)||','||'`enabled`='||quote(OLD.`enabled`)||','||'`pollution_per_min`='||quote(OLD.`pollution_per_min`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_blocks_delete` AFTER DELETE ON `blocks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'blocks',OLD.`id`,
    'INSERT INTO `blocks`(`id`,`name`,`icon_kind`,`icon_name`,`data`,`electricity_w`,`solve_status`,`data_fingerprint`,`sort_order`,`group_id`,`created_at`,`updated_at`,`enabled`,`pollution_per_min`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`name`)||','||quote(OLD.`icon_kind`)||','||quote(OLD.`icon_name`)||','||quote(OLD.`data`)||','||quote(OLD.`electricity_w`)||','||quote(OLD.`solve_status`)||','||quote(OLD.`data_fingerprint`)||','||quote(OLD.`sort_order`)||','||quote(OLD.`group_id`)||','||quote(OLD.`created_at`)||','||quote(OLD.`updated_at`)||','||quote(OLD.`enabled`)||','||quote(OLD.`pollution_per_min`)||')');
END;--> statement-breakpoint
CREATE TRIGGER `undo_block_groups_insert` AFTER INSERT ON `block_groups` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'block_groups',NEW.`id`,
    'DELETE FROM `block_groups` WHERE `id`='||NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_block_groups_update` AFTER UPDATE ON `block_groups` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'block_groups',OLD.`id`,
    'UPDATE `block_groups` SET '||'`name`='||quote(OLD.`name`)||','||'`parent_id`='||quote(OLD.`parent_id`)||','||'`sort_order`='||quote(OLD.`sort_order`)||','||'`created_at`='||quote(OLD.`created_at`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_block_groups_delete` AFTER DELETE ON `block_groups` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'block_groups',OLD.`id`,
    'INSERT INTO `block_groups`(`id`,`name`,`parent_id`,`sort_order`,`created_at`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`name`)||','||quote(OLD.`parent_id`)||','||quote(OLD.`sort_order`)||','||quote(OLD.`created_at`)||')');
END;--> statement-breakpoint
CREATE TRIGGER `undo_module_presets_insert` AFTER INSERT ON `module_presets` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'module_presets',NEW.`id`,
    'DELETE FROM `module_presets` WHERE `id`='||NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_module_presets_update` AFTER UPDATE ON `module_presets` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'module_presets',OLD.`id`,
    'UPDATE `module_presets` SET '||'`name`='||quote(OLD.`name`)||','||'`modules`='||quote(OLD.`modules`)||','||'`beacons`='||quote(OLD.`beacons`)||','||'`created_at`='||quote(OLD.`created_at`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_module_presets_delete` AFTER DELETE ON `module_presets` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'module_presets',OLD.`id`,
    'INSERT INTO `module_presets`(`id`,`name`,`modules`,`beacons`,`created_at`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`name`)||','||quote(OLD.`modules`)||','||quote(OLD.`beacons`)||','||quote(OLD.`created_at`)||')');
END;--> statement-breakpoint
CREATE TRIGGER `undo_tasks_insert` AFTER INSERT ON `tasks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'tasks',NEW.`id`,
    'DELETE FROM `tasks` WHERE `id`='||NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_tasks_update` AFTER UPDATE ON `tasks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'tasks',OLD.`id`,
    'UPDATE `tasks` SET '||'`parent_id`='||quote(OLD.`parent_id`)||','||'`title`='||quote(OLD.`title`)||','||'`body`='||quote(OLD.`body`)||','||'`status`='||quote(OLD.`status`)||','||'`done`='||quote(OLD.`done`)||','||'`priority`='||quote(OLD.`priority`)||','||'`priority_reason`='||quote(OLD.`priority_reason`)||','||'`priority_at`='||quote(OLD.`priority_at`)||','||'`sort_order`='||quote(OLD.`sort_order`)||','||'`created_at`='||quote(OLD.`created_at`)||','||'`updated_at`='||quote(OLD.`updated_at`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_tasks_delete` AFTER DELETE ON `tasks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'tasks',OLD.`id`,
    'INSERT INTO `tasks`(`id`,`parent_id`,`title`,`body`,`status`,`done`,`priority`,`priority_reason`,`priority_at`,`sort_order`,`created_at`,`updated_at`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`parent_id`)||','||quote(OLD.`title`)||','||quote(OLD.`body`)||','||quote(OLD.`status`)||','||quote(OLD.`done`)||','||quote(OLD.`priority`)||','||quote(OLD.`priority_reason`)||','||quote(OLD.`priority_at`)||','||quote(OLD.`sort_order`)||','||quote(OLD.`created_at`)||','||quote(OLD.`updated_at`)||')');
END;--> statement-breakpoint
CREATE TRIGGER `undo_task_steps_insert` AFTER INSERT ON `task_steps` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'task_steps',NEW.`id`,
    'DELETE FROM `task_steps` WHERE `id`='||NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_task_steps_update` AFTER UPDATE ON `task_steps` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'task_steps',OLD.`id`,
    'UPDATE `task_steps` SET '||'`task_id`='||quote(OLD.`task_id`)||','||'`text`='||quote(OLD.`text`)||','||'`done`='||quote(OLD.`done`)||','||'`sort_order`='||quote(OLD.`sort_order`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_task_steps_delete` AFTER DELETE ON `task_steps` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'task_steps',OLD.`id`,
    'INSERT INTO `task_steps`(`id`,`task_id`,`text`,`done`,`sort_order`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`task_id`)||','||quote(OLD.`text`)||','||quote(OLD.`done`)||','||quote(OLD.`sort_order`)||')');
END;--> statement-breakpoint
CREATE TRIGGER `undo_task_links_insert` AFTER INSERT ON `task_links` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'task_links',NEW.`id`,
    'DELETE FROM `task_links` WHERE `id`='||NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_task_links_update` AFTER UPDATE ON `task_links` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'task_links',OLD.`id`,
    'UPDATE `task_links` SET '||'`task_id`='||quote(OLD.`task_id`)||','||'`ref_kind`='||quote(OLD.`ref_kind`)||','||'`ref_name`='||quote(OLD.`ref_name`)||','||'`sort_order`='||quote(OLD.`sort_order`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_task_links_delete` AFTER DELETE ON `task_links` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'task_links',OLD.`id`,
    'INSERT INTO `task_links`(`id`,`task_id`,`ref_kind`,`ref_name`,`sort_order`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`task_id`)||','||quote(OLD.`ref_kind`)||','||quote(OLD.`ref_name`)||','||quote(OLD.`sort_order`)||')');
END;--> statement-breakpoint
CREATE TRIGGER `undo_notes_insert` AFTER INSERT ON `notes` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'notes',NEW.`id`,
    'DELETE FROM `notes` WHERE `id`='||NEW.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_notes_update` AFTER UPDATE ON `notes` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'notes',OLD.`id`,
    'UPDATE `notes` SET '||'`title`='||quote(OLD.`title`)||','||'`body`='||quote(OLD.`body`)||','||'`sort_order`='||quote(OLD.`sort_order`)||','||'`created_at`='||quote(OLD.`created_at`)||','||'`updated_at`='||quote(OLD.`updated_at`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_notes_delete` AFTER DELETE ON `notes` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'notes',OLD.`id`,
    'INSERT INTO `notes`(`id`,`title`,`body`,`sort_order`,`created_at`,`updated_at`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`title`)||','||quote(OLD.`body`)||','||quote(OLD.`sort_order`)||','||quote(OLD.`created_at`)||','||quote(OLD.`updated_at`)||')');
END;
