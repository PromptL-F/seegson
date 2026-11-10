# Seegson — gestor de eventos

Seegson es una app Android con calendario, agenda de eventos, alarmas y un agente de tareas. Su identidad visual usa un fondo azul tinta con señales ámbar y turquesa; el icono propio combina calendario y reloj.

## Funciones incluidas

- Calendario mensual y agenda por fecha, con creación, edición, eliminación, categorías, estados, filtros y búsqueda en toda la agenda.
- Alarmas locales por evento; por ejemplo, un evento a las 16:00 puede llevar un aviso a las 00:00 del mismo día.
- Recordatorios diarios locales configurables.
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

## Verificación de esta versión

- `pnpm check`: correcto.
- `CI=true pnpm test`: 31 aprobadas, 1 omitida preexistente.
- `CI=true pnpm lint`: correcto.
- `CI=true pnpm build`: correcto.
- Expo resolvió el icono, el plugin de notificaciones, el paquete Android y los permisos configurados.
- Metro (8081) y API (3000) respondieron correctamente; falta la validación física de notificaciones y del recorrido push autenticado.
