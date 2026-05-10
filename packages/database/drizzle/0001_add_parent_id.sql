ALTER TABLE `sessions` ADD COLUMN `parent_id` text;
--> statement-breakpoint
CREATE INDEX `sessions_parent_idx` ON `sessions` (`parent_id`);
