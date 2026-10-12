CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`model` text NOT NULL,
	`scan_type` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`usage_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_user_created_idx` ON `ai_usage` (`user_id`,`created_at`);