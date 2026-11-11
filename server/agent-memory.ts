/**
 * Detecta "recuerda que …" como una orden de guardar un dato en la memoria.
 * "Recuérdame / recuerdame …" NO entra aquí: eso es un pedido de aviso y lo gestiona el agente.
 */
export function memoryFromMessage(message: string): string | null {
  const match = message
    .trim()
    .match(/^(?:recuerda|acu[eé]rdate|remember)\s+(?:de\s+que|que|that)\s*[:\-]?\s*(.+)$/is);
  const content = match?.[1]?.trim().replace(/[.!?]+$/, "");
  return content && content.length >= 3 ? content.slice(0, 1000) : null;
}
