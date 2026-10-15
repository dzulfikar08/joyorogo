CREATE TABLE `saved_food` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`place` text,
	`price_idr` integer,
	`kcal` real NOT NULL,
	`items_json` text NOT NULL,
	`key` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_food_user_key_uidx` ON `saved_food` (`user_id`,`key`);--> statement-breakpoint
CREATE INDEX `saved_food_user_idx` ON `saved_food` (`user_id`);