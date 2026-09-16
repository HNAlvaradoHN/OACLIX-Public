# Transfer Engine — OACLIX

Fecha: 2026-09-16
Estado: Paso 2 en desarrollo sobre `feat/transfer-engine`, dependiente del Paso 1 (`feat/transfer-control-plane`). Checkpoints 1–9 pasaron CI #119, #120, #122, #124, #126, #130, #132, #134 y #140.

## Objetivo

Mover texto, imágenes y archivos con un motor independiente del transporte. El motor describe, verifica, reanuda y prepara operaciones antes de entregarlas al Route Manager y, después, a adaptadores aislados del data plane.

## Experiencia ya decidida

Un dispositivo propio vinculado/confiable recibe sin pedir confirmación manual por cada transferencia. Con la app receptora cerrada, Android deberá despertarla de forma ligera y temporal. No se mantiene WebRTC pesado vivo permanentemente.

## Checkpoint 1 — manifest, chunks, hashes y journal ✅

Manifest técnico ligado a `requestId` + `transferId`, chunks lógicos de 4 MiB, SHA-256, journal sender/receiver reanudable y cero payload dentro de manifest/journal.

Gate: CI #119 verde.

## Checkpoint 2 — persistencia local reanudable ✅

IndexedDB guarda solo metadata técnica reanudable, valida integridad y depura estado corrupto/vencido; nunca guarda bytes dentro del journal.

Gate: CI #120 verde.

## Checkpoint 3 — Route Intent → operación preparada ✅

`TransferChunkSource` separa origen y motor; texto/imagen locales usan `sourceRef` técnica reabrible por `itemId`; manifest/journal/sourceRef se persisten antes de cualquier transporte.

Gate: CI #122 verde.

## Checkpoint 4 — solicitud real → fuente correlacionada ✅

La fuente se registra antes de `transfer-request`, se correlaciona por `requestId`, se limpia en rechazo/cancel/fallo/expiración y solo se entrega al Route Manager después de persistir la operación preparada.

Gate: CI #124 verde.

## Checkpoint 5 — selección de ruta ✅

`PreparedTransferRouteManager` devuelve `TransferRouteSelection` sin mover bytes. `local-direct` exige DataChannel validado y actualmente solo es elegible para texto/imagen; archivos permanecen `unavailable` hasta tener adaptador probado.

Gate: CI #126 verde sobre `c1419c61d4b1461dbf2e16528d79cb780b2c9c50`.

## Checkpoint 6 — adaptador `local-direct` de texto ✅

`src/transfer/localDirectTextAdapter.ts` crea el primer puente controlado entre el Transfer Engine y el data plane local existente:

1. exige una operación sender `prepared` y una selección `selected/local-direct` que coincida exactamente con manifest/Route Intent;
2. exige `sourceRef.provider = local-text`;
3. reabre el item por `itemId`, sin duplicar el texto en metadata técnica;
4. reconstruye los bytes UTF-8 y verifica el hash canónico del manifest y cada chunk antes de tocar el transporte;
5. reutiliza `sendLocalClipboardTextDirect`, por lo que conserva autorización del dispositivo, DataChannel validado y ACK `stored` existentes;
6. solo tras ese ACK marca los chunks completados, completa el journal en memoria y elimina el estado reanudable;
7. si el contenido cambió, falta el item o Directo falla, no adelanta el journal ni borra el estado reanudable.

Este adaptador todavía no sustituye el envío legacy en la UI/producto. Se mantiene aislado hasta demostrar equivalencia e integridad end-to-end.

Gate: CI #130 verde en auditoría, tests, lint, build, Web/Worker y Android sobre `92ca2c11d2a93b159d846f4f12214dcfc1480031`.

## Checkpoint 7 — adaptador `local-direct` de imagen ✅

`src/transfer/localDirectImageAdapter.ts` aplica el mismo contrato seguro al envío de imágenes:

1. exige operación sender `prepared` y selección `selected/local-direct` que coincidan exactamente;
2. exige `sourceRef.provider = local-image` y reabre el item únicamente por `itemId` técnico;
3. valida que Blob, `byteSize` y MIME sigan siendo coherentes;
4. verifica los bytes reales y cada chunk contra el manifest antes de tocar el transporte;
5. reutiliza de forma diferida `sendLocalImageDirect`, conservando el transporte Directo y su confirmación real `stored`;
6. solo tras éxito del transporte completa chunks/journal y elimina el estado reanudable;
7. imagen ausente, vencida, alterada o fallo/ACK ausente dejan el journal `prepared`, sin progreso falso ni borrado del estado.

El adaptador permanece aislado: no sustituye rutas legacy, no agrega relay ni mueve payload por WebSocket.

Gate: CI #132 verde en auditoría, tests, lint, build, Web/Worker y Android sobre `699b1ff5ec342b60018a1465572ff06b7c6c5d50`.

## Checkpoint 8 — dispatcher del data plane ✅

`src/transfer/transferDataPlaneDispatcher.ts` convierte la selección del Route Manager en una ejecución controlada sin conocer transportes legacy:

1. valida sala y correlación exacta entre operación preparada y `TransferRouteSelection`;
2. solo acepta `status = selected` con `route = local-direct`;
3. texto se entrega únicamente a `executeLocalDirectTextTransfer` e imagen únicamente a `executeLocalDirectImageTransfer`;
4. `unavailable`, archivo o combinaciones no soportadas se rechazan antes de invocar un adaptador;
5. el dispatcher no llama WebSocket, relay, RTCDataChannel ni transportes legacy directamente;
6. `createTransferDataPlaneHandoff` expone un callback reutilizable para `TransferSendCoordinator`;
7. `TransferSendCoordinator` ahora espera `onHandoff` asíncrono y propaga sus fallos reales a `onError`, evitando errores silenciosos del data plane.

El dispatcher sigue aislado del producto: `App.tsx` todavía usa directamente los transportes legacy para los botones de envío local.

Gate: CI #134 verde en auditoría, tests, lint, build, Web/Worker y Android sobre `79b8d04bf03714903ae6af68edf9ba9fe2cf193d`.

## Checkpoint 9 — frontera de envío de producto local ✅

`src/transfer/localTransferProductBoundary.ts` crea la frontera aislada que une el producto con el pipeline ya validado, sin sustituir todavía los callbacks de `App.tsx`:

1. mantiene por sala un `TransferSendCoordinator`, `PreparedTransferRouteManager` y handoff del dispatcher;
2. instala la espera correlacionada por `requestId` después de registrar la fuente técnica y antes de emitir `transfer-request`, evitando respuestas síncronas perdidas;
3. valida que request, Route Intent, operación preparada y manifest coincidan en emisor, receptor, tipo, tamaño y vigencia;
4. la `Promise` del producto solo resuelve después de que el handoff del data plane termine realmente; no confunde `accepted` con transferencia completada;
5. `rejected`, `busy`, cancelación remota, `unavailable` y errores del pipeline rechazan la espera correspondiente;
6. expiración o desconexión limpian la fuente técnica y las esperas pendientes;
7. la frontera solo admite texto e imagen mientras archivos continúan sin adaptador probado;
8. el estado persistente mantiene solo referencias y metadata técnica; no se agrega contenido crudo, nombres ni rutas privadas.

`TransferSendCoordinator` expone además el momento seguro de registro de la solicitud y operaciones explícitas de descarte/limpieza para que esta frontera pueda evitar carreras sin duplicar payload.

Gate de implementación: CI #140 verde en auditoría, 430/430 tests, lint, build, Web/Worker y Android sobre `093ece3ba238bc8479c8633eff94f2f666231287`.

## Privacidad, seguridad y costo

- El WebSocket de control sigue sin transportar payload pesado.
- Manifest, journal, `sourceRef`, Route Intent y Route Selection contienen solo metadata técnica necesaria.
- No se agregan secrets, rutas privadas ni contenido a metadata persistente.
- Hashes aportan integridad, no confidencialidad; E2E pertenece a la capa de ruta.
- No se activa R2, TURN, SFU ni servicio nuevo facturable.

## No sustituye todavía

- callbacks legacy de texto/imágenes en `App.tsx`;
- transferencia de archivos por el nuevo data plane;
- Android wake/background;
- fallback remoto del nuevo data plane.

## Siguiente checkpoint exacto

Checkpoint 10: integrar primero **solo el envío local de texto** de `App.tsx` con la nueva frontera de producto. El callback actual `sendLocalTextDirect` debe dejar de llamar directamente a `sendLocalClipboardTextDirect`: debe crear la fuente con `createLocalTextTransferChunkSource`, reutilizar una `createLocalTransferProductBoundary` ligada a la sala activa y llamar `sendLocalSource` con `identity.deviceId` y el dispositivo destino. La frontera debe destruirse al cambiar/desmontar la sala, el éxito visible debe ocurrir solo cuando su `Promise` termine y los errores deben seguir llegando a la UI. En este checkpoint no se modifica todavía el callback legacy de imagen, General, archivos, wake/background ni fallback remoto. Después de validar texto de producto end-to-end se migrará imagen por separado.