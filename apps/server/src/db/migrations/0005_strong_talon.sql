ALTER TABLE `analytics_daily` ADD `total_cache_creation_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_daily` ADD `total_cache_read_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `analytics_events` ADD `cache_creation_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `analytics_events` ADD `cache_read_input_tokens` integer;