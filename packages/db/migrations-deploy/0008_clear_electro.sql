CREATE TABLE `scan_correction` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`source` text NOT NULL,
	`meal` text NOT NULL,
	`dish_name` text NOT NULL,
	`ai_kcal` real NOT NULL,
	`saved_kcal` real NOT NULL,
	`ai_grams` real,
	`ai_confidence` real,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_correction_created_idx` ON `scan_correction` (`created_at`);