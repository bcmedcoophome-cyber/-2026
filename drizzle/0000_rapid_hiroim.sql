CREATE TABLE `cognitive_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`score` integer NOT NULL,
	`risk_key` text NOT NULL,
	`answers_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_cognitive_checks_device_created` ON `cognitive_checks` (`device_id`,`created_at`);