# Plano de control de transferencias — OACLIX

Fecha: 2026-09-15
Estado: Paso 1 en desarrollo; checkpoints online + solicitud offline implementados en `feat/transfer-control-plane`, pendientes de CI final y prueba integrada.

## Objetivo

Separar la coordinación de una transferencia de los bytes reales. Cloudflare puede coordinar quién quiere enviar, quién recibe y si acepta, pero este canal no debe transportar texto, imagen ni archivo como payload.

## Checkpoint 1 — control online

- contrato compartido `transfer-request` / `transfer-decision` / `transfer-cancel`;
- destino explícito por `deviceId`;
- metadatos mínimos: tipo de contenido, tamaño y vigencia;
- validación de dirección: solo el emisor crea la solicitud y solo el receptor decide;
- cualquiera de los dos extremos puede cancelar su solicitud;
- mensajes de control limitados a 2 KiB y con claves exactas para impedir usar este camino como relay encubierto de contenido;
- `RealtimeHub` reenvía `transfer-control` únicamente a otro dispositivo de la misma identidad;
- `RealtimeSignalClient` envía/recibe este control por un bus separado de los payloads de texto e imagen;
- el camino viejo continúa disponible durante la migración y no se elimina hasta tener reemplazo probado.

## Checkpoint 2 — receptor temporalmente offline

- solo `transfer-request` puede quedar pendiente; nunca se persisten bytes, texto, imagen, archivo, nombre de archivo ni payload de usuario;
- las solicitudes pendientes viven en el Durable Object SQLite ya existente para la sala, no en R2 ni en un servicio nuevo;
- TTL de solicitud: máximo 5 minutos, con tolerancia máxima de reloj de 60 segundos;
- solicitudes expiradas o demasiado futuras se descartan usando hora del servidor;
- límite duro: máximo 32 solicitudes pendientes por sala y 8 por receptor;
- `requestId` es idempotente y una colisión no puede cambiar identidad/destino;
- al reconectar el receptor se reentregan únicamente sus solicitudes vivas y de su `personId`;
- una decisión o cancelación válida retira la solicitud pendiente; la resolución está ligada al `personId` autenticado;
- al desvincular un dispositivo se eliminan solicitudes donde ese `deviceId` participa;
- una alarma del Durable Object limpia expirados aunque ningún dispositivo vuelva a abrir la sala.

## Privacidad

El plano de control conoce solo lo necesario para coordinar: IDs técnicos, tipo general de contenido, tamaño, timestamps y estado. No debe recibir contenido del portapapeles ni datos privados. Rige además `SECURITY.md`: ningún secreto, hostname privado, endpoint interno, credencial ni contenido real de usuario puede publicarse en el repositorio.

## Regla de costo

No se activa R2, TURN, SFU ni ningún producto nuevo. `REALTIME` ya usa Durable Objects con almacenamiento SQLite según `wrangler.jsonc`.

Verificado contra documentación oficial de Cloudflare el 2026-09-15:

- Durable Objects está disponible en Workers Free con SQLite;
- en Workers Free, al superar un límite gratuito las operaciones de ese tipo fallan en vez de generar sobrecargo automático;
- límites publicados relevantes: 100,000 solicitudes DO/día, 5,000,000 filas leídas/día, 100,000 filas escritas/día y 5 GB de almacenamiento total;
- `setAlarm()` cuenta como una fila escrita.

Fuentes públicas: `https://developers.cloudflare.com/durable-objects/platform/pricing/` y `https://developers.cloudflare.com/durable-objects/platform/limits/`.

Los límites de cola y la expiración corta existen también para evitar consumo innecesario. Si el plan de Cloudflare cambia, estas condiciones deben volver a verificarse antes de activar o ampliar esta función.

## Todavía pendiente dentro del Paso 1

1. separar explícitamente los estados `dispositivo conocido`, `online`, `solicitud pendiente` y `canal de datos disponible`;
2. conectar `accepted` con una interfaz mínima para el futuro Route Manager, sin mover bytes todavía;
3. decidir el comportamiento cuando el receptor responde y el emisor ya está offline; no se debe fingir que la transferencia comenzó;
4. retirar el relay viejo de contenido por WebSocket únicamente cuando la ruta nueva tenga sustituto probado.

## Siguiente checkpoint exacto

Crear un modelo de estado independiente que no confunda que un dispositivo esté vinculado/online con que exista un canal de datos. Después, `accepted` entregará una intención al futuro Route Manager; todavía sin cambiar el transporte real.
