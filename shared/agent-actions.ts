import { z } from "zod";

/**
 * Contrato compartido entre el servidor (que habla con la IA) y la app (que ejecuta
 * las acciones en el teléfono). Todo lo que devuelve el modelo se valida aquí antes
 * de llegar al cliente.
 */

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS_ES: Record<Weekday, string> = {
  monday: "lunes",
  tuesday: "martes",
  wednesday: "miércoles",
  thursday: "jueves",
  friday: "viernes",
  saturday: "sábado",
  sunday: "domingo",
};

/** expo-notifications usa 1 = domingo … 7 = sábado. */
export function expoWeekday(day: Weekday): number {
  const map: Record<Weekday, number> = {
    sunday: 1,
    monday: 2,
    tuesday: 3,
    wednesday: 4,
    thursday: 5,
    friday: 6,
    saturday: 7,
  };
  return map[day];
}

export const EVENT_CATEGORIES = ["Personal", "Trabajo", "Familia", "Salud", "Otro"] as const;

export function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const timeField = z.string().regex(TIME_RE, "La hora debe ser HH:mm en formato 24 h");
const dateField = z.string().refine(isRealDate, "La fecha debe ser AAAA-MM-DD y existir");
const titleField = z.string().trim().min(1).max(120);

export const reminderRepeatSchema = z.enum(["once", "daily", "weekly"]);
export type ReminderRepeat = z.infer<typeof reminderRepeatSchema>;

const createReminderSchema = z
  .object({
    type: z.literal("create_reminder"),
    title: titleField,
    time: timeField,
    repeat: reminderRepeatSchema,
    date: dateField.optional(),
    weekday: z.enum(WEEKDAYS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.repeat === "once" && !value.date) {
      ctx.addIssue({ code: "custom", message: "Un aviso de una sola vez necesita fecha", path: ["date"] });
    }
    if (value.repeat === "weekly" && !value.weekday) {
      ctx.addIssue({ code: "custom", message: "Un aviso semanal necesita día de la semana", path: ["weekday"] });
    }
  });

const deleteReminderSchema = z.object({
  type: z.literal("delete_reminder"),
  id: z.string().min(1).max(80),
});

const setReminderEnabledSchema = z.object({
  type: z.literal("set_reminder_enabled"),
  id: z.string().min(1).max(80),
  enabled: z.boolean(),
});

const createEventSchema = z.object({
  type: z.literal("create_event"),
  title: titleField,
  date: dateField,
  time: timeField,
  alarmTime: timeField.optional(),
  description: z.string().trim().max(500).optional(),
  category: z.enum(EVENT_CATEGORIES).optional(),
});

export const agentActionSchema = z.union([
  createReminderSchema,
  deleteReminderSchema,
  setReminderEnabledSchema,
  createEventSchema,
]);
export type AgentAction = z.infer<typeof agentActionSchema>;

/** Convierte una llamada de función del modelo en una acción validada. */
export function callToAction(
  name: string,
  args: unknown,
): { ok: true; action: AgentAction } | { ok: false; error: string } {
  const raw = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  let candidate: Record<string, unknown>;

  switch (name) {
    case "create_reminder":
      candidate = { type: "create_reminder", ...raw };
      break;
    case "delete_reminder":
      candidate = { type: "delete_reminder", ...raw };
      break;
    case "set_reminder_enabled":
      candidate = { type: "set_reminder_enabled", ...raw };
      break;
    case "create_event": {
      const { alarm_time, ...rest } = raw;
      candidate = { type: "create_event", ...rest, alarmTime: alarm_time };
      break;
    }
    default:
      return { ok: false, error: `Acción desconocida: ${name}` };
  }

  const parsed = agentActionSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${name}: ${issue?.message ?? "argumentos no válidos"}` };
  }
  return { ok: true, action: parsed.data };
}

/** Texto corto para mostrar cuándo se dispara un recordatorio. */
export function describeSchedule(input: {
  repeat?: ReminderRepeat;
  time: string;
  date?: string;
  weekday?: Weekday;
}): string {
  const repeat = input.repeat ?? "daily";
  if (repeat === "once") {
    const date = input.date && isRealDate(input.date) ? input.date.split("-").reverse().join("/") : "fecha pendiente";
    return `Una vez · ${date} · ${input.time}`;
  }
  if (repeat === "weekly") {
    const label = input.weekday ? WEEKDAY_LABELS_ES[input.weekday] : "semana";
    return `Cada ${label} · ${input.time}`;
  }
  return `Cada día · ${input.time}`;
}

// ---------------------------------------------------------------------------
// Entrada del endpoint de chat
// ---------------------------------------------------------------------------

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatContextSchema = z.object({
  localDate: dateField,
  localTime: timeField,
  weekday: z.enum(WEEKDAYS),
  timeZone: z.string().min(1).max(64),
  reminders: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        title: z.string().max(120),
        time: timeField,
        repeat: reminderRepeatSchema,
        date: z.string().max(10).optional(),
        weekday: z.enum(WEEKDAYS).optional(),
        enabled: z.boolean(),
      }),
    )
    .max(50),
  events: z
    .array(
      z.object({
        title: z.string().max(120),
        date: z.string().max(10),
        time: z.string().max(5),
      }),
    )
    .max(20),
});
export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatInputSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1)
    .max(20)
    .refine((messages) => messages[messages.length - 1]?.role === "user", "El último mensaje debe ser del usuario"),
  context: chatContextSchema,
});
export type ChatInput = z.infer<typeof chatInputSchema>;

export type ChatResult = {
  reply: string;
  actions: AgentAction[];
  errors: string[];
};

/** Momento exacto de un aviso de una sola vez, o null si la fecha/hora no son válidas. */
export function onceFireTime(date: string | undefined, time: string): Date | null {
  if (!date || !isRealDate(date) || !TIME_RE.test(time)) return null;
  const fireAt = new Date(`${date}T${time}:00`);
  return Number.isNaN(fireAt.getTime()) ? null : fireAt;
}

/** True si un aviso de una sola vez ya pasó y no tiene sentido reprogramarlo. */
export function isExpiredOnce(
  task: { repeat?: ReminderRepeat; date?: string; time: string },
  now = Date.now(),
): boolean {
  if (task.repeat !== "once") return false;
  const fireAt = onceFireTime(task.date, task.time);
  return !fireAt || fireAt.getTime() <= now;
}
