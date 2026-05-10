CREATE TABLE `project_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plugin_id`) REFERENCES `server_plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_plugin_unique` ON `project_plugins` (`project_id`,`plugin_id`);--> statement-breakpoint
CREATE TABLE `server_plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`package_name` text NOT NULL,
	`package_spec` text NOT NULL,
	`version` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_plugins_package_name_unique` ON `server_plugins` (`package_name`);