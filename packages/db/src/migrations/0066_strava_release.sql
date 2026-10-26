CREATE TABLE `strava_release` (
	`user_id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`reason` text NOT NULL,
	`revoked` integer NOT NULL,
	`released_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
