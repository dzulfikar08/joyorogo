CREATE TABLE `coros_account` (
	`user_id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`connected_at` integer NOT NULL,
	`last_sync_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `coros_auth_state` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`return_to` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coros_auth_state_user_idx` ON `coros_auth_state` (`user_id`);