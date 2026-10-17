CREATE TABLE `barcode_contribution` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`brand` text,
	`quantity` text,
	`serving_size` real,
	`unit` text NOT NULL,
	`kcal_100` real NOT NULL,
	`protein_100` real,
	`carbs_100` real,
	`fat_100` real,
	`fiber_100` real,
	`sugar_100` real,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barcode_contribution_code_user_uidx` ON `barcode_contribution` (`code`,`user_id`);--> statement-breakpoint
CREATE INDEX `barcode_contribution_user_updated_idx` ON `barcode_contribution` (`user_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `barcode_product` ADD `source` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `barcode_product` ADD `contributors` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `barcode_product` ADD `sources_checked` text;--> statement-breakpoint
ALTER TABLE `barcode_product` ADD `sugar_100` real;
--> statement-breakpoint
UPDATE `barcode_product` SET `sources_checked` = 'off' WHERE `status` = 'not_found';