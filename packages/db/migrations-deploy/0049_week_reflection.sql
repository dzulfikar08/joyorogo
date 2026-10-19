CREATE TABLE `week_reflection` (
	`user_id` text NOT NULL,
	`week_start` text NOT NULL,
	`locale` text NOT NULL,
	`ai_text` text,
	`ai_model` text,
	`status` text NOT NULL,
	`signature` text NOT NULL,
	`generations` integer DEFAULT 1 NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `week_start`, `locale`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
