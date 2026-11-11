import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Weekday } from "@/shared/agent-actions";

const EVENTS_KEY = "@seegson/events/v1";
const DAILY_TASKS_KEY = "@seegson/daily-tasks/v1";
const CHAT_KEY = "@seegson/agent-chat/v1";
const CHAT_LIMIT = 60;

export type EventStatus = "upcoming" | "completed" | "cancelled";

export type SeegsonEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD in the device's local calendar
  time: string; // HH:mm
  description: string;
  category: string;
  status: EventStatus;
  alarmEnabled: boolean;
  alarmTime: string; // HH:mm on the event date
  notificationId?: string;
};

export type DailyReminderTask = {
  id: string;
  title: string;
  time: string; // HH:mm in device local time
  enabled: boolean;
  notificationId?: string;
  /** Ausente = "daily", para no romper lo ya guardado en el teléfono. */
  repeat?: "once" | "daily" | "weekly";
  date?: string; // YYYY-MM-DD, solo para "once"
  weekday?: Weekday; // solo para "weekly"
  /** "agent" si lo creó la IA; sirve para mostrar su origen. */
  source?: "agent";
};

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant" | "notice";
  content: string;
};

async function readArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

export async function loadEvents(): Promise<SeegsonEvent[]> {
  return readArray<SeegsonEvent>(EVENTS_KEY);
}

export async function saveEvents(events: SeegsonEvent[]): Promise<void> {
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

export async function loadDailyTasks(): Promise<DailyReminderTask[]> {
  return readArray<DailyReminderTask>(DAILY_TASKS_KEY);
}

export async function saveDailyTasks(tasks: DailyReminderTask[]): Promise<void> {
  await AsyncStorage.setItem(DAILY_TASKS_KEY, JSON.stringify(tasks));
}

export async function loadChat(): Promise<StoredChatMessage[]> {
  return readArray<StoredChatMessage>(CHAT_KEY);
}

export async function saveChat(messages: StoredChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-CHAT_LIMIT)));
}

export async function clearChat(): Promise<void> {
  await AsyncStorage.removeItem(CHAT_KEY);
}
