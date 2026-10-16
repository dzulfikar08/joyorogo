ALTER TABLE `strava_account` ADD `scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `strava_account` ADD `rogo_linked_at` integer;--> statement-breakpoint
ALTER TABLE `strava_account` ADD `fit_linked_at` integer;--> statement-breakpoint
CREATE INDEX `strava_account_athlete_idx` ON `strava_account` (`athlete_id`);--> statement-breakpoint
-- Rows made before this migration came from JoyoRogo's own connect (scope `read,activity:read_all`).
UPDATE `strava_account` SET `scope` = 'read activity:read_all', `rogo_linked_at` = `updated_at`;
