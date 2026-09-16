# Plano de control de transferencias — OACLIX

Fecha: 2026-09-15
Estado: Paso 1 en desarrollo; control online, solicitud offline, disponibilidad separada y handoff `accepted -> Route Intent` implementados en `feat/transfer-control-plane`. PR en draft hasta CI y validación integrada.

## Objetivo

Separar la coordinación de una transferencia de los bytes reales. Cloudflare puede coordinar quién quiere enviar, quién recibe y el estado de la solicitud, pero este canal no debe transportar texto, imagen ni archivo como payload.

## Requisito de experiencia — dispositivos propios confiables

OACLIX debe permitir enviar a un dispositivo propio ya vinculado sin pedir confirmación manual en el receptor, siguiendo la experiencia útil observada en Blip:

- un dispositivo que ya pertenece a la misma identidad confiable autoacepta la solicitud;
- `transfer-decision: accepted` sigue existiendo como señal interna, no como diálogo obligatorio para el usuario;
- la aprobación manual pertenece al proceso de vinculación/confianza de un dispositivo nuevo o no confiable, no a cada transferencia;
- que la app receptora esté cerrada no cambia este requisito: una etapa posterior de Android debe despertar de forma ligera el receptor, procesar la solicitud y levantar el transporte solo durante la transferencia;
- autoaceptar no significa mantener WebRTC ni otro transporte pesado vivo permanentemente;
- ningún flujo puede autoaceptar un peer que no haya sido autenticado como perteneciente a la misma identidad confiable.

`transferAcceptancePolicy.ts` deja fijada esta frontera: solo un contexto autenticado y marcado como misma identidad confiable puede producir automáticamente `accepted`. El wake de app cerrada todavía no se implementa en este checkpoint.

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

## Checkpoint 3 — disponibilidad sin mezclar conceptos

`deviceAvailability.ts` mantiene por separado cuatro hechos que antes quedaban comprimidos en una sola etiqueta de ruta:

1. `linked`: el dispositivo existe en el roster autorizado;
2. `presence`: `unknown`, `online` u `offline` según presence del plano de control;
3. `dataChannel`: `available` solo cuando existe un canal de datos validado;
4. `pendingTransfer`: solicitud de transferencia observada y todavía viva.

Reglas:

- estar vinculado no implica estar online;
- estar online no implica tener DataChannel;
- tener una solicitud pendiente no crea ni simula un canal de datos;
- un DataChannel validado puede seguir disponible aunque se pause temporalmente la señalización;
- solicitudes pendientes locales expiran por `expiresAt` y no contienen bytes;
- `linkedDeviceAuthorization` publica el roster conocido en este modelo;
- `lanStatus` publica presence y DataChannel, pero conserva `getDeviceRouteStatus()` como wrapper de compatibilidad para no reescribir la UI de golpe;
- `transferControlBus` publica/retira el estado pendiente únicamente cuando el mensaje de control fue enviado o recibido.

Este checkpoint cambia el modelo interno, no la UX ni el transporte de datos existente.

## Checkpoint 4 — `accepted` produce Route Intent, no una transferencia

`transferRouteIntent.ts` introduce el handoff mínimo hacia el futuro Route Manager:

- cuando una `transfer-request` sale correctamente, se conserva únicamente su metadata de control en memoria del emisor;
- un `transfer-decision: accepted` válido del receptor puede producir un `route-intent`;
- el intent conserva `requestId`, emisor, receptor, tipo general, tamaño y vigencia, pero no contiene payload ni elige transporte;
- `rejected`, `busy`, cancelación o solicitud vencida cierran el control sin producir intent;
- una respuesta de otro dispositivo no puede consumir la solicitud rastreada;
- si el emisor reinició/perdió su solicitud local o ya está fuera de vigencia, un `accepted` no produce intent: OACLIX no finge que la transferencia comenzó;
- el futuro Route Manager se conectará mediante `subscribeTransferRouteIntent()` y decidirá LAN/WebRTC/Wi-Fi Direct/remoto según disponibilidad real.

Este comportamiento resuelve la regla del caso emisor offline a nivel de estado: `accepted` por sí solo nunca equivale a “transfiriendo”. Si el emisor ya no conserva una solicitud viva, debe reintentar/recrear control cuando vuelva a estar disponible; los bytes no se mueven en este checkpoint.

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

1. conectar la política de autoaceptación confiable al flujo autenticado real sin abrir una vía de autoaceptación para peers no confiables;
2. hacer una prueba integrada del flujo completo `request -> autoaccepted -> route-intent`, todavía sin bytes;
3. definir el retry de control cuando el emisor desaparece antes de recibir `accepted`;
4. retirar el relay viejo de contenido por WebSocket únicamente cuando la ruta nueva tenga sustituto probado.

## Siguiente checkpoint exacto

Conectar autoaceptación únicamente después de que `RealtimeSignalClient` haya validado que el mensaje llegó por la sesión autenticada de la misma identidad. Después verificar de extremo a extremo que un dispositivo propio recibe `transfer-request`, genera `accepted` internamente y el emisor obtiene un único `route-intent`, sin seleccionar transporte ni mover contenido.
