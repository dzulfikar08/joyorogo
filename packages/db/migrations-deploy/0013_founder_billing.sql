ALTER TABLE `user` ADD `founder_until` integer;
--> statement-breakpoint
CREATE TABLE `payment` (
	`order_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount_idr` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_url` text,
	`founder_until` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payment_user_created_idx` ON `payment` (`user_id`,`created_at`);
