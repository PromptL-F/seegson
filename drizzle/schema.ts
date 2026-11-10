import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Core user table backing Manus OAuth. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  expoPushToken: varchar("expoPushToken", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Daily, server-backed Arch Linux News monitors. */
export const agentTasks = mysqlTable(
  "agent_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    kind: mysqlEnum("kind", ["arch_news"]).notNull().default("arch_news"),
    localTime: varchar("local_time", { length: 5 }).notNull(),
    timeZone: varchar("time_zone", { length: 64 }).notNull().default("UTC"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    heartbeatTaskUid: varchar("heartbeat_task_uid", { length: 128 }),
    lastSeenKey: varchar("last_seen_key", { length: 512 }),
    lastCheckedAt: timestamp("last_checked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("agent_tasks_user_idx").on(table.userId),
    uniqueIndex("agent_tasks_heartbeat_uid_idx").on(table.heartbeatTaskUid),
  ],
);

export type AgentTask = typeof agentTasks.$inferSelect;

/** In-app history for agent notifications, including runs without a push token. */
export const agentAlerts = mysqlTable(
  "agent_alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    taskId: int("task_id").notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    body: text("body").notNull(),
    url: text("url"),
    dedupeKey: varchar("dedupe_key", { length: 512 }).notNull(),
    readAt: timestamp("read_at"),
    pushSentAt: timestamp("push_sent_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_alerts_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("agent_alerts_dedupe_idx").on(table.dedupeKey),
  ],
);

export type AgentAlert = typeof agentAlerts.$inferSelect;

/** Persistent memories explicitly saved by the user through the conversational agent. */
export const agentMemories = mysqlTable(
  "agent_memories",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    content: text("content").notNull(),
    source: varchar("source", { length: 32 }).notNull().default("chat"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("agent_memories_user_idx").on(table.userId, table.isActive)],
);

export type AgentMemory = typeof agentMemories.$inferSelect;

/** Short conversation history used to give the remote model continuity. */
export const agentMessages = mysqlTable(
  "agent_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    role: mysqlEnum("role", ["user", "assistant"]).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("agent_messages_user_created_idx").on(table.userId, table.createdAt)],
);

export type AgentMessage = typeof agentMessages.$inferSelect;
