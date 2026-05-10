CREATE TABLE `compaction_history` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`summary` text NOT NULL,
	`edited_summary` text,
	`original_tokens` integer NOT NULL,
	`compacted_tokens` integer NOT NULL,
	`messages_pruned` integer NOT NULL,
	`from_sequence` integer NOT NULL,
	`to_sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compaction_session_idx` ON `compaction_history` (`session_id`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_tokens` (
	`server_name` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`token_type` text DEFAULT 'Bearer',
	`expires_at` integer,
	`scopes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`tool_results` text,
	`is_compaction_summary` integer DEFAULT false,
	`is_inception` integer DEFAULT false,
	`token_count` integer,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_session_idx` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `messages_sequence_idx` ON `messages` (`session_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`working_directory` text NOT NULL,
	`title` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`system_prompt` text,
	`compaction_enabled` integer DEFAULT true,
	`compaction_model` text,
	`compaction_token_threshold` integer,
	`compaction_inception_count` integer,
	`compaction_working_window_count` integer,
	`token_estimate` integer DEFAULT 0,
	`message_count` integer DEFAULT 0,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
