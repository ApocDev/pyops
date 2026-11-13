-- Undo triggers for TURD picks: choosing a TURD branch is a user planning
-- decision, so the global Undo must be able to revert it. turd_selections is
-- keyed by master_tech (text), so the inverses key on it and row_id logs the
-- implicit rowid. The game can write these rows outside any undo action (a
-- live sync), so the delete inverse uses INSERT OR REPLACE: undoing a clear
-- after the game restored the row must not hit the primary key and wedge Undo.
CREATE TRIGGER `undo_turd_selections_insert` AFTER INSERT ON `turd_selections` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'turd_selections',NEW.rowid,
    'DELETE FROM `turd_selections` WHERE `master_tech`='||quote(NEW.`master_tech`));
END;--> statement-breakpoint
CREATE TRIGGER `undo_turd_selections_update` AFTER UPDATE ON `turd_selections` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'turd_selections',OLD.rowid,
    'UPDATE `turd_selections` SET '||'`master_tech`='||quote(OLD.`master_tech`)||','||'`sub_tech`='||quote(OLD.`sub_tech`)||','||'`updated_at`='||quote(OLD.`updated_at`)||' WHERE `master_tech`='||quote(NEW.`master_tech`));
END;--> statement-breakpoint
CREATE TRIGGER `undo_turd_selections_delete` AFTER DELETE ON `turd_selections` WHEN EXISTS (SELECT 1 FROM `undo_current`) BEGIN
  INSERT INTO `undo_log`(`action_id`,`tbl`,`row_id`,`stmt`) VALUES ((SELECT `action_id` FROM `undo_current`),'turd_selections',OLD.rowid,
    'INSERT OR REPLACE INTO `turd_selections`(`master_tech`,`sub_tech`,`updated_at`) VALUES('||quote(OLD.`master_tech`)||','||quote(OLD.`sub_tech`)||','||quote(OLD.`updated_at`)||')');
END;
