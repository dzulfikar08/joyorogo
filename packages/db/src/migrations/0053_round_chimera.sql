ALTER TABLE `weight_log` ADD `body_fat_pct` real;--> statement-breakpoint
ALTER TABLE `weight_log` ADD `muscle_pct` real;--> statement-breakpoint
ALTER TABLE `weight_log` ADD `water_pct` real;--> statement-breakpoint
ALTER TABLE `weight_log` ADD `bone_kg` real;--> statement-breakpoint
ALTER TABLE `weight_log` ADD `visceral_fat` real;--> statement-breakpoint
ALTER TABLE `weight_log` ADD `bmr_kcal` real;--> statement-breakpoint
ALTER TABLE `weight_log` ADD `protein_pct` real;--> statement-breakpoint
ALTER TABLE `weight_log` ADD `source` text DEFAULT 'manual' NOT NULL;