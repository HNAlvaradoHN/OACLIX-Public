# Transfer Engine — OACLIX

Fecha: 2026-09-16
Estado: Paso 2 en desarrollo sobre `feat/transfer-engine`, dependiente del Paso 1 (`feat/transfer-control-plane`). Checkpoints 1–6 pasaron CI #119, #120, #122, #124, #126 y #130.

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

Este adaptador todavía no sustituye el envío legacy en la UI/producto. Se mantiene aislado hasta demostrar equivalencia e integridad end-to-end. No toca relay, WebSocket de payload ni la ruta de imagen.

Gate: CI #130 verde en auditoría, tests, lint, build, Web/Worker y Android sobre `92ca2c11d2a93b159d846f4f12214dcfc1480031`.

## Privacidad, seguridad y costo

- El WebSocket de control sigue sin transportar payload pesado.
- Manifest, journal, `sourceRef`, Route Intent y Route Selection contienen solo metadata técnica necesaria.
- No se agregan secrets, rutas privadas ni contenido a metadata persistente.
- Hashes aportan integridad, no confidencialidad; E2E pertenece a la capa de ruta.
- No se activa R2, TURN, SFU ni servicio nuevo facturable.

## No sustituye todavía

- rutas legacy de texto/imágenes;
- adaptador de imagen;
- Android wake/background;
- fallback remoto del nuevo data plane.

## Siguiente checkpoint exacto

Checkpoint 7: construir el adaptador `local-direct` de imagen siguiendo el mismo contrato del adaptador de texto: reabrir únicamente mediante `sourceRef` técnica, verificar bytes/chunks contra el manifest, reutilizar el transporte local existente y completar journal/estado solo después del ACK real. Mantener las rutas legacy intactas y no conectar todavía estos adaptadores como sustituto de producción.
