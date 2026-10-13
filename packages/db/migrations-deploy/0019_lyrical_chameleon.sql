CREATE TABLE `post` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`food_log_id` text,
	`exercise_log_id` text,
	`workout_session_id` text,
	`weight_log_id` text,
	`title` text NOT NULL,
	`kcal` real,
	`duration_min` real,
	`photo_id` text,
	`scan_id` text,
	`macro_json` text,
	`stats_json` text,
	`caption` text,
	`visibility` text DEFAULT 'grup' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_user_created_idx` ON `post` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `post_visibility_created_idx` ON `post` (`visibility`,`created_at`);--> statement-breakpoint
CREATE TABLE `post_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_comment_post_created_idx` ON `post_comment` (`post_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `post_kudos` (
	`post_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `post_kudos_user_idx` ON `post_kudos` (`user_id`);--> statement-breakpoint
CREATE TABLE `social_block` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`),
	FOREIGN KEY (`blocker_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `social_follow` (
	`follower_id` text NOT NULL,
	`following_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`follower_id`, `following_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`following_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_follow_following_idx` ON `social_follow` (`following_id`);--> statement-breakpoint
CREATE TABLE `social_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`post_id` text,
	`excerpt` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_notification_user_created_idx` ON `social_notification` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `social_notification_user_read_idx` ON `social_notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `social_report` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text NOT NULL,
	`post_id` text,
	`comment_id` text,
	`reason` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `post_comment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_report_resolved_idx` ON `social_report` (`resolved_at`,`created_at`);--> statement-breakpoint
ALTER TABLE `profile` ADD `handle` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `public_profile` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `profile` ADD `default_visibility` text DEFAULT 'grup' NOT NULL;--> statement-breakpoint
-- Backfill: existing users get an unguessable placeholder handle; they can
-- change it later in Profil. Runs before the unique index is created.
UPDATE `profile` SET `handle` = 'jr-' || lower(hex(randomblob(4))) WHERE `handle` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `profile_handle_uidx` ON `profile` (`handle`);