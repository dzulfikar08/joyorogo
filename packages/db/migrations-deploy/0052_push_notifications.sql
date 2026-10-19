CREATE TABLE `push_device` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`app` text NOT NULL,
	`platform` text NOT NULL,
	`expo_token` text NOT NULL,
	`locale` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_device_token_uidx` ON `push_device` (`expo_token`);--> statement-breakpoint
CREATE INDEX `push_device_user_idx` ON `push_device` (`user_id`);--> statement-breakpoint
CREATE TABLE `push_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`dedupe_key` text,
	`collapse_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`send_after` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`tickets_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_outbox_dedupe_uidx` ON `push_outbox` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `push_outbox_due_idx` ON `push_outbox` (`status`,`send_after`);--> statement-breakpoint
CREATE INDEX `push_outbox_user_cat_idx` ON `push_outbox` (`user_id`,`category`,`created_at`);--> statement-breakpoint
CREATE TABLE `push_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`social` integer DEFAULT true NOT NULL,
	`group_notes` integer DEFAULT true NOT NULL,
	`meal` integer DEFAULT true NOT NULL,
	`weigh` integer DEFAULT true NOT NULL,
	`recap` integer DEFAULT true NOT NULL,
	`quiet_enabled` integer DEFAULT true NOT NULL,
	`quiet_start` text DEFAULT '21:30' NOT NULL,
	`quiet_end` text DEFAULT '06:30' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
