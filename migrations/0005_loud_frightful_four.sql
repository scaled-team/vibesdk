ALTER TABLE `apps` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `project_id` text;--> statement-breakpoint
CREATE INDEX `apps_workspace_project_idx` ON `apps` (`workspace_id`,`project_id`);