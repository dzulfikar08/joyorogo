CREATE TABLE `threads_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`threads_user_id` text,
	`username` text,
	`access_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`source` text NOT NULL,
	`refreshed_at` integer,
	`refresh_attempted_at` integer,
	`mentions_since` integer,
	`last_polled_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `threads_mention` (
	`media_id` text PRIMARY KEY NOT NULL,
	`author_username` text NOT NULL,
	`source_media_id` text,
	`status` text DEFAULT 'received' NOT NULL,
	`skip_reason` text,
	`kind` text,
	`dishes_json` text,
	`kcal_low` integer,
	`kcal_high` integer,
	`reply_text` text,
	`mode` text,
	`reply_media_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`scanned_at` integer,
	`reviewed_by` text,
	`reviewed_at` integer,
	`sent_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `threads_mention_author_scanned_idx` ON `threads_mention` (`author_username`,`scanned_at`);--> statement-breakpoint
CREATE INDEX `threads_mention_scanned_idx` ON `threads_mention` (`scanned_at`);--> statement-breakpoint
CREATE INDEX `threads_mention_status_created_idx` ON `threads_mention` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `threads_mention_source_idx` ON `threads_mention` (`source_media_id`);