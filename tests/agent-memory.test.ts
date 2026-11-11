import { describe, expect, it } from "vitest";
import { memoryFromMessage } from "../server/agent-memory";

describe("memoryFromMessage", () => {
  it("guarda 'recuerda que …' como dato", () => {
    expect(memoryFromMessage("Recuerda que mi revisión semanal es los viernes")).toBe("mi revisión semanal es los viernes");
    expect(memoryFromMessage("acuérdate de que mi hermano se llama Luis.")).toBe("mi hermano se llama Luis");
    expect(memoryFromMessage("remember that I prefer mornings")).toBe("I prefer mornings");
  });

  it("no confunde un pedido de aviso con memoria", () => {
    expect(memoryFromMessage("recuérdame mañana a las 9 llamar al banco")).toBeNull();
    expect(memoryFromMessage("recuerdame mañana a las 9 llamar al banco")).toBeNull();
    expect(memoryFromMessage("avísame el viernes a las 6")).toBeNull();
  });

  it("ignora contenido vacío o demasiado corto", () => {
    expect(memoryFromMessage("recuerda que")).toBeNull();
    expect(memoryFromMessage("recuerda que a")).toBeNull();
  });

  it("limita la longitud", () => {
    expect(memoryFromMessage(`recuerda que ${"x".repeat(2000)}`)?.length).toBe(1000);
  });
});
