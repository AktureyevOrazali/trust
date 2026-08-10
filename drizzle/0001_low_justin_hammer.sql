CREATE TABLE `monthly_plans` (
	`month` text PRIMARY KEY NOT NULL,
	`new_leads` integer NOT NULL,
	`no_contact_percent` integer NOT NULL,
	`contact_percent` integer NOT NULL,
	`revenue` integer NOT NULL,
	`new_sales` integer NOT NULL,
	`repeat_revenue` integer NOT NULL,
	`updated_at` integer NOT NULL
);
