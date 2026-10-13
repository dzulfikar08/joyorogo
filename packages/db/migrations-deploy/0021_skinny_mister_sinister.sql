CREATE TABLE `var_scan` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`photo_id` text NOT NULL,
	`verdict` text NOT NULL,
	`confidence` real,
	`note` text,
	`waist_cm` real,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `var_scan_user_created_idx` ON `var_scan` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `team_member` ADD `share_var` integer DEFAULT false NOT NULL;