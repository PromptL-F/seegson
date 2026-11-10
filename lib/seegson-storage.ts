import AsyncStorage from "@react-native-async-storage/async-storage";

const EVENTS_KEY = "@seegson/events/v1";
const DAILY_TASKS_KEY = "@seegson/daily-tasks/v1";

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
