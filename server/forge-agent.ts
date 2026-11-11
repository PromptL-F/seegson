import { callToAction, type AgentAction, type ChatContext, type ChatMessage, type ChatResult } from "../shared/agent-actions";
import type { InvokeParams, InvokeResult } from "./_core/llm";
import { AGENT_TOOL_DEFS, AgentUnavailableError, buildSystemPrompt, fallbackReply, type AgentMemory } from "./agent-tools";

export type InvokeFn = (params: InvokeParams) => Promise<InvokeResult>;

function textOf(content: InvokeResult["choices"][number]["message"]["content"] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * Proveedor basado en `invokeLLM` (servicio integrado de la plataforma, sin clave extra).
 * Hace una sola ronda: `invokeLLM` no reenvía `tool_calls`, así que la confirmación sale del
 * texto del modelo o, si no hay, de un mensaje de respaldo; la app añade además el resultado
 * real de cada acción en el chat.
 */
export async function runForgeChat(
  invoke: InvokeFn,
  messages: ChatMessage[],
  context: ChatContext,
  memories: AgentMemory[] = [],
): Promise<ChatResult> {
  let result: InvokeResult;
  try {
    result = await invoke({
      messages: [
        { role: "system", content: buildSystemPrompt(context, memories) },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
      ],
      tools: AGENT_TOOL_DEFS.map((definition) => ({ type: "function" as const, function: definition })),
      toolChoice: "auto",
      maxTokens: 800,
    });
  } catch (error) {
    console.error("[agent] invokeLLM falló:", error instanceof Error ? error.message : "error desconocido");
    throw new AgentUnavailableError("La IA no pudo responder ahora mismo. Inténtalo de nuevo.");
  }

  const message = result.choices?.[0]?.message;
  if (!message) throw new AgentUnavailableError("La IA devolvió una respuesta vacía. Inténtalo de nuevo.");

  const actions: AgentAction[] = [];
  const errors: string[] = [];
  for (const call of message.tool_calls ?? []) {
    let args: unknown = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      errors.push(`${call.function.name}: argumentos no válidos`);
      continue;
    }
    const parsed = callToAction(call.function.name, args);
    if (parsed.ok) actions.push(parsed.action);
    else errors.push(parsed.error);
  }

  const reply = textOf(message.content) || fallbackReply(actions, errors);
  return { reply, actions, errors };
}
