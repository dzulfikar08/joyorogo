CREATE INDEX `user_created_idx` ON `user` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_created_idx` ON `payment` (`created_at`,`order_id`);--> statement-breakpoint
CREATE INDEX `food_log_user_created_idx` ON `food_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `scan_feedback_rating_created_idx` ON `scan_feedback` (`rating`,`created_at`);--> statement-breakpoint
CREATE INDEX `social_report_created_idx` ON `social_report` (`created_at`,`id`);