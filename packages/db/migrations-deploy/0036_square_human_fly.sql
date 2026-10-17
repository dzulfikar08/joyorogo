CREATE TABLE `post_workout_detail` (
	`post_id` text PRIMARY KEY NOT NULL,
	`hr_json` text,
	`route_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `team_member` ADD `share_fitness` integer DEFAULT false NOT NULL;