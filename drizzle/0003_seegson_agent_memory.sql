CREATE TABLE `agent_memories` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `content` text NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'chat',
  `is_active` boolean NOT NULL DEFAULT true,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `agent_memories_id` PRIMARY KEY(`id`),
  INDEX `agent_memories_user_idx` (`user_id`,`is_active`)
);
--> statement-breakpoint
CREATE TABLE `agent_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `agent_messages_id` PRIMARY KEY(`id`),
  INDEX `agent_messages_user_created_idx` (`user_id`,`created_at`)
);
