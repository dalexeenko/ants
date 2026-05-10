-- Remove unused compaction columns from sessions and messages tables.
-- SQLite requires the recreate-table pattern for column removal.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

-- Recreate sessions table without compaction_inception_count and compaction_working_window_count
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`user_id` text,
	`working_directory` text NOT NULL,
	`title` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`system_prompt` text,
	`compaction_enabled` integer DEFAULT true,
	`compaction_model` text,
	`compaction_token_threshold` integer,
	`token_estimate` integer DEFAULT 0,
	`message_count` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sessions` (`id`, `parent_id`, `user_id`, `working_directory`, `title`, `provider`, `model`, `system_prompt`, `compaction_enabled`, `compaction_model`, `compaction_token_threshold`, `token_estimate`, `message_count`, `created_at`, `updated_at`)
SELECT `id`, `parent_id`, `user_id`, `working_directory`, `title`, `provider`, `model`, `system_prompt`, `compaction_enabled`, `compaction_model`, `compaction_token_threshold`, `token_estimate`, `message_count`, `created_at`, `updated_at` FROM `sessions`;
--> statement-breakpoint
DROP TABLE `sessions`;
--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;
--> statement-breakpoint
CREATE INDEX `sessions_parent_idx` ON `sessions` (`parent_id`);
--> statement-breakpoint

-- Recreate messages table without is_inception
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`tool_results` text,
	`is_compaction_summary` integer DEFAULT false,
	`token_count` integer,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages` (`id`, `session_id`, `role`, `content`, `tool_calls`, `tool_results`, `is_compaction_summary`, `token_count`, `sequence`, `created_at`)
SELECT `id`, `session_id`, `role`, `content`, `tool_calls`, `tool_results`, `is_compaction_summary`, `token_count`, `sequence`, `created_at` FROM `messages`;
--> statement-breakpoint
DROP TABLE `messages`;
--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;
--> statement-breakpoint
CREATE INDEX `messages_session_idx` ON `messages` (`session_id`);
--> statement-breakpoint
CREATE INDEX `messages_sequence_idx` ON `messages` (`session_id`, `sequence`);
--> statement-breakpoint

-- Recreate compaction_history without edited_summary
CREATE TABLE `__new_compaction_history` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`summary` text NOT NULL,
	`original_tokens` integer NOT NULL,
	`compacted_tokens` integer NOT NULL,
	`messages_pruned` integer NOT NULL,
	`from_sequence` integer NOT NULL,
	`to_sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_compaction_history` (`id`, `session_id`, `summary`, `original_tokens`, `compacted_tokens`, `messages_pruned`, `from_sequence`, `to_sequence`, `created_at`)
SELECT `id`, `session_id`, `summary`, `original_tokens`, `compacted_tokens`, `messages_pruned`, `from_sequence`, `to_sequence`, `created_at` FROM `compaction_history`;
--> statement-breakpoint
DROP TABLE `compaction_history`;
--> statement-breakpoint
ALTER TABLE `__new_compaction_history` RENAME TO `compaction_history`;
--> statement-breakpoint
CREATE INDEX `compaction_session_idx` ON `compaction_history` (`session_id`);
--> statement-breakpoint

PRAGMA foreign_keys=ON;
