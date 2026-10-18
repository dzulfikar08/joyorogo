CREATE TABLE `strength_record` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`server_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `strength_record_pull_idx` ON `strength_record` (`user_id`,`server_at`,`kind`,`id`);