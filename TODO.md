# Seegson — resultados de implementación

Dirección visual aplicada: agenda móvil de precisión con aire retrofuturista editorial; fondo azul tinta, señales ámbar para alarmas y acentos turquesa para eventos; jerarquía tipográfica clara, navegación inferior y controles cómodos con una mano. La identidad visual debe sentirse técnica, serena y legible, no como un panel recargado.

## Calendario y eventos
- [x] El calendario ofrece vistas de mes y agenda, y marca visualmente los días que tienen eventos.
- [x] Se pueden crear, editar y eliminar eventos con título, fecha, hora, descripción y estado.
- [x] Los eventos se pueden organizar por categorías, buscar en toda la agenda y filtrar por fecha y por cada estado: programado, completado o cancelado.

## Alarmas y avisos de eventos
- [x] Cada evento admite una alarma configurable para un momento elegido por la persona usuaria.
- [x] La regla de inicio del día permite configurar el evento de ejemplo para que, si ocurre el sábado 28 de diciembre a las 16:00, la alarma y el recordatorio suenen a las 00:00 de ese mismo día.
- [ ] Las alarmas y recordatorios de eventos se entregan como notificaciones locales de Android aunque Seegson no esté abierta, con permisos y restricciones del sistema explicados cuando corresponda. Código integrado; pendiente comprobar la entrega real en un dispositivo Android.

## Agente y tareas programadas
- [x] Seegson permite crear y administrar tareas recurrentes que se ejecutan cada día a una hora elegida y producen una notificación local.
- [x] La aplicación se llama exactamente “Seegson” y el icono/mark usa una señal industrial retrofuturista propia, inspirada en la estética de Seegson sin copiar un logotipo externo.
- [x] El agente ofrece un chat con IA remota mediante `invokeLLM`; el modelo se ejecuta en el servidor y no se instala ni ejecuta localmente en Android.
- [x] El agente conserva memoria por cuenta cuando la persona escribe una instrucción explícita como “Recuerda que…”, muestra el recuerdo más reciente y permite olvidarlo.
- [x] El formulario de tareas se adapta al teclado mediante `KeyboardAvoidingView`, scroll anidado y ajustes automáticos de insets para evitar que el teclado cubra los campos.
- [x] El agente crea recordatorios (una vez, diarios, semanales) y eventos desde el chat con IA; las acciones se validan en el servidor y se ejecutan como notificaciones locales. Pendiente comprobar la entrega real en un Android y una llamada real al proveedor de IA.
- [ ] Se puede configurar una tarea condicional para detectar novedades externas y notificar cuando aparezcan; el caso inicial de Arch vigila el feed oficial de noticias de Arch Linux, avisa por las entradas nuevas desde la última revisión, recupera las entradas disponibles si el cursor antiguo ya no aparece y evita repetir avisos sobre entradas ya notificadas. Implementación y pruebas listas; falta publicar el servidor y vincular Expo para confirmar el push en un teléfono.
- [x] La tarea de agente permite activarse, desactivarse, reprogramarse o eliminarse.

## Panel de avisos
- [x] Un panel reúne alarmas de eventos y tareas del agente para consultar su estado y administrarlas: activar, desactivar, reprogramar o eliminar.

## Entrega móvil
- [x] La aplicación se llama Seegson, mantiene los identificadores Android/Expo generados por el starter y tiene iconografía propia cuadrada, sin esquinas redondeadas incorporadas en el archivo de launcher.
- [x] La interfaz principal y los flujos de edición se presentan en español y están diseñados para uso vertical con una mano.
