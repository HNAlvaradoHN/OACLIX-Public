# Transfer Engine — OACLIX

Fecha: 2026-09-16
Estado: Paso 2 en desarrollo sobre `feat/transfer-engine`, dependiente del Paso 1 (`feat/transfer-control-plane`). Checkpoint 1 pasó CI #119; Checkpoint 2 pasó CI #120; Checkpoint 3 pasó CI #122.

## Objetivo

Mover texto, imágenes y archivos con un motor independiente del transporte. El motor no decide si la ruta es LAN, WebRTC, Wi-Fi Direct, Internet directo o relay: define cómo describir, verificar, reanudar y preparar una operación antes de entregarla al futuro Route Manager.

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

## Privacidad y seguridad

- ningún payload nuevo viaja por el WebSocket de control;
- manifest, journal, `sourceRef` y Route Intent contienen únicamente metadata técnica necesaria;
- no se introducen secrets, hostnames privados, nombres reales de archivos, rutas/URI privadas ni contenido del portapapeles;
- rige `SECURITY.md`;
- hashes dan integridad, no confidencialidad; E2E pertenece a la capa de ruta.

## Costo

Todo lo anterior es lógica y almacenamiento local. No activa R2, TURN, SFU, almacenamiento cloud nuevo ni servicios facturables.

## No sustituye todavía

- relay legacy de texto/imágenes;
- DataChannel de imágenes existente;
- control plane del Paso 1;
- Android wake/background;
- selección de ruta.

## Siguiente checkpoint exacto

Checkpoint 4: registrar la fuente antes de emitir `transfer-request`, correlacionarla por `requestId`, recuperarla tras autoaceptación y entregar la operación preparada a una interfaz mínima del Route Manager. Durante este checkpoint el flujo nuevo debe permanecer en migración controlada: no retirar ni sustituir las rutas legacy que todavía entregan los bytes hasta que el nuevo data plane tenga un reemplazo probado.
