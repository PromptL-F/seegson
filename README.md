# Seegson

Seegson es una app Android con calendario, agenda de eventos, alarmas y un agente de tareas. Su identidad visual usa un fondo azul tinta con señales ámbar y turquesa, con un símbolo industrial retrofuturista inspirado en interfaces de ciencia ficción.

## Funciones incluidas

- Calendario mensual y agenda por fecha, con creación, edición, eliminación, categorías, estados, filtros y búsqueda en toda la agenda.
- Alarmas locales por evento; por ejemplo, un evento a las 16:00 puede llevar un aviso a las 00:00 del mismo día.
- Recordatorios diarios locales configurables.
- **Agente con IA** (pestaña *Agente*): se le escribe en lenguaje natural ("recuérdame el viernes a las 6 pagar la luz") y crea avisos de una vez, diarios o semanales, agrega eventos al calendario, pausa o borra recordatorios y responde qué hay pendiente. La IA corre en la nube; no se ejecuta ningún modelo en el teléfono.
- **Memoria persistente** por cuenta: con frases como “Recuerda que…” el agente guarda un dato y lo tiene en cuenta después; se puede olvidar desde el chat.
- Vigilancia programada del feed oficial de noticias de Arch Linux, deduplicación de entradas, historial de alertas y entrega Expo Push cuando el dispositivo esté registrado.
- Centro unificado para revisar y administrar alarmas, rutinas y vigilancia.

## Probar y desarrollar

```bash
pnpm dev
pnpm check
CI=true pnpm test
CI=true pnpm lint
CI=true pnpm build
```

`pnpm dev` inicia Metro y la API; abre la vista **Preview** del proyecto para probar la interfaz web. La vista web no prueba notificaciones Android. Para ejecutar la app en Expo Go o producir un APK/AAB, conecta una cuenta Expo desde el Dashboard del proyecto y usa allí la acción de build. No se generó ni se probó un APK durante esta sesión.

## Requisitos para las notificaciones reales

Las alarmas de eventos y los recordatorios diarios se programan como notificaciones locales. El usuario debe permitir notificaciones en Android y, según el dispositivo, revisar el acceso a alarmas exactas y la optimización de batería; Android o el fabricante pueden retrasarlas. El funcionamiento con la app cerrada debe confirmarse en un dispositivo Android real.

La vigilancia de Arch se ejecuta en el servidor mediante tareas programadas. Su ejecución continua requiere publicar la versión del servidor y registrar un token push Expo válido en un build Android conectado a un proyecto Expo. Sin esa conexión, las alertas guardadas se consultan desde la bandeja de Seegson, pero no se puede afirmar que llegue push al teléfono.

El preset vigila **Arch Linux News** (`https://archlinux.org/feeds/news/`): son noticias/comunicados oficiales, no cada actualización de paquete. Eventos y recordatorios diarios se guardan localmente en el dispositivo; no se sincronizan entre teléfonos.

## Agente con IA

El servidor llama a la IA con *function calling*: el modelo solo propone acciones y el servidor valida cada una (`shared/agent-actions.ts`) antes de enviarlas a la app, que las ejecuta como notificaciones locales. Si no se puede programar un aviso (permiso de notificaciones o hora ya pasada), el chat lo dice en lugar de fingir que quedó guardado.

Proveedor de IA (se elige solo, en este orden; las claves viven en el servidor, nunca en la app):

1. **Gemini**, si existe `GEMINI_API_KEY` (clave de Google AI Studio). `GEMINI_MODEL` es opcional y por defecto usa `gemini-flash-latest`.
2. **`invokeLLM`** del servicio integrado de la plataforma, con `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY`, que ya existen en el entorno publicado y no requieren configuración.

Con Gemini la IA puede encadenar varias rondas (por ejemplo, confirmar tras ejecutar); con `invokeLLM` hace una sola, porque ese cliente no reenvía `tool_calls`. En ambos casos la app muestra el resultado real de cada acción.

`agent.chat` exige sesión iniciada y limita a 12 mensajes por minuto por usuario. La conversación se guarda en el teléfono; la memoria, en la base de datos (`0003_seegson_agent_memory.sql`). La tabla `agent_messages` de esa migración ya no la usa el chat.

## Verificación de esta versión

- `pnpm check`: correcto.
- `CI=true pnpm test`: 63 aprobadas, 1 omitida preexistente (incluye el contrato de acciones, la memoria y ambos proveedores de IA con respuestas simuladas).
- `CI=true pnpm lint`: correcto.
- `CI=true pnpm build` y `expo export --platform web`: correctos.
- **No verificado**: llamadas reales a Gemini o a `invokeLLM`, comportamiento del teclado en un Android físico y entrega de notificaciones con la app cerrada.
