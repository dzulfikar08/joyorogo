CREATE TABLE `barcode_product` (
	`code` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`name` text,
	`brand` text,
	`quantity` text,
	`serving_size` real,
	`unit` text,
	`kcal_100` real,
	`protein_100` real,
	`carbs_100` real,
	`fat_100` real,
	`fiber_100` real,
	`image_url` text,
	`fetched_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
