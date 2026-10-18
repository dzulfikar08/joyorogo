CREATE TABLE `sync_record` (
	`user_id` text NOT NULL,
	`ns` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`json` text NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`rank` integer DEFAULT 0 NOT NULL,
	`server_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `ns`, `kind`, `id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_record_pull_idx` ON `sync_record` (`user_id`,`ns`,`server_at`,`kind`,`id`);