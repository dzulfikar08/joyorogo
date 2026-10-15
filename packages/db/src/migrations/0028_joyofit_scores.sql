CREATE TABLE `fitness_score` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`recovery_pct` integer,
	`strain` real,
	`sleep_pct` integer,
	`readiness` text,
	`source` text DEFAULT 'joyofit' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fitness_score_user_date_uidx` ON `fitness_score` (`user_id`,`date`);