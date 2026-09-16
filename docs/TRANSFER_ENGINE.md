# Transfer Engine — OACLIX

Fecha: 2026-09-16
Estado: Paso 2 en desarrollo sobre `feat/transfer-engine`, dependiente del Paso 1 (`feat/transfer-control-plane`). Checkpoint 1 pasó CI #119; Checkpoint 2 pasó CI #120; Checkpoint 3 pasó CI #122; Checkpoint 4 pasó CI #124; Checkpoint 5 está implementado y pendiente de gate CI.

## Objetivo

Mover texto, imágenes y archivos con un motor independiente del transporte. El motor no decide por sí solo cómo implementar LAN, WebRTC, Wi-Fi Direct, Internet directo o relay: define cómo describir, verificar, reanudar y preparar una operación antes de entregarla al Route Manager.

## Experiencia ya decidida

Un dispositivo propio ya vinculado/confiable recibe sin pedir confirmación manual por cada transferencia. Que la app receptora esté cerrada tampoco debe cambiar esa experiencia; Android wake deberá despertar el receptor de forma ligera y temporal. El diseño no mantiene WebRTC u otro transporte pesado vivo permanentemente.

## Checkpoint 1 — manifest, chunks, hashes y journal ✅

`src/transfer/transferManifest.ts` y `src/transfer/transferJournal.ts` establecen:

- correlación `requestId` + `transferId`;
- chunks lógicos de **4 MiB**, independientes del tamaño de frame de red;
- SHA-256 por chunk y SHA-256 canónico del manifest;
- hashing de un chunk a la vez;
- journal sender/receiver ligado al hash exacto del manifest;
- progreso por rangos compactos, idempotencia y rangos faltantes para resume;
- prohibición de marcar `complete` mientras falten chunks;
- cero payload, base64, texto, imagen o nombre de archivo dentro de manifest/journal.

Gate: CI #119 verde en tests, lint, build, auditoría pública, Web/Worker y Android.

## Checkpoint 2 — persistencia local reanudable ✅

`src/transfer/transferStateStore.ts` persiste en IndexedDB local únicamente metadata técnica reanudable:

- base separada `oaclix-transfer-engine`, store `operations`;
- antes de restaurar se verifica hash del manifest y coherencia del journal;
- solo estados `prepared` / `transferring` son reanudables;
- estado inactivo >24 h o de más de 7 días se depura;
- timestamps futuros fuera de tolerancia se rechazan;
- entradas corruptas, vencidas o con key distinta del `transferId` se eliminan;
- existe borrado explícito por transferencia y limpieza total;
- no almacena bytes del archivo dentro del journal.

Gate: CI #120 verde en Web/Worker y Android.

## Checkpoint 3 — Route Intent → operación preparada ✅

### Fuente de chunks

`src/transfer/transferChunkSource.ts` separa el origen del contenido del motor:

- una fuente declara `contentKind`, `byteSize` y cómo abrir el `Blob` local;
- una fuente temporal puede tener `reference: null` y solo vivir durante la sesión;
- una fuente local reabrible usa una referencia técnica cerrada `{ version, provider, itemId }`;
- por ahora solo se aceptan providers `local-text` y `local-image`;
- la referencia no incluye nombre de archivo, ruta, URI, texto, imagen, base64 ni payload.

`src/data/transferSourceProviders.ts` adapta los almacenes locales actuales:

- texto local se reabre por `itemId` y calcula tamaño real en bytes UTF-8;
- imagen local reutiliza el Blob privado ya persistido por OACLIX;
- si el item venció o desapareció, la fuente no se puede reabrir y la transferencia debe fallar cerrado.

### Preparación tras aceptación

`src/transfer/transferOperationCoordinator.ts` conecta el `Route Intent` del Paso 1 con el Transfer Engine:

1. recibe un `Route Intent` ya aceptado internamente;
2. exige que tipo y tamaño de la fuente coincidan exactamente con la solicitud aceptada;
3. rechaza intents vencidos o con reloj inválido;
4. abre la fuente local;
5. construye manifest + hashes;
6. crea journal `sender` en estado `prepared`;
7. persiste manifest/journal y, cuando existe, solo la referencia local técnica;
8. recién después publica la operación preparada al siguiente componente.

`sourceRef` queda ligado al tipo real del manifest (`local-text`→`text`, `local-image`→`image`) para impedir restauraciones ambiguas o manipuladas.

**Este checkpoint todavía no elige transporte ni envía bytes.** `accepted` sigue significando “autorizado para preparar”, no “transferencia iniciada”.

Gate: CI #122 verde en tests, lint, build, auditoría pública, Web/Worker y Android sobre `f95db68a6580b86abe2a9ec6653df565507e20f9`.

## Checkpoint 4 — solicitud real → fuente correlacionada → Route Manager ✅

`src/transfer/transferSendCoordinator.ts` conecta el flujo real de solicitud con la operación preparada sin convertir el plano de control en transporte de datos:

1. abre/valida la fuente y calcula su tamaño real;
2. registra la fuente localmente **antes** de emitir `transfer-request`;
3. correlaciona fuente y solicitud por `requestId`, emisor, receptor, tipo, tamaño y vigencia;
4. aplica límites de 32 pendientes por sala y 8 por receptor para evitar acumulación;
5. ante `accepted`, consume exactamente la fuente correlacionada y entrega el `Route Intent` al Transfer Engine;
6. el Transfer Engine persiste manifest/journal/sourceRef antes de publicar la operación preparada;
7. recién entonces `PreparedTransferRouteManager` recibe la operación;
8. rechazo, cancelación, fallo al emitir control o expiración limpian la fuente pendiente.

Gate: CI #124 verde en auditoría pública, tests, lint, build, Web/Worker y Android sobre `ce924536ac7879f552f7612fd9f5c23c6a00fcba`.

## Checkpoint 5 — Route Manager → selección de ruta

`src/transfer/transferRouteManager.ts` introduce una decisión explícita separada del movimiento de bytes:

- `PreparedTransferRouteManager` devuelve una `TransferRouteSelection` técnica;
- antes de seleccionar, verifica que manifest y journal sean válidos, que el journal siga en `sender/prepared` y que manifest e intent coincidan;
- la presencia `online` por sí sola no se considera una ruta de datos;
- `local-direct` solo es elegible cuando existe un DataChannel validado hacia el receptor;
- el adaptador local existente solo cubre texto e imagen, por lo que archivos quedan `unavailable` aunque exista DataChannel;
- esa restricción se aplica también si un resolver de disponibilidad defectuoso intenta declarar `localDirect: true` para archivos;
- la selección contiene solo IDs/tipo/estado/ruta/timestamp; no incluye payload ni `sourceRef`;
- seleccionar una ruta **no** invoca `sendLocalClipboardTextDirect`, `sendLocalImageDirect`, relay, WebSocket de payload ni ningún envío de bytes.

Gate pendiente: auditoría pública, tests, lint, build, Web/Worker y Android.

## Privacidad y seguridad

- ningún payload nuevo viaja por el WebSocket de control;
- manifest, journal, `sourceRef`, Route Intent y Route Selection contienen únicamente metadata técnica necesaria;
- la correlación pendiente mantiene la fuente solo en memoria de la sesión hasta que se acepta, rechaza, cancela, vence o falla el envío;
- no se introducen secrets, hostnames privados, nombres reales de archivos, rutas/URI privadas ni contenido del portapapeles en metadata técnica;
- rige `SECURITY.md`;
- hashes dan integridad, no confidencialidad; E2E pertenece a la capa de ruta.

## Costo

Todo lo anterior es lógica y almacenamiento local. No activa R2, TURN, SFU, almacenamiento cloud nuevo ni servicios facturables.

## No sustituye todavía

- relay legacy de texto/imágenes;
- DataChannel de texto/imágenes existente como data plane;
- control plane del Paso 1;
- Android wake/background;
- movimiento de bytes del nuevo data plane.

## Siguiente checkpoint exacto

Después de CI verde del Checkpoint 5: crear un adaptador controlado para `local-direct` que consuma chunks del Transfer Engine y use el transporte local existente, empezando por una sola superficie (texto o imagen). Mantener el camino legacy intacto hasta demostrar equivalencia, integridad y fallback seguro; recién después considerar sustitución.
