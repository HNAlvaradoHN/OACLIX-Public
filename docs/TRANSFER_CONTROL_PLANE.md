# Plano de control de transferencias — OACLIX

Fecha: 2026-09-15
Estado: Paso 1 en desarrollo; control online, solicitud offline, disponibilidad separada, autoaceptación confiable, handoff `accepted -> Route Intent` y retry de control implementados en `feat/transfer-control-plane`. PR en draft hasta CI final y cierre del gate integrado.

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

`transferAcceptancePolicy.ts` fija esta frontera y `RealtimeSignalClient` solo invoca la autoaceptación después de validar el frame `transfer-control` recibido por la sesión autenticada. El wake del proceso Android cuando la app está cerrada pertenece al paso posterior de background/wake; este plano ya puede conservar la solicitud mientras el receptor está offline.

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

## Checkpoint 5 — reconexión del emisor sin falso inicio

Si el emisor pierde temporalmente el WebSocket antes de recibir `accepted`:

- las solicitudes salientes todavía vivas permanecen rastreadas en memoria mientras el proceso siga existiendo;
- cuando `RealtimeSignalClient` recibe un nuevo `ready` autenticado, `retryTrackedTransferRequests()` reenvía solo esas solicitudes vivas;
- una solicitud vencida se depura y no se reintenta;
- reintentar conserva el mismo `requestId`, por lo que el control sigue siendo idempotente;
- si el proceso del emisor fue terminado y perdió el estado en memoria, no se inventa continuidad: una capa durable posterior (Transfer Engine/journal) deberá recrear la operación si corresponde.

Esto resuelve el corte breve de red sin convertir `accepted` en “transfiriendo”. La continuidad durable de bytes pertenece al Transfer Engine, no al plano de control.

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

## Gate para cerrar el Paso 1

Antes de declarar el Paso 1 concluido deben quedar verdes las verificaciones que demuestran:

1. `request -> autoaccepted -> route-intent` produce un único intent y cero bytes por el nuevo plano de control;
2. un peer no confiable no puede usar la política de autoaceptación;
3. una respuesta de otro dispositivo, solicitud vencida o emisor sin solicitud viva no inicia nada;
4. una reconexión reintenta solo solicitudes vivas;
5. Web/Worker, lint, build, auditoría pública y Android siguen verdes.

El relay antiguo de contenido permanece durante la migración y se retirará únicamente cuando los siguientes pasos tengan un transporte sustituto probado. El wake Android con app cerrada también queda explícitamente pendiente para el paso de background/wake; no debe confundirse con un fallo de este contrato de control.

## Siguiente paso exacto

Una vez verde el gate anterior, cerrar el Paso 1 como base del nuevo plano de control y comenzar el Paso 2: Transfer Engine independiente del transporte (manifest/chunks, hashes, journal, retry/resume e integridad), sin conectar todavía grandes payloads al WebSocket de control.
