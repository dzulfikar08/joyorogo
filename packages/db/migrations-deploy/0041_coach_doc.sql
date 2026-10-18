CREATE TABLE `coach_doc` (
	`user_id` text PRIMARY KEY NOT NULL,
	`doc` text NOT NULL,
	`rev` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
