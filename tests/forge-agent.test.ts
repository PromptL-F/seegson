import { describe, expect, it, vi } from "vitest";
import { AgentUnavailableError } from "../server/agent-tools";
import { runForgeChat } from "../server/forge-agent";
import { runChatProvider } from "../server/agent-router";
import { ENV } from "../server/_core/env";
import type { ChatContext } from "../shared/agent-actions";
import type { InvokeResult } from "../server/_core/llm";

const context: ChatContext = { localDate: "2026-11-10", localTime: "22:48", weekday: "tuesday", timeZone: "UTC", reminders: [], events: [] };
const userSays = (content: string) => [{ role: "user" as const, content }];

function llm(message: Partial<InvokeResult["choices"][number]["message"]>): InvokeResult {
  return { id: "x", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "", ...message } }] };
}
const toolCall = (name: string, args: unknown) => ({ id: "c1", type: "function" as const, function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });

describe("runForgeChat", () => {
  it("convierte tool_calls en acciones validadas", async () => {
    const invoke = vi.fn(async () => llm({ content: "Listo, mañana a las 9:00.", tool_calls: [toolCall("create_reminder", { title: "Llamar al banco", time: "09:00", repeat: "once", date: "2026-11-11" })] }));
    const result = await runForgeChat(invoke, userSays("recuérdame mañana a las 9 llamar al banco"), context);
    expect(result.actions).toEqual([{ type: "create_reminder", title: "Llamar al banco", time: "09:00", repeat: "once", date: "2026-11-11" }]);
    expect(result.reply).toBe("Listo, mañana a las 9:00.");
    const params = invoke.mock.calls[0] as unknown as [{ tools: unknown[]; messages: { role: string }[] }];
    expect(params[0].tools).toHaveLength(4);
    expect(params[0].messages[0].role).toBe("system");
  });

  it("usa un texto de respaldo si el modelo solo llama la función", async () => {
    const invoke = vi.fn(async () => llm({ content: "", tool_calls: [toolCall("create_reminder", { title: "Tomar agua", time: "10:00", repeat: "daily" })] }));
    const result = await runForgeChat(invoke, userSays("avísame cada día a las 10 tomar agua"), context);
    expect(result.reply).toBe("Listo, ya lo dejé programado.");
  });

  it("descarta argumentos rotos o inválidos sin lanzar", async () => {
    const invoke = vi.fn(async () => llm({ content: "", tool_calls: [toolCall("create_reminder", "{no es json"), toolCall("create_reminder", { title: "x", time: "99:00", repeat: "daily" })] }));
    const result = await runForgeChat(invoke, userSays("hola"), context);
    expect(result.actions).toEqual([]);
    expect(result.errors).toHaveLength(2);
  });

  it("traduce fallos del proveedor a un error claro sin filtrar detalles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const invoke = vi.fn(async () => { throw new Error("secreto-interno"); });
    const failure = await runForgeChat(invoke, userSays("hola"), context).catch((e: Error) => e);
    expect(failure).toBeInstanceOf(AgentUnavailableError);
    expect((failure as Error).message).not.toContain("secreto-interno");
  });
});

describe("runChatProvider", () => {
  it("falla con un mensaje claro si no hay ninguna clave", () => {
    const saved = { g: ENV.geminiApiKey, f: ENV.forgeApiKey };
    ENV.geminiApiKey = "";
    ENV.forgeApiKey = "";
    try {
      expect(() => runChatProvider(userSays("hola"), context, [])).toThrow(/GEMINI_API_KEY/);
    } finally {
      ENV.geminiApiKey = saved.g;
      ENV.forgeApiKey = saved.f;
    }
  });
});
