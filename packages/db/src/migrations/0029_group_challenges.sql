CREATE TABLE `team_challenge` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`created_by` text,
	`title` text NOT NULL,
	`goal` text NOT NULL,
	`target` real,
	`duration_days` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `team_challenge_team_end_idx` ON `team_challenge` (`team_id`,`end_date`);--> statement-breakpoint
CREATE TABLE `team_challenge_member` (
	`challenge_id` text NOT NULL,
	`user_id` text NOT NULL,
	`from_date` text NOT NULL,
	`target` real,
	`joined_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`challenge_id`, `user_id`),
	FOREIGN KEY (`challenge_id`) REFERENCES `team_challenge`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_challenge_member_user_idx` ON `team_challenge_member` (`user_id`);