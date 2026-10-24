CREATE TABLE `garmin_account` (
	`user_id` text PRIMARY KEY NOT NULL,
	`auth_kind` text DEFAULT 'personal_key' NOT NULL,
	`api_key` text NOT NULL,
	`token` text,
	`token_expires_at` integer,
	`connected_at` integer NOT NULL,
	`last_sync_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
