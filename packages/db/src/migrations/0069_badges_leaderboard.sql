CREATE TABLE `badge_award` (
	`user_id` text NOT NULL,
	`badge_id` text NOT NULL,
	`tier` integer DEFAULT 1 NOT NULL,
	`awarded_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `badge_id`, `tier`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `badge_award_user_idx` ON `badge_award` (`user_id`,`awarded_at`);--> statement-breakpoint
CREATE TABLE `leaderboard_pref` (
	`user_id` text PRIMARY KEY NOT NULL,
	`opt_in` integer DEFAULT false NOT NULL,
	`display_mode` text DEFAULT 'anonim' NOT NULL,
	`alias` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_pref_alias_uidx` ON `leaderboard_pref` (`alias`) WHERE "leaderboard_pref"."alias" is not null;--> statement-breakpoint
CREATE INDEX `leaderboard_pref_opt_idx` ON `leaderboard_pref` (`opt_in`);--> statement-breakpoint
CREATE TABLE `leaderboard_week` (
	`week_start` text NOT NULL,
	`user_id` text NOT NULL,
	`days_logged` integer NOT NULL,
	`protein_hit_days` integer NOT NULL,
	`workout_days` integer NOT NULL,
	`streak_end` integer NOT NULL,
	`days_mask` integer DEFAULT 0 NOT NULL,
	`rank_global` integer,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`week_start`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `leaderboard_week_rank_idx` ON `leaderboard_week` (`week_start`,`rank_global`);--> statement-breakpoint
CREATE INDEX `leaderboard_week_user_idx` ON `leaderboard_week` (`user_id`);--> statement-breakpoint
CREATE INDEX `scan_correction_user_idx` ON `scan_correction` (`user_id`,`created_at`);