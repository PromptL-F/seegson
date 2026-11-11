import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { agentMemories, agentTasks, users } from "../drizzle/schema";
import { createHeartbeatJob, deleteHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { currentSessionCookie } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, router } from "./_core/trpc";
import { getLatestArchNewsKey } from "./arch-news";
import { dailyCronFromLocalTime, isValidTimeZone, listAgentAlertsForUser, listAgentTasksForUser } from "./agent-tasks";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { chatInputSchema, type ChatContext, type ChatMessage, type ChatResult } from "../shared/agent-actions";
import { AgentUnavailableError, type AgentMemory } from "./agent-tools";
import { memoryFromMessage } from "./agent-memory";
import { runAgentChat } from "./gemini-agent";
import { runForgeChat } from "./forge-agent";
import { TRPCError } from "@trpc/server";

// Límite sencillo por usuario para proteger la cuota de la clave de Gemini.
const CHAT_WINDOW_MS = 60_000;
const CHAT_MAX_PER_WINDOW = 12;
const chatHits = new Map<number, number[]>();

export function takeChatSlot(userId: number, now = Date.now()): boolean {
  const recent = (chatHits.get(userId) ?? []).filter((hit) => now - hit < CHAT_WINDOW_MS);
  if (recent.length >= CHAT_MAX_PER_WINDOW) {
    chatHits.set(userId, recent);
    return false;
  }
  recent.push(now);
  chatHits.set(userId, recent);
  return true;
}

function getHeartbeatSession(req: Parameters<typeof currentSessionCookie>[0]): string {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return currentSessionCookie(req) ?? "";
}

const taskIdInput = z.object({ id: z.number().int().positive() });
const timeInput = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const timeZoneInput = z.string().min(1).max(64).refine(isValidTimeZone, "Zona horaria IANA no válida");

/** Gemini si hay clave propia; si no, el servicio de IA integrado de la plataforma. */
export function runChatProvider(messages: ChatMessage[], context: ChatContext, memories: AgentMemory[]): Promise<ChatResult> {
  if (ENV.geminiApiKey) {
    return runAgentChat({ apiKey: ENV.geminiApiKey, model: ENV.geminiModel }, messages, context, memories);
  }
  if (ENV.forgeApiKey) {
    return runForgeChat(invokeLLM, messages, context, memories);
  }
  throw new AgentUnavailableError("El agente de IA no está configurado: define GEMINI_API_KEY en el servidor.");
}

export const agentRouter = router({
  chat: protectedProcedure.input(chatInputSchema).mutation(async ({ ctx, input }) => {
    if (!takeChatSlot(ctx.user.id)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Vas muy rápido. Espera un momento antes de escribir de nuevo." });
    }

    // La memoria es opcional: si la base de datos falla, el agente sigue funcionando sin ella.
    const lastMessage = input.messages[input.messages.length - 1].content;
    const remembered = memoryFromMessage(lastMessage);
    let memories: AgentMemory[] = [];
    try {
      const db = await getDb();
      if (db) {
        if (remembered) {
          await db.insert(agentMemories).values({ userId: ctx.user.id, content: remembered, source: "chat", isActive: true });
        }
        memories = await db
          .select({ id: agentMemories.id, content: agentMemories.content })
          .from(agentMemories)
          .where(and(eq(agentMemories.userId, ctx.user.id), eq(agentMemories.isActive, true)))
          .orderBy(desc(agentMemories.createdAt))
          .limit(30);
      }
    } catch (error) {
      console.error("[agent] memoria no disponible:", error instanceof Error ? error.message : "error desconocido");
    }

    try {
      const result = await runChatProvider(input.messages, input.context, memories);
      return { ...result, remembered };
    } catch (error) {
      if (error instanceof AgentUnavailableError) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: error.message });
      }
      throw error;
    }
  }),

  tasks: protectedProcedure.query(async ({ ctx }) => listAgentTasksForUser(ctx.user.id)),

  alerts: protectedProcedure.query(async ({ ctx }) => listAgentAlertsForUser(ctx.user.id)),

  memories: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    return db.select().from(agentMemories).where(and(eq(agentMemories.userId, ctx.user.id), eq(agentMemories.isActive, true))).orderBy(desc(agentMemories.createdAt)).limit(30);
  }),

  forgetMemory: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database is unavailable");
      await db.update(agentMemories).set({ isActive: false }).where(and(eq(agentMemories.id, input.id), eq(agentMemories.userId, ctx.user.id)));
      return { forgotten: true };
    }),

  registerPushToken: protectedProcedure
    .input(z.object({ token: z.string().min(20).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database is unavailable");
      await db.update(users).set({ expoPushToken: input.token }).where(eq(users.id, ctx.user.id));
      return { registered: true };
    }),

  createArchMonitor: protectedProcedure
    .input(z.object({ time: timeInput, timeZone: timeZoneInput }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database is unavailable");
      const session = getHeartbeatSession(ctx.req);
      const lastSeenKey = await getLatestArchNewsKey();
      const title = "Novedades oficiales de Arch Linux";
      const inserted = await db.insert(agentTasks).values({
        userId: ctx.user.id,
        title,
        kind: "arch_news",
        localTime: input.time,
        timeZone: input.timeZone,
        isEnabled: true,
        lastSeenKey,
      });
      const result = (Array.isArray(inserted) ? inserted[0] : inserted) as unknown as { insertId?: number | string };
      const id = Number(result.insertId);
      if (!Number.isInteger(id) || id <= 0) throw new Error("Could not create the monitor record");

      try {
        const scheduled = await createHeartbeatJob(
          {
            name: `seegson-${ctx.user.id}-${id}`,
            cron: dailyCronFromLocalTime(input.time, input.timeZone),
            path: "/api/scheduled/agent",
            payload: { taskType: "arch_news" },
            description: "Comprueba a diario el feed oficial de noticias de Arch Linux.",
          },
          session,
        );
        await db
          .update(agentTasks)
          .set({ heartbeatTaskUid: scheduled.taskUid })
          .where(and(eq(agentTasks.id, id), eq(agentTasks.userId, ctx.user.id)));
      } catch (error) {
        await db.delete(agentTasks).where(and(eq(agentTasks.id, id), eq(agentTasks.userId, ctx.user.id)));
        throw error;
      }

      return { id, title, kind: "arch_news" as const, localTime: input.time, timeZone: input.timeZone, isEnabled: true };
    }),

  updateArchMonitor: protectedProcedure
    .input(taskIdInput.extend({ enabled: z.boolean().optional(), time: timeInput.optional(), timeZone: timeZoneInput.optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database is unavailable");
      const [task] = await db
        .select()
        .from(agentTasks)
        .where(and(eq(agentTasks.id, input.id), eq(agentTasks.userId, ctx.user.id)))
        .limit(1);
      if (!task || !task.heartbeatTaskUid) throw new Error("Monitor not found");

      const nextTime = input.time ?? task.localTime;
      const nextZone = input.timeZone ?? task.timeZone;
      const patch: { enable?: boolean; cron?: string } = {};
      if (input.enabled !== undefined) patch.enable = input.enabled;
      if (input.time !== undefined || input.timeZone !== undefined) {
        patch.cron = dailyCronFromLocalTime(nextTime, nextZone);
      }
      if (Object.keys(patch).length > 0) {
        await updateHeartbeatJob(task.heartbeatTaskUid, patch, getHeartbeatSession(ctx.req));
      }

      await db
        .update(agentTasks)
        .set({
          isEnabled: input.enabled ?? task.isEnabled,
          localTime: nextTime,
          timeZone: nextZone,
        })
        .where(and(eq(agentTasks.id, input.id), eq(agentTasks.userId, ctx.user.id)));
      return { updated: true };
    }),

  deleteArchMonitor: protectedProcedure
    .input(taskIdInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database is unavailable");
      const [task] = await db
        .select()
        .from(agentTasks)
        .where(and(eq(agentTasks.id, input.id), eq(agentTasks.userId, ctx.user.id)))
        .limit(1);
      if (!task) return { deleted: true };
      if (task.heartbeatTaskUid) {
        await deleteHeartbeatJob(task.heartbeatTaskUid, getHeartbeatSession(ctx.req));
      }
      await db.delete(agentTasks).where(and(eq(agentTasks.id, input.id), eq(agentTasks.userId, ctx.user.id)));
      return { deleted: true };
    }),
});
