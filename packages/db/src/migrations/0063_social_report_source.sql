ALTER TABLE `social_report` ADD `user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `social_report` ADD `source` text DEFAULT 'joyorogo' NOT NULL;