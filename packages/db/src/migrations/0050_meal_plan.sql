CREATE TABLE `meal_plan` (
	`user_id` text NOT NULL,
	`start_date` text NOT NULL,
	`seed` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`days_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `start_date`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meal_plan_swap` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`slot` text NOT NULL,
	`from_ref` text NOT NULL,
	`to_ref` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meal_plan_swap_user_date_idx` ON `meal_plan_swap` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `meal_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`allergens` text DEFAULT '[]' NOT NULL,
	`dislikes` text DEFAULT '[]' NOT NULL,
	`budget_friendly` integer DEFAULT false NOT NULL,
	`cook_pref` text DEFAULT 'any' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meal_shopping_check` (
	`user_id` text NOT NULL,
	`start_date` text NOT NULL,
	`item_key` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `start_date`, `item_key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
