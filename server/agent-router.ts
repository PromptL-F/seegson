import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { agentMemories, agentMessages, agentTasks, users } from "../drizzle/schema";
import { createHeartbeatJob, deleteHeartbeatJob, updateHeartbeatJob } from "./_core/heartbeat";
import { currentSessionCookie } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, router } from "./_core/trpc";
import { getLatestArchNewsKey } from "./arch-news";
import { dailyCronFromLocalTime, isValidTimeZone, listAgentAlertsForUser, listAgentTasksForUser } from "./agent-tasks";
import { getDb } from "./db";

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

const chatInput = z.object({ message: z.string().trim().min(1).max(4000) });

function textFromLLM(value: string | Array<{ type: string; text?: string }>): string {
  if (typeof value === "string") return value.trim();
  return value.filter((part) => part.type === "text" && part.text).map((part) => part.text).join("\n").trim();
}

function memoryFromMessage(message: string): string | null {
  const match = message.match(/^(?:recuerda(?:me)?|acu[eé]rdate|remember)\s*(?:que|to)?\s*[:\-]?\s*(.+)$/i);
  const content = match?.[1]?.trim().replace(/[.!?]+$/, "");
  return content && content.length >= 3 ? content.slice(0, 1000) : null;
}

export const agentRouter = router({
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

  chat: protectedProcedure.input(chatInput).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");

    const remembered = memoryFromMessage(input.message);
    if (remembered) {
      await db.insert(agentMemories).values({ userId: ctx.user.id, content: remembered, source: "chat", isActive: true });
    }

    const [memories, recentMessages] = await Promise.all([
      db.select({ id: agentMemories.id, content: agentMemories.content }).from(agentMemories)
        .where(and(eq(agentMemories.userId, ctx.user.id), eq(agentMemories.isActive, true)))
        .orderBy(desc(agentMemories.createdAt)).limit(30),
      db.select({ role: agentMessages.role, content: agentMessages.content }).from(agentMessages)
        .where(eq(agentMessages.userId, ctx.user.id)).orderBy(desc(agentMessages.createdAt)).limit(12),
    ]);

    await db.insert(agentMessages).values({ userId: ctx.user.id, role: "user", content: input.message });
    const memoryBlock = memories.length > 0
      ? memories.map((memory) => `- [${memory.id}] ${memory.content}`).join("\n")
      : "(Todavía no hay recuerdos guardados.)";
    const history = recentMessages.reverse().map((message) => ({ role: message.role, content: message.content } as const));
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Eres Seegson, un agente personal claro, sobrio y útil. Responde en español salvo que la persona cambie de idioma. Puedes recordar datos solo cuando la persona diga explícitamente “recuerda”, “acuérdate” o “remember”; confirma cuando se haya guardado. No inventes ejecuciones ni notificaciones: las tareas programadas se gestionan desde la sección de tareas. Memoria persistente actual:\n${memoryBlock}`,
        },
        ...history,
        { role: "user", content: input.message },
      ],
      maxTokens: 700,
    });
    const reply = textFromLLM(result.choices[0]?.message?.content ?? "No pude responder en este momento.");
    await db.insert(agentMessages).values({ userId: ctx.user.id, role: "assistant", content: reply });
    return { reply, remembered: remembered ?? null, memories };
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
