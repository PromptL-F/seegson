import { describe, expect, it } from "vitest";
import {
  callToAction,
  chatInputSchema,
  describeSchedule,
  expoWeekday,
  isExpiredOnce,
  isRealDate,
  onceFireTime,
} from "../shared/agent-actions";

describe("callToAction", () => {
  it("acepta un recordatorio diario válido", () => {
    const result = callToAction("create_reminder", { title: "Tomar agua", time: "09:30", repeat: "daily" });
    expect(result).toEqual({ ok: true, action: { type: "create_reminder", title: "Tomar agua", time: "09:30", repeat: "daily" } });
  });

  it("exige fecha cuando es de una sola vez", () => {
    const result = callToAction("create_reminder", { title: "Llamar", time: "09:00", repeat: "once" });
    expect(result.ok).toBe(false);
  });

  it("exige día de la semana cuando es semanal", () => {
    expect(callToAction("create_reminder", { title: "Revisar", time: "08:00", repeat: "weekly" }).ok).toBe(false);
    expect(callToAction("create_reminder", { title: "Revisar", time: "08:00", repeat: "weekly", weekday: "monday" }).ok).toBe(true);
  });

  it("rechaza horas y fechas inventadas", () => {
    expect(callToAction("create_reminder", { title: "x", time: "25:00", repeat: "daily" }).ok).toBe(false);
    expect(callToAction("create_reminder", { title: "x", time: "9:00", repeat: "daily" }).ok).toBe(false);
    expect(callToAction("create_event", { title: "x", date: "2026-02-30", time: "10:00" }).ok).toBe(false);
  });

  it("mapea alarm_time del evento a alarmTime", () => {
    const result = callToAction("create_event", { title: "Cita", date: "2026-12-28", time: "16:00", alarm_time: "00:00" });
    expect(result.ok && result.action.type === "create_event" && result.action.alarmTime).toBe("00:00");
  });

  it("rechaza funciones desconocidas y argumentos no objeto", () => {
    expect(callToAction("send_email", {}).ok).toBe(false);
    expect(callToAction("delete_reminder", "no-objeto").ok).toBe(false);
  });
});

describe("fechas", () => {
  it("isRealDate distingue fechas reales", () => {
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("28/12/2026")).toBe(false);
  });

  it("isExpiredOnce solo aplica a avisos únicos", () => {
    const now = new Date("2026-11-10T12:00:00").getTime();
    expect(isExpiredOnce({ repeat: "once", date: "2026-11-10", time: "09:00" }, now)).toBe(true);
    expect(isExpiredOnce({ repeat: "once", date: "2026-11-10", time: "18:00" }, now)).toBe(false);
    expect(isExpiredOnce({ repeat: "once", time: "18:00" }, now)).toBe(true);
    expect(isExpiredOnce({ repeat: "daily", time: "09:00" }, now)).toBe(false);
    expect(isExpiredOnce({ time: "09:00" }, now)).toBe(false);
  });

  it("onceFireTime devuelve null con datos inválidos", () => {
    expect(onceFireTime("2026-11-10", "18:00")).toBeInstanceOf(Date);
    expect(onceFireTime("2026-11-10", "7pm")).toBeNull();
    expect(onceFireTime(undefined, "18:00")).toBeNull();
  });

  it("expoWeekday usa 1 = domingo", () => {
    expect(expoWeekday("sunday")).toBe(1);
    expect(expoWeekday("monday")).toBe(2);
    expect(expoWeekday("saturday")).toBe(7);
  });
});

describe("describeSchedule", () => {
  it("describe los tres tipos", () => {
    expect(describeSchedule({ time: "09:00" })).toBe("Cada día · 09:00");
    expect(describeSchedule({ repeat: "weekly", weekday: "friday", time: "18:00" })).toBe("Cada viernes · 18:00");
    expect(describeSchedule({ repeat: "once", date: "2026-12-28", time: "16:00" })).toBe("Una vez · 28/12/2026 · 16:00");
  });
});

describe("chatInputSchema", () => {
  const context = { localDate: "2026-11-10", localTime: "22:48", weekday: "tuesday", timeZone: "America/Santo_Domingo", reminders: [], events: [] };

  it("exige que el último mensaje sea del usuario", () => {
    expect(chatInputSchema.safeParse({ messages: [{ role: "user", content: "hola" }, { role: "assistant", content: "hola" }], context }).success).toBe(false);
    expect(chatInputSchema.safeParse({ messages: [{ role: "user", content: "hola" }], context }).success).toBe(true);
  });

  it("limita el tamaño de los mensajes", () => {
    expect(chatInputSchema.safeParse({ messages: [{ role: "user", content: "a".repeat(2001) }], context }).success).toBe(false);
  });
});
