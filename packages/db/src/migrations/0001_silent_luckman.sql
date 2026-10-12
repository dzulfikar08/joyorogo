CREATE TABLE `ai_usage` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `date`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
