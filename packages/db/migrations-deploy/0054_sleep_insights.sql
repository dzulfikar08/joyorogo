CREATE TABLE `sleep_insight_cache` (
	`user_id` text NOT NULL,
	`factor` text NOT NULL,
	`signature` text NOT NULL,
	`result_json` text NOT NULL,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `factor`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sleep_insight_cache_user_idx` ON `sleep_insight_cache` (`user_id`);--> statement-breakpoint
CREATE TABLE `sleep_insight_pref` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`consent_version` integer DEFAULT 0 NOT NULL,
	`consented_at` integer,
	`free_days_mask` integer DEFAULT 65 NOT NULL,
	`dismissed_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sleep_night` (
	`user_id` text NOT NULL,
	`wake_date` text NOT NULL,
	`onset_ms` integer NOT NULL,
	`wake_ms` integer NOT NULL,
	`tz_offset_min` integer NOT NULL,
	`asleep_s` integer NOT NULL,
	`awake_s` integer NOT NULL,
	`awakenings` integer DEFAULT 0 NOT NULL,
	`has_stages` integer DEFAULT false NOT NULL,
	`deep_s` integer,
	`rem_s` integer,
	`light_s` integer,
	`watch_score` integer,
	`hrv_ms` real,
	`rhr_bpm` integer,
	`naps_json` text DEFAULT '[]' NOT NULL,
	`engine_rev` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	`temp_c_mean` real,
	`temp_c_min` real,
	`temp_c_max` real,
	`rh_pct_mean` real,
	`rh_pct_min` real,
	`rh_pct_max` real,
	`env_samples` integer,
	`env_source` text,
	`pm25_mean` real,
	PRIMARY KEY(`user_id`, `wake_date`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `food_log` ADD `eaten_at` integer;