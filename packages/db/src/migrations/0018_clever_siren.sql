CREATE TABLE `workout_custom_exercise` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`muscle` text NOT NULL,
	`equipment` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_custom_exercise_user_idx` ON `workout_custom_exercise` (`user_id`);--> statement-breakpoint
CREATE TABLE `workout_routine` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`exercises` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_routine_user_idx` ON `workout_routine` (`user_id`,`updated_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workout_set` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`reps` integer,
	`weight_kg` real,
	`duration_sec` integer,
	`rpe` real,
	`set_type` text DEFAULT 'normal' NOT NULL,
	`note` text,
	`superset_group` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workout_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- drizzle-kit lists the new columns in the copy; they do not exist on the old
-- table, so copy only what was there and let defaults fill set_type/'normal',
-- duration_sec/note/superset_group (null).
INSERT INTO `__new_workout_set`("id", "session_id", "user_id", "exercise_id", "position", "reps", "weight_kg", "rpe", "created_at") SELECT "id", "session_id", "user_id", "exercise_id", "position", "reps", "weight_kg", "rpe", "created_at" FROM `workout_set`;--> statement-breakpoint
DROP TABLE `workout_set`;--> statement-breakpoint
ALTER TABLE `__new_workout_set` RENAME TO `workout_set`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workout_set_session_idx` ON `workout_set` (`session_id`);--> statement-breakpoint
CREATE INDEX `workout_set_user_exercise_idx` ON `workout_set` (`user_id`,`exercise_id`);--> statement-breakpoint
ALTER TABLE `workout_session` ADD `started_at` integer;