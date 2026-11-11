import { callToAction, type AgentAction, type ChatContext, type ChatMessage, type ChatResult } from "../shared/agent-actions";
import { AGENT_TOOL_DEFS, AgentUnavailableError, buildSystemPrompt, fallbackReply, type AgentMemory } from "./agent-tools";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ROUNDS = 3;
const REQUEST_TIMEOUT_MS = 25_000;

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: Record<string, unknown> };
  [key: string]: unknown;
};
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiResponse = {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

export type GeminiConfig = {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
};

const TOOLS = [{ functionDeclarations: AGENT_TOOL_DEFS }];

async function callGemini(
  config: GeminiConfig,
  systemPrompt: string,
  contents: GeminiContent[],
): Promise<GeminiContent> {
  const fetchImpl = config.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${GEMINI_ENDPOINT}/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: TOOLS,
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AgentUnavailableError("No se pudo contactar con la IA. Revisa la conexión e inténtalo de nuevo.");
  }

  const body = (await response.json().catch(() => ({}))) as GeminiResponse;
  if (!response.ok) {
    if (response.status === 429) {
      throw new AgentUnavailableError("La IA alcanzó su límite de uso por ahora. Prueba de nuevo en un minuto.");
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      // No se reenvía el mensaje de Google: puede mencionar la clave o la configuración del proyecto.
      console.error("[agent] Gemini rechazó la petición:", response.status, body.error?.message);
      throw new AgentUnavailableError("La clave de la IA no es válida o no tiene permiso. Revisa GEMINI_API_KEY en el servidor.");
    }
    console.error("[agent] Gemini error:", response.status, body.error?.message);
    throw new AgentUnavailableError("La IA no pudo responder ahora mismo. Inténtalo de nuevo.");
  }

  if (body.promptFeedback?.blockReason) {
    throw new AgentUnavailableError("La IA no pudo procesar ese mensaje. Prueba a decirlo de otra forma.");
  }
  const content = body.candidates?.[0]?.content;
  if (!content || !Array.isArray(content.parts)) {
    throw new AgentUnavailableError("La IA devolvió una respuesta vacía. Inténtalo de nuevo.");
  }
  return content;
}

export async function runAgentChat(
  config: GeminiConfig,
  messages: ChatMessage[],
  context: ChatContext,
  memories: AgentMemory[] = [],
): Promise<ChatResult> {
  if (!config.apiKey) {
    throw new AgentUnavailableError("El agente de IA no está configurado: falta GEMINI_API_KEY en el servidor.");
  }

  const systemPrompt = buildSystemPrompt(context, memories);
  const contents: GeminiContent[] = messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  const actions: AgentAction[] = [];
  const errors: string[] = [];
  let reply = "";

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const modelContent = await callGemini(config, systemPrompt, contents);
    const text = modelContent.parts
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    const calls = modelContent.parts.filter((part) => part.functionCall);

    if (calls.length === 0) {
      reply = text;
      break;
    }

    // Se conserva el contenido tal cual lo devolvió el modelo (incluye firmas de razonamiento).
    contents.push(modelContent);
    const responses: GeminiPart[] = calls.map((part) => {
      const call = part.functionCall!;
      const result = callToAction(call.name, call.args);
      if (result.ok) {
        actions.push(result.action);
        return { functionResponse: { name: call.name, response: { status: "ok" } } };
      }
      errors.push(result.error);
      return { functionResponse: { name: call.name, response: { status: "error", message: result.error } } };
    });
    contents.push({ role: "user", parts: responses });
    reply = text;
  }

  if (!reply) reply = fallbackReply(actions, errors);

  return { reply, actions, errors };
}
