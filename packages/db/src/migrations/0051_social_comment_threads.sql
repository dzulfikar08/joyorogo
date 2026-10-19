ALTER TABLE `post_comment` ADD `parent_id` text REFERENCES post_comment(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `post_comment` ADD `reply_to_user_id` text REFERENCES user(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `post_comment` ADD `attachment_json` text;--> statement-breakpoint
ALTER TABLE `post_comment` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `post_comment_parent_created_idx` ON `post_comment` (`parent_id`,`created_at`);
