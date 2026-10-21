ALTER TABLE `payment` ADD `charged_currency` text;--> statement-breakpoint
ALTER TABLE `payment` ADD `charged_amount_minor` integer;--> statement-breakpoint
ALTER TABLE `payment` ADD `charged_tax_minor` integer;--> statement-breakpoint
ALTER TABLE `payment` ADD `fx_rate_idr` real;--> statement-breakpoint
ALTER TABLE `payment` ADD `fx_source` text;--> statement-breakpoint
UPDATE `payment` SET `charged_currency` = 'USD', `charged_amount_minor` = `amount_usd_cents` WHERE `amount_usd_cents` IS NOT NULL;
