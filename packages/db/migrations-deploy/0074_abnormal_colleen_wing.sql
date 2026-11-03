ALTER TABLE `threads_mention` ADD `kcal` integer;--> statement-breakpoint
ALTER TABLE `threads_mention` DROP COLUMN `kcal_low`;--> statement-breakpoint
ALTER TABLE `threads_mention` DROP COLUMN `kcal_high`;