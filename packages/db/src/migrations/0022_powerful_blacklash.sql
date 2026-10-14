CREATE TABLE `scan_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`rating` text NOT NULL,
	`reasons_json` text,
	`note` text,
	`after_retry` integer DEFAULT false NOT NULL,
	`model` text,
	`source` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_feedback_user_created_idx` ON `scan_feedback` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `scan_feedback_created_idx` ON `scan_feedback` (`created_at`);