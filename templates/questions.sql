-- Ask-the-app assistant: every question a user asks the in-app guide,
-- with the answer given. The log IS the product insight — what users ask
-- is the roadmap and the next tour script.
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`page_path` text,
	`asked_by` text,
	`model_used` text,
	`latency_ms` integer,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_questions_tenant_created` ON `questions` (`tenant_id`,`created_at`);
