CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`task_ids_json` text NOT NULL,
	`models_json` text NOT NULL,
	`prompt_variant` text NOT NULL,
	`trials_per_cell` integer NOT NULL,
	`temperature` real NOT NULL,
	`budget_cap_cents` integer NOT NULL,
	`baseline_run_id` text,
	`total_trials` integer NOT NULL,
	`completed_trials` integer NOT NULL,
	`success_count` integer NOT NULL,
	`cost_micros` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `runs_created_at_idx` ON `runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_key` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`tools_json` text NOT NULL,
	`fixture_json` text NOT NULL,
	`max_steps` integer NOT NULL,
	`assertions_json` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_key_version_idx` ON `tasks` (`task_key`,`version`);--> statement-breakpoint
CREATE TABLE `trials` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`task_id` text NOT NULL,
	`task_name` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`category` text NOT NULL,
	`steps` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_micros` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`trace_json` text NOT NULL,
	`before_state_json` text NOT NULL,
	`after_state_json` text NOT NULL,
	`checks_json` text NOT NULL,
	`final_message` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `trials_run_id_idx` ON `trials` (`run_id`);--> statement-breakpoint
CREATE INDEX `trials_status_idx` ON `trials` (`status`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`default_n` integer NOT NULL,
	`default_temperature` real NOT NULL,
	`budget_warning_cents` integer NOT NULL,
	`retention_days` integer NOT NULL,
	`enabled_models_json` text NOT NULL,
	`updated_at` text NOT NULL
);
