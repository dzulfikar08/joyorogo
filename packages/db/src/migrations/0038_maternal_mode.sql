ALTER TABLE `profile` ADD `maternal_mode` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `profile` ADD `pregnancy_lmp` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `pregnancy_date_kind` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `pre_pregnancy_weight_kg` real;--> statement-breakpoint
ALTER TABLE `profile` ADD `pregnancy_twins` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profile` ADD `breastfeeding_type` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `baby_birth_date` text;--> statement-breakpoint
ALTER TABLE `profile` ADD `maternal_conditions` text;