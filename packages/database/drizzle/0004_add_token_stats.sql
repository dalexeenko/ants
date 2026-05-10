-- Add actual API-reported token usage columns to sessions table.
-- These persist token stats across session reloads so the UI widget
-- can display cumulative usage without losing data on agent restart.

ALTER TABLE `sessions` ADD COLUMN `prompt_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `completion_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `total_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `cache_creation_input_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `cache_read_input_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `estimated_cost` real DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `request_count` integer DEFAULT 0;
