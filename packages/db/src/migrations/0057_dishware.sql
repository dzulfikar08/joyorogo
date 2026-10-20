CREATE TABLE `dishware` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`diameter_cm` real NOT NULL,
	`width_cm` real,
	`diameter_source` text DEFAULT 'manual' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`photo_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dishware_user_idx` ON `dishware` (`user_id`);