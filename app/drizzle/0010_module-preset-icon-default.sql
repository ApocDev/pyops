ALTER TABLE `module_presets` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `module_presets` ADD `is_default` integer DEFAULT false NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS `undo_module_presets_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `undo_module_presets_delete`;--> statement-breakpoint
CREATE TRIGGER `undo_module_presets_update` AFTER UPDATE ON `module_presets` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'module_presets',OLD.`id`,
    'UPDATE `module_presets` SET '||'`name`='||quote(OLD.`name`)||','||'`modules`='||quote(OLD.`modules`)||','||'`beacons`='||quote(OLD.`beacons`)||','||'`icon`='||quote(OLD.`icon`)||','||'`is_default`='||quote(OLD.`is_default`)||','||'`created_at`='||quote(OLD.`created_at`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_module_presets_delete` AFTER DELETE ON `module_presets` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'module_presets',OLD.`id`,
    'INSERT INTO `module_presets`(`id`,`name`,`modules`,`beacons`,`icon`,`is_default`,`created_at`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`name`)||','||quote(OLD.`modules`)||','||quote(OLD.`beacons`)||','||quote(OLD.`icon`)||','||quote(OLD.`is_default`)||','||quote(OLD.`created_at`)||')');
END;
