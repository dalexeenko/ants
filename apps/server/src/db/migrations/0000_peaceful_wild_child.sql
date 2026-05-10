CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`from_project_id` text NOT NULL,
	`to_project_id` text NOT NULL,
	`type` text NOT NULL,
	`action` text NOT NULL,
	`subject` text,
	`content` text NOT NULL,
	`metadata` text,
	`parent_message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`response_content` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`from_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_message_id`) REFERENCES `agent_messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `analytics_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`date` text NOT NULL,
	`total_prompts` integer DEFAULT 0 NOT NULL,
	`total_tool_calls` integer DEFAULT 0 NOT NULL,
	`total_task_runs` integer DEFAULT 0 NOT NULL,
	`successful_task_runs` integer DEFAULT 0 NOT NULL,
	`failed_task_runs` integer DEFAULT 0 NOT NULL,
	`total_prompt_tokens` integer DEFAULT 0 NOT NULL,
	`total_completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` integer DEFAULT 0 NOT NULL,
	`total_errors` integer DEFAULT 0 NOT NULL,
	`avg_response_ms` integer,
	`unique_sessions` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_daily_project_date` ON `analytics_daily` (`project_id`,`date`);--> statement-breakpoint
CREATE TABLE `analytics_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`session_id` text,
	`event_type` text NOT NULL,
	`provider` text,
	`model` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_usd` integer,
	`duration_ms` integer,
	`tool_name` text,
	`success` integer,
	`error_message` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`encrypted_values` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_provider_id_unique` ON `api_keys` (`provider_id`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`rule_id` text,
	`tool_name` text NOT NULL,
	`tool_args` text NOT NULL,
	`context` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_by` text,
	`review_note` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `approval_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `approval_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`description` text,
	`tool_pattern` text NOT NULL,
	`arg_patterns` text,
	`action` text DEFAULT 'require_approval' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`username` text,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`details` text,
	`ip_address` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `channel_message_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`binding_id` text,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`platform_ref` text,
	`session_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`binding_id`) REFERENCES `channel_project_bindings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `channel_project_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`project_id` text NOT NULL,
	`trigger_config` text NOT NULL,
	`response_config` text,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channel_thread_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`project_id` text NOT NULL,
	`platform_thread_id` text NOT NULL,
	`session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_thread_unique` ON `channel_thread_sessions` (`channel_id`,`platform_thread_id`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`credentials` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `custom_env_vars` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`env_var` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_env_vars_env_var_unique` ON `custom_env_vars` (`env_var`);--> statement-breakpoint
CREATE TABLE `file_watchers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`watch_path` text NOT NULL,
	`patterns` text,
	`ignore_patterns` text,
	`events` text DEFAULT '["change"]' NOT NULL,
	`debounce_ms` integer DEFAULT 1000 NOT NULL,
	`prompt_template` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`project_id` text,
	`event_type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_prefs_unique` ON `notification_preferences` (`subscription_id`,`project_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `project_access` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text DEFAULT 'operator' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_access_unique` ON `project_access` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `project_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`category` text,
	`agent_config` text,
	`skills` text,
	`mcp_servers` text,
	`tools` text,
	`prompt_template` text,
	`setup_commands` text,
	`file_templates` text,
	`source` text DEFAULT 'local' NOT NULL,
	`hub_template_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_templates_slug_unique` ON `project_templates` (`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`working_directory` text NOT NULL,
	`auto_start` integer DEFAULT true NOT NULL,
	`agent_config` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_id` text,
	`device_name` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text,
	`webhook_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_tokens_token_hash_unique` ON `user_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`email` text,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'operator' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`source` text NOT NULL,
	`event_type` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`session_id` text,
	`prompt` text,
	`response_content` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`secret` text,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text NOT NULL,
	`event_filter` text,
	`prompt_template` text NOT NULL,
	`session_mode` text DEFAULT 'newEachRun' NOT NULL,
	`dedicated_session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_endpoints_slug` ON `webhook_endpoints` (`project_id`,`slug`);