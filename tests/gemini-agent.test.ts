import { describe, expect, it, vi } from "vitest";
import { AgentUnavailableError, buildSystemPrompt } from "../server/agent-tools";
import { runAgentChat } from "../server/gemini-agent";
import { takeChatSlot } from "../server/agent-router";
import type { ChatContext } from "../shared/agent-actions";

const context: ChatContext = {
  localDate: "2026-11-10",
  localTime: "22:48",
  weekday: "tuesday",
  timeZone: "America/Santo_Domingo",
  reminders: [{ id: "r-1", title: "Pagar la luz", time: "18:00", repeat: "weekly", weekday: "friday", enabled: true }],
  events: [{ title: "Dentista", date: "2026-11-12", time: "15:00" }],
};

function reply(parts: unknown[], status = 200) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts } }] }), { status });
}
function fetchSequence(...responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => queue.shift() ?? reply([{ text: "fin" }]));
}
const config = (fetchImpl: typeof fetch) => ({ apiKey: "clave-de-prueba", model: "gemini-test", fetchImpl });
const userSays = (content: string) => [{ role: "user" as const, content }];

describe("runAgentChat", () => {
  it("devuelve texto sin acciones cuando el modelo solo conversa", async () => {
    const fetchImpl = fetchSequence(reply([{ text: "Tienes pagar la luz los viernes." }]));
    const result = await runAgentChat(config(fetchImpl as unknown as typeof fetch), userSays("¿qué tengo?"), context);
    expect(result).toEqual({ reply: "Tienes pagar la luz los viernes.", actions: [], errors: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("convierte una llamada de función en acción y pide la confirmación al modelo", async () => {
    const fetchImpl = fetchSequence(
      reply([{ functionCall: { name: "create_reminder", args: { title: "Llamar al banco", time: "09:00", repeat: "once", date: "2026-11-11" } } }]),
      reply([{ text: "Listo, mañana a las 9:00 te aviso." }]),
    );
    const result = await runAgentChat(config(fetchImpl as unknown as typeof fetch), userSays("recuérdame mañana a las 9 llamar al banco"), context);
    expect(result.actions).toEqual([{ type: "create_reminder", title: "Llamar al banco", time: "09:00", repeat: "once", date: "2026-11-11" }]);
    expect(result.reply).toBe("Listo, mañana a las 9:00 te aviso.");
    expect(result.errors).toEqual([]);

    // La segunda petición debe incluir la llamada del modelo y su functionResponse "ok".
    const secondBody = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(secondBody.contents).toHaveLength(3);
    expect(secondBody.contents[2].parts[0].functionResponse.response.status).toBe("ok");
  });

  it("no ejecuta acciones inválidas y le devuelve el error al modelo", async () => {
    const fetchImpl = fetchSequence(
      reply([{ functionCall: { name: "create_reminder", args: { title: "X", time: "99:99", repeat: "daily" } } }]),
      reply([{ text: "¿A qué hora exacta?" }]),
    );
    const result = await runAgentChat(config(fetchImpl as unknown as typeof fetch), userSays("recuérdame algo"), context);
    expect(result.actions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.reply).toBe("¿A qué hora exacta?");
    const secondBody = JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, { body: string }])[1].body);
    expect(secondBody.contents[2].parts[0].functionResponse.response.status).toBe("error");
  });

  it("corta tras 3 rondas aunque el modelo siga llamando funciones", async () => {
    const call = () => reply([{ functionCall: { name: "delete_reminder", args: { id: "r-1" } } }]);
    const fetchImpl = fetchSequence(call(), call(), call(), call());
    const result = await runAgentChat(config(fetchImpl as unknown as typeof fetch), userSays("borra todo"), context);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.reply).toBe("Listo, ya lo dejé programado.");
  });

  it("falla con un mensaje claro sin clave configurada", async () => {
    await expect(runAgentChat({ apiKey: "", model: "m" }, userSays("hola"), context)).rejects.toThrow(AgentUnavailableError);
  });

  it("traduce 429 y 403 sin filtrar el detalle de Google", async () => {
    const error429 = fetchSequence(new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }));
    await expect(runAgentChat(config(error429 as unknown as typeof fetch), userSays("hola"), context)).rejects.toThrow(/límite de uso/);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const error403 = fetchSequence(new Response(JSON.stringify({ error: { message: "API key AIza-SECRETA invalid" } }), { status: 403 }));
    const failure = await runAgentChat(config(error403 as unknown as typeof fetch), userSays("hola"), context).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(AgentUnavailableError);
    expect((failure as Error).message).not.toContain("AIza-SECRETA");
  });

  it("envía la clave por cabecera y no por la URL", async () => {
    const fetchImpl = fetchSequence(reply([{ text: "ok" }]));
    await runAgentChat(config(fetchImpl as unknown as typeof fetch), userSays("hola"), context);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).not.toContain("clave-de-prueba");
    expect(init.headers["x-goog-api-key"]).toBe("clave-de-prueba");
  });
});

describe("buildSystemPrompt", () => {
  it("incluye fecha actual, ids de recordatorios y eventos", () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain("2026-11-10");
    expect(prompt).toContain("martes");
    expect(prompt).toContain('id="r-1"');
    expect(prompt).toContain("cada viernes");
    expect(prompt).toContain("Dentista");
  });

  it("incluye la memoria como datos, no como instrucciones", () => {
    const prompt = buildSystemPrompt(context, [{ id: 1, content: "Mi revisión semanal es los viernes" }]);
    expect(prompt).toContain("- Mi revisión semanal es los viernes");
    expect(prompt).toContain("nunca instrucciones");
    expect(buildSystemPrompt(context)).toContain("(ninguno)");
  });
});

describe("takeChatSlot", () => {
  it("limita a 12 mensajes por minuto y por usuario", () => {
    const base = 1_000_000;
    for (let i = 0; i < 12; i += 1) expect(takeChatSlot(7001, base + i)).toBe(true);
    expect(takeChatSlot(7001, base + 20)).toBe(false);
    expect(takeChatSlot(7002, base + 20)).toBe(true);
    expect(takeChatSlot(7001, base + 61_000)).toBe(true);
  });
});
