CREATE TABLE `agent_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`task_id` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`body` text NOT NULL,
	`url` text,
	`dedupe_key` varchar(512) NOT NULL,
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_alerts_dedupe_idx` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `agent_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`kind` enum('arch_news') NOT NULL DEFAULT 'arch_news',
	`local_time` varchar(5) NOT NULL,
	`time_zone` varchar(64) NOT NULL DEFAULT 'UTC',
	`is_enabled` boolean NOT NULL DEFAULT true,
	`heartbeat_task_uid` varchar(128),
	`last_seen_key` varchar(512),
	`last_checked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `agent_tasks_heartbeat_uid_idx` UNIQUE(`heartbeat_task_uid`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `expoPushToken` varchar(255);--> statement-breakpoint
CREATE INDEX `agent_alerts_user_created_idx` ON `agent_alerts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_tasks_user_idx` ON `agent_tasks` (`user_id`);