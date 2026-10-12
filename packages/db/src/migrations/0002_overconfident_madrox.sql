ALTER TABLE `profile` ADD `share_code` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `share_enabled` integer DEFAULT false NOT NULL;