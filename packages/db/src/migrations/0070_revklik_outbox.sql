CREATE TABLE `revklik_outbox` (
	`external_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`forwarded_at` integer,
	`last_attempt_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revklik_outbox_pending_idx` ON `revklik_outbox` (`forwarded_at`,`created_at`);