CREATE TABLE `auth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_codes_code_hash_unique` ON `auth_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `group_project_access` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text DEFAULT 'operator' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_project_access_unique` ON `group_project_access` (`group_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`email` text,
	`profile` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_account_unique` ON `oauth_accounts` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `oauth_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`client_id` text NOT NULL,
	`encrypted_client_secret` text NOT NULL,
	`discovery_url` text,
	`config` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`group_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `user_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_group_member_unique` ON `user_group_members` (`user_id`,`group_id`);--> statement-breakpoint
CREATE TABLE `user_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_groups_name_unique` ON `user_groups` (`name`);--> statement-breakpoint
CREATE TABLE `web_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_sessions_token_hash_unique` ON `web_sessions` (`token_hash`);--> statement-breakpoint
ALTER TABLE `approval_rules` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `channel_project_bindings` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `channels` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `file_watchers` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `project_templates` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `created_by` text;--> statement-breakpoint
ALTER TABLE `webhook_endpoints` ADD `created_by` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_id` text,
	`device_name` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_push_subscriptions`("id", "endpoint", "p256dh", "auth", "user_id", "device_name", "created_at", "last_used_at") SELECT "id", "endpoint", "p256dh", "auth", "user_id", "device_name", "created_at", "last_used_at" FROM `push_subscriptions`;--> statement-breakpoint
DROP TABLE `push_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_push_subscriptions` RENAME TO `push_subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);