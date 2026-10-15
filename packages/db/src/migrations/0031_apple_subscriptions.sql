CREATE TABLE `apple_subscription` (
	`original_transaction_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`environment` text NOT NULL,
	`app_account_token` text,
	`state` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `apple_subscription_user_idx` ON `apple_subscription` (`user_id`);--> statement-breakpoint
CREATE INDEX `apple_subscription_token_idx` ON `apple_subscription` (`app_account_token`);