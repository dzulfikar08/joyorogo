ALTER TABLE `profile` ADD `fasting_pattern` text DEFAULT 'off' NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile` ADD `fasting_window_start` text DEFAULT '12:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile` ADD `fasting_notify` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `profile` ADD `food_budget_idr` integer;
--> statement-breakpoint
ALTER TABLE `profile` ADD `food_budget_period` text DEFAULT 'month' NOT NULL;
--> statement-breakpoint
ALTER TABLE `food_log` ADD `plate_id` text;
--> statement-breakpoint
CREATE INDEX `food_log_plate_idx` ON `food_log` (`plate_id`);
--> statement-breakpoint
CREATE TABLE `workout_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`duration_min` real,
	`note` text,
	`exercise_log_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_log_id`) REFERENCES `exercise_log`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workout_session_user_date_idx` ON `workout_session` (`user_id`,`date`);
--> statement-breakpoint
CREATE TABLE `workout_set` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`reps` integer NOT NULL,
	`weight_kg` real,
	`rpe` real,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workout_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_set_session_idx` ON `workout_set` (`session_id`);
--> statement-breakpoint
CREATE INDEX `workout_set_user_exercise_idx` ON `workout_set` (`user_id`,`exercise_id`);
--> statement-breakpoint
CREATE TABLE `plate` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`name` text NOT NULL,
	`place` text,
	`price_idr` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plate_user_date_idx` ON `plate` (`user_id`,`date`);
--> statement-breakpoint
CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`last_sent_key` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_endpoint_uidx` ON `push_subscription` (`endpoint`);
