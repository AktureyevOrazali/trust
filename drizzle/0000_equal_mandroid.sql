CREATE TABLE `integration_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`scope` text NOT NULL,
	`entity_type` text NOT NULL,
	`external_id` text NOT NULL,
	`payload` text NOT NULL,
	`source_updated_at` text,
	`fetched_at` integer NOT NULL,
	`sync_run_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_integration_record_source_scope_entity_external` ON `integration_records` (`source`,`scope`,`entity_type`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_integration_records_source_entity` ON `integration_records` (`source`,`entity_type`);--> statement-breakpoint
CREATE INDEX `idx_integration_records_fetched_at` ON `integration_records` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `integration_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`records_seen` integer DEFAULT 0 NOT NULL,
	`records_saved` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`errors` text
);
--> statement-breakpoint
CREATE INDEX `idx_integration_sync_runs_source_started` ON `integration_sync_runs` (`source`,`started_at`);