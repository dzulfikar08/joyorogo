ALTER TABLE `food_log` ADD `photo_id` text;
--> statement-breakpoint
ALTER TABLE `profile` ADD `keep_photos` integer DEFAULT false NOT NULL;
