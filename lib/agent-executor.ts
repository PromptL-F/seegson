import {
  describeSchedule,
  type AgentAction,
  type ChatContext,
  type Weekday,
  WEEKDAYS,
} from "@/shared/agent-actions";
import {
  cancelLocalNotification,
  isExpiredOnce,
  scheduleEventAlarm,
  scheduleReminder,
} from "@/lib/notifications";
import {
  loadDailyTasks,
  loadEvents,
  saveDailyTasks,
  saveEvents,
  type DailyReminderTask,
  type SeegsonEvent,
} from "@/lib/seegson-storage";

export type ActionOutcome = {
  ok: boolean;
  /** Frase corta para mostrar en el chat. */
  message: string;
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PERMISSION_HINT = "Revisa que Seegson tenga permiso de notificaciones en Android.";

/** Aplica en el teléfono las acciones que decidió el agente. Nunca falla en silencio. */
export async function applyAgentActions(actions: AgentAction[]): Promise<ActionOutcome[]> {
  const outcomes: ActionOutcome[] = [];
  let reminders = await loadDailyTasks();
  let events = await loadEvents();
  let remindersChanged = false;
  let eventsChanged = false;

  for (const action of actions) {
    try {
      if (action.type === "create_reminder") {
        const task: DailyReminderTask = {
          id: makeId(),
          title: action.title,
          time: action.time,
          enabled: true,
          repeat: action.repeat,
          date: action.repeat === "once" ? action.date : undefined,
          weekday: action.repeat === "weekly" ? action.weekday : undefined,
          source: "agent",
        };
        const notificationId = await scheduleReminder({
          taskId: task.id,
          title: task.title,
          time: task.time,
          repeat: task.repeat,
          date: task.date,
          weekday: task.weekday,
        });
        if (!notificationId) {
          const pastHint = task.repeat === "once" ? " También puede que esa hora ya haya pasado." : "";
          outcomes.push({
            ok: false,
            message: `No pude programar “${task.title}”. ${PERMISSION_HINT}${pastHint}`,
          });
          continue;
        }
        task.notificationId = notificationId;
        reminders = [...reminders, task];
        remindersChanged = true;
        outcomes.push({ ok: true, message: `Recordatorio guardado: ${task.title} (${describeSchedule(task)})` });
      } else if (action.type === "delete_reminder") {
        const target = reminders.find((item) => item.id === action.id);
        if (!target) {
          outcomes.push({ ok: false, message: "No encontré ese recordatorio; puede que ya no exista." });
          continue;
        }
        await cancelLocalNotification(target.notificationId);
        reminders = reminders.filter((item) => item.id !== action.id);
        remindersChanged = true;
        outcomes.push({ ok: true, message: `Recordatorio eliminado: ${target.title}` });
      } else if (action.type === "set_reminder_enabled") {
        const target = reminders.find((item) => item.id === action.id);
        if (!target) {
          outcomes.push({ ok: false, message: "No encontré ese recordatorio; puede que ya no exista." });
          continue;
        }
        await cancelLocalNotification(target.notificationId);
        let next: DailyReminderTask = { ...target, enabled: action.enabled, notificationId: undefined };
        if (action.enabled) {
          const notificationId = await scheduleReminder({
            taskId: target.id,
            title: target.title,
            time: target.time,
            repeat: target.repeat,
            date: target.date,
            weekday: target.weekday,
          });
          if (!notificationId) {
            next = { ...next, enabled: false };
            reminders = reminders.map((item) => (item.id === target.id ? next : item));
            remindersChanged = true;
            outcomes.push({ ok: false, message: `No pude reactivar “${target.title}”. ${PERMISSION_HINT}` });
            continue;
          }
          next.notificationId = notificationId;
        }
        reminders = reminders.map((item) => (item.id === target.id ? next : item));
        remindersChanged = true;
        outcomes.push({
          ok: true,
          message: `${action.enabled ? "Recordatorio activado" : "Recordatorio en pausa"}: ${target.title}`,
        });
      } else if (action.type === "create_event") {
        const event: SeegsonEvent = {
          id: makeId(),
          title: action.title,
          date: action.date,
          time: action.time,
          description: action.description ?? "",
          category: action.category ?? "Otro",
          status: "upcoming",
          alarmEnabled: Boolean(action.alarmTime),
          alarmTime: action.alarmTime ?? "00:00",
        };
        let alarmNote = "";
        if (event.alarmEnabled) {
          const notificationId = await scheduleEventAlarm({
            eventId: event.id,
            title: event.title,
            date: event.date,
            time: event.time,
            alarmTime: event.alarmTime,
          });
          if (notificationId) {
            event.notificationId = notificationId;
          } else {
            event.alarmEnabled = false;
            alarmNote = ` Pero la alarma no se pudo programar. ${PERMISSION_HINT}`;
          }
        }
        events = [...events, event];
        eventsChanged = true;
        outcomes.push({
          ok: !alarmNote,
          message: `Evento guardado: ${event.title} (${event.date.split("-").reverse().join("/")} ${event.time}).${alarmNote}`,
        });
      }
    } catch {
      outcomes.push({ ok: false, message: "Algo falló al aplicar una acción en el teléfono." });
    }
  }

  if (remindersChanged) await saveDailyTasks(reminders);
  if (eventsChanged) {
    await saveEvents([...events].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)));
  }
  return outcomes;
}

/** Foto del estado actual para que la IA sepa qué ya está agendado. */
export async function buildChatContext(now = new Date()): Promise<ChatContext> {
  const pad = (value: number) => String(value).padStart(2, "0");
  const [reminders, events] = await Promise.all([loadDailyTasks(), loadEvents()]);
  // getDay(): 0 = domingo. WEEKDAYS empieza en lunes.
  const weekday: Weekday = WEEKDAYS[(now.getDay() + 6) % 7];
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  let timeZone = "UTC";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // Se mantiene UTC si el dispositivo no expone la zona horaria.
  }

  return {
    localDate: today,
    localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday,
    timeZone,
    reminders: reminders
      .filter((item) => !isExpiredOnce(item, now.getTime()))
      .slice(0, 50)
      .map((item) => ({
        id: item.id,
        title: item.title.slice(0, 120),
        time: item.time,
        repeat: item.repeat ?? "daily",
        date: item.date,
        weekday: item.weekday,
        enabled: item.enabled,
      })),
    events: events
      .filter((item) => item.status === "upcoming" && item.date >= today)
      .slice(0, 20)
      .map((item) => ({ title: item.title.slice(0, 120), date: item.date, time: item.time })),
  };
}
