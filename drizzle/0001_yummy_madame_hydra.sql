CREATE TABLE `chronic_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`age` integer NOT NULL,
	`systolic` integer NOT NULL,
	`diastolic` integer NOT NULL,
	`blood_sugar` integer NOT NULL,
	`sugar_timing` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_chronic_records_device_created` ON `chronic_records` (`device_id`,`created_at`);