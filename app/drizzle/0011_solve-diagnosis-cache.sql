ALTER TABLE `blocks` ADD `solve_diagnosis` text;--> statement-breakpoint
DROP TRIGGER IF EXISTS `undo_blocks_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `undo_blocks_delete`;--> statement-breakpoint
CREATE TRIGGER `undo_blocks_update` AFTER UPDATE ON `blocks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'blocks',OLD.`id`,
    'UPDATE `blocks` SET '||'`name`='||quote(OLD.`name`)||','||'`icon_kind`='||quote(OLD.`icon_kind`)||','||'`icon_name`='||quote(OLD.`icon_name`)||','||'`data`='||quote(OLD.`data`)||','||'`solve_diagnosis`='||quote(OLD.`solve_diagnosis`)||','||'`electricity_w`='||quote(OLD.`electricity_w`)||','||'`solve_status`='||quote(OLD.`solve_status`)||','||'`data_fingerprint`='||quote(OLD.`data_fingerprint`)||','||'`sort_order`='||quote(OLD.`sort_order`)||','||'`group_id`='||quote(OLD.`group_id`)||','||'`created_at`='||quote(OLD.`created_at`)||','||'`updated_at`='||quote(OLD.`updated_at`)||','||'`enabled`='||quote(OLD.`enabled`)||','||'`pollution_per_min`='||quote(OLD.`pollution_per_min`)||' WHERE `id`='||OLD.`id`);
END;--> statement-breakpoint
CREATE TRIGGER `undo_blocks_delete` AFTER DELETE ON `blocks` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'blocks',OLD.`id`,
    'INSERT INTO `blocks`(`id`,`name`,`icon_kind`,`icon_name`,`data`,`solve_diagnosis`,`electricity_w`,`solve_status`,`data_fingerprint`,`sort_order`,`group_id`,`created_at`,`updated_at`,`enabled`,`pollution_per_min`) VALUES('||quote(OLD.`id`)||','||quote(OLD.`name`)||','||quote(OLD.`icon_kind`)||','||quote(OLD.`icon_name`)||','||quote(OLD.`data`)||','||quote(OLD.`solve_diagnosis`)||','||quote(OLD.`electricity_w`)||','||quote(OLD.`solve_status`)||','||quote(OLD.`data_fingerprint`)||','||quote(OLD.`sort_order`)||','||quote(OLD.`group_id`)||','||quote(OLD.`created_at`)||','||quote(OLD.`updated_at`)||','||quote(OLD.`enabled`)||','||quote(OLD.`pollution_per_min`)||')');
END;
