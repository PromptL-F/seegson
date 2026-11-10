import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { agentAlerts, agentTasks, users } from "../drizzle/schema";
import { getDb } from "./db";
import { fetchArchNews, type ArchNewsItem } from "./arch-news";

function parseTime(value: string): { hour: number; minute: number } {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error("Hora no válida");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const localMinutes = getPart("hour") * 60 + getPart("minute");
  const utcMinutes = instant.getUTCHours() * 60 + instant.getUTCMinutes();
  const rawOffset = localMinutes - utcMinutes;
  return ((rawOffset + 720 + 1440) % 1440) - 720;
}

function timeZoneOffsets(timeZone: string): number[] {
  if (!isValidTimeZone(timeZone)) throw new Error("Zona horaria no válida");
  const year = new Date().getUTCFullYear();
  const samples = [
    new Date(),
    ...[year, year + 1].flatMap((sampleYear) => [
      new Date(Date.UTC(sampleYear, 0, 15, 12)),
      new Date(Date.UTC(sampleYear, 6, 15, 12)),
    ]),
  ];
  return [...new Set(samples.map((instant) => offsetMinutesAt(instant, timeZone)))];
}

export function dailyCronFromLocalTime(localTime: string, timeZone: string): string {
  const { hour, minute } = parseTime(localTime);
  const localMinutes = hour * 60 + minute;
  const utcCandidates = new Set<number>();

  for (const offset of timeZoneOffsets(timeZone)) {
    utcCandidates.add((localMinutes - offset + 1440 * 2) % 1440);
  }

  // A UTC cron cannot encode IANA daylight-saving rules. Schedule every currently
  // known seasonal UTC slot; the callback runs only at the requested local time.
  const minuteValues = [...new Set([...utcCandidates].map((value) => value % 60))].sort((a, b) => a - b);
  const hourValues = [...new Set([...utcCandidates].map((value) => Math.floor(value / 60)))].sort((a, b) => a - b);
  return `0 ${minuteValues.join(",")} ${hourValues.join(",")} * * *`;
}

export function isNearLocalTime(instant: Date, localTime: string, timeZone: string, graceMinutes = 5): boolean {
  const { hour, minute } = parseTime(localTime);
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const currentMinutes = getPart("hour") * 60 + getPart("minute");
    const targetMinutes = hour * 60 + minute;
    const minutesLate = (currentMinutes - targetMinutes + 1440) % 1440;
    return minutesLate <= graceMinutes;
  } catch {
    return false;
  }
}

export function getNewArchNews(
  previousKey: string | null,
  items: ArchNewsItem[],
  since?: Date | null,
): ArchNewsItem[] {
  if (items.length === 0) return [];
  const previousIndex = previousKey ? items.findIndex((item) => item.key === previousKey) : -1;
  if (previousIndex === 0) return [];
  if (previousIndex > 0) return items.slice(0, previousIndex).reverse();

  if (since && Number.isFinite(since.getTime())) {
    return items
      .filter((item) => {
        const publishedAt = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
        return Number.isFinite(publishedAt) && publishedAt > since.getTime();
      })
      .sort((a, b) => Date.parse(a.publishedAt ?? "") - Date.parse(b.publishedAt ?? ""));
  }

  return previousKey && items[0] ? [items[0]] : [];
}

export async function runScheduledArchCheck(taskUid: string): Promise<{ sent: boolean; newItem: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const [task] = await db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.heartbeatTaskUid, taskUid))
    .limit(1);

  if (!task) throw new Error("Scheduled Seegson task was not found");
  if (!task.isEnabled) return { sent: false, newItem: false };

  const checkedAt = new Date();
  if (!isNearLocalTime(checkedAt, task.localTime, task.timeZone)) {
    return { sent: false, newItem: false };
  }

  const items = await fetchArchNews();
  const latest = items[0];
  if (!latest) throw new Error("Arch News feed is empty");
  const unseen = getNewArchNews(task.lastSeenKey, items, task.lastCheckedAt ?? task.createdAt);

  for (const item of unseen) {
    const dedupeKey = `${task.id}:${item.key}`.slice(0, 512);
    const [existing] = await db
      .select({ id: agentAlerts.id })
      .from(agentAlerts)
      .where(eq(agentAlerts.dedupeKey, dedupeKey))
      .limit(1);
    if (existing) continue;

    await db.insert(agentAlerts).values({
      userId: task.userId,
      taskId: task.id,
      title: "Nueva noticia de Arch Linux",
      body: item.title,
      url: item.url,
      dedupeKey,
    });
  }

  const [owner] = await db
    .select({ expoPushToken: users.expoPushToken })
    .from(users)
    .where(eq(users.id, task.userId))
    .limit(1);

  let sent = false;
  if (owner?.expoPushToken) {
    const pendingPushes = await db
      .select({ id: agentAlerts.id, title: agentAlerts.title, body: agentAlerts.body, url: agentAlerts.url })
      .from(agentAlerts)
      .where(and(
        eq(agentAlerts.userId, task.userId),
        eq(agentAlerts.taskId, task.id),
        isNull(agentAlerts.pushSentAt),
      ))
      .orderBy(desc(agentAlerts.createdAt))
      .limit(20);

    if (pendingPushes.length > 0) {
      const newest = pendingPushes[0]!;
      const title = pendingPushes.length === 1 ? newest.title : `${pendingPushes.length} novedades de Arch Linux`;
      const body = pendingPushes.length === 1
        ? newest.body
        : `${newest.body} y otras ${pendingPushes.length - 1} novedades nuevas.`;
      sent = await sendExpoPush(owner.expoPushToken, title, body, {
        kind: "arch-news",
        url: newest.url ?? "",
        taskId: String(task.id),
        count: String(pendingPushes.length),
      });

      if (sent) {
        await db
          .update(agentAlerts)
          .set({ pushSentAt: checkedAt })
          .where(and(
            eq(agentAlerts.taskId, task.id),
            inArray(agentAlerts.id, pendingPushes.map((alert) => alert.id)),
            isNull(agentAlerts.pushSentAt),
          ));
      }
    }
  }

  await db
    .update(agentTasks)
    .set({ lastSeenKey: latest.key, lastCheckedAt: checkedAt })
    .where(and(eq(agentTasks.id, task.id), eq(agentTasks.heartbeatTaskUid, taskUid)));

  return { sent, newItem: unseen.length > 0 };
}

async function sendExpoPush(
  to: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<boolean> {
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "accept-encoding": "gzip, deflate",
      },
      body: JSON.stringify({ to, title, body, sound: "default", data, channelId: "seegson-agent" }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { data?: { status?: string } };
    return payload.data?.status === "ok";
  } catch {
    return false;
  }
}

export async function listAgentTasksForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(agentTasks).where(eq(agentTasks.userId, userId)).orderBy(desc(agentTasks.createdAt));
}

export async function listAgentAlertsForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(agentAlerts).where(eq(agentAlerts.userId, userId)).orderBy(desc(agentAlerts.createdAt)).limit(50);
}
