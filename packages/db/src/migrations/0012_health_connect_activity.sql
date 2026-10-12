CREATE TABLE `daily_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`distance_meters` real DEFAULT 0 NOT NULL,
	`active_calories` real DEFAULT 0 NOT NULL,
	`exercise_minutes` real DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'health_connect' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_activity_user_date_uidx` ON `daily_activity` (`user_id`,`date`);--> statement-breakpoint

ALTER TABLE `sleep_log` ADD `source` text DEFAULT 'manual' NOT NULL;