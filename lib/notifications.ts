import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const EVENT_CHANNEL_ID = "seegson-events";
export const DAILY_CHANNEL_ID = "seegson-daily";
export const AGENT_CHANNEL_ID = "seegson-agent";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(EVENT_CHANNEL_ID, {
      name: "Alarmas de eventos",
      description: "Avisos de eventos y recordatorios de Seegson",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 120, 250],
      lightColor: "#E8AD5A",
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync(DAILY_CHANNEL_ID, {
      name: "Tareas del agente",
      description: "Avisos recurrentes configurados en Seegson",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: "#65D6C2",
      sound: "default",
    });
    await Notifications.setNotificationChannelAsync(AGENT_CHANNEL_ID, {
      name: "Vigilancia de Arch",
      description: "Avisos remotos del agente de Seegson",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: "#65D6C2",
      sound: "default",
    });
  }

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  return permission.granted;
}

export async function scheduleEventAlarm(input: {
  eventId: string;
  title: string;
  date: string;
  time: string;
  alarmTime: string;
}): Promise<string | null> {
  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  const fireAt = new Date(`${input.date}T${input.alarmTime}:00`);
  if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() <= Date.now()) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: `Hoy: ${input.title}`,
      body: `Tu evento es a las ${input.time}.`,
      sound: "default",
      data: { eventId: input.eventId, kind: "event-alarm" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
      channelId: EVENT_CHANNEL_ID,
    },
  });
}

export async function scheduleDailyReminder(input: {
  taskId: string;
  title: string;
  time: string;
}): Promise<string | null> {
  const granted = await ensureNotificationPermission();
  if (!granted) return null;

  const [hour, minute] = input.time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: "Recordatorio de Seegson",
      body: input.title,
      sound: "default",
      data: { taskId: input.taskId, kind: "daily-reminder" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: DAILY_CHANNEL_ID,
    },
  });
}

export async function cancelLocalNotification(id?: string): Promise<void> {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // The notification may already have fired or been removed by Android.
  }
}

export function parseDateInput(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

export function formatDateInput(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}
