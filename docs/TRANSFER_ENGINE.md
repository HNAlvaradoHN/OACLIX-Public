# Transfer Engine — OACLIX

Fecha: 2026-09-16
Estado: Paso 2 en desarrollo sobre `feat/transfer-engine`, dependiente del Paso 1 (`feat/transfer-control-plane`). Checkpoint 1 pasó CI #119; Checkpoint 2 pasó CI #120; Checkpoint 3 pasó CI #122; Checkpoint 4 pasó CI #124; Checkpoint 5 pasó CI #126.

## Objetivo

Mover texto, imágenes y archivos con un motor independiente del transporte. El motor no decide por sí solo cómo implementar LAN, WebRTC, Wi-Fi Direct, Internet directo o relay: define cómo describir, verificar, reanudar y preparar una operación antes de entregarla al Route Manager.

## Experiencia ya decidida

Un dispositivo propio ya vinculado/confiable recibe sin pedir confirmación manual por cada transferencia. Que la app receptora esté cerrada tampoco debe cambiar esa experiencia; Android wake deberá despertar el receptor de forma ligera y temporal. El diseño no mantiene WebRTC u otro transporte pesado vivo permanentemente.

## Checkpoint 1 — manifest, chunks, hashes y journal ✅

`src/transfer/transferManifest.ts` y `src/transfer/transferJournal.ts` establecen manifest técnico, chunks lógicos de 4 MiB, SHA-256 por chunk y journal sender/receiver reanudable sin payload.

Gate: CI #119 verde en tests, lint, build, auditoría pública, Web/Worker y Android.

## Checkpoint 2 — persistencia local reanudable ✅

`src/transfer/transferStateStore.ts` persiste únicamente metadata técnica reanudable en IndexedDB, valida integridad y depura estados corruptos o vencidos sin almacenar bytes dentro del journal.

Gate: CI #120 verde en Web/Worker y Android.

## Checkpoint 3 — Route Intent → operación preparada ✅

`src/transfer/transferChunkSource.ts`, `src/data/transferSourceProviders.ts` y `src/transfer/transferOperationCoordinator.ts` separan el origen de los bytes, permiten referencias técnicas reabribles para texto/imagen local y persisten manifest/journal/sourceRef antes de cualquier transporte. `accepted` autoriza preparar; no significa que los bytes hayan comenzado a moverse.

Gate: CI #122 verde en tests, lint, build, auditoría pública, Web/Worker y Android sobre `f95db68a6580b86abe2a9ec6653df565507e20f9`.

## Checkpoint 4 — solicitud real → fuente correlacionada → Route Manager ✅

`src/transfer/transferSendCoordinator.ts` registra la fuente antes de emitir `transfer-request`, la correlaciona por `requestId`, aplica límites locales, limpia en rechazo/cancel/fallo/expiración y entrega al Route Manager únicamente después de que el Transfer Engine persista la operación preparada.

Gate: CI #124 verde en auditoría pública, tests, lint, build, Web/Worker y Android sobre `ce924536ac7879f552f7612fd9f5c23c6a00fcba`.

## Checkpoint 5 — Route Manager → selección de ruta ✅

`src/transfer/transferRouteManager.ts` introduce una `TransferRouteSelection` explícita y separada del movimiento de bytes:

- valida manifest, journal y coherencia con Route Intent;
- exige journal `sender/prepared`;
- presencia online por sí sola no cuenta como ruta de datos;
- `local-direct` solo es elegible con DataChannel validado;
- texto e imagen pueden seleccionar `local-direct`; archivos quedan `unavailable` hasta existir adaptador probado;
- ni un resolver defectuoso puede habilitar `local-direct` para un tipo sin adaptador;
- la selección contiene solo metadata técnica, no payload ni `sourceRef`;
- seleccionar no invoca transportes ni mueve bytes.

Gate: CI #126 verde en auditoría pública, tests, lint, build, Web/Worker y Android sobre `c1419c61d4b1461dbf2e16528d79cb780b2c9c50`.

## Privacidad y seguridad

- ningún payload nuevo viaja por el WebSocket de control;
- manifest, journal, `sourceRef`, Route Intent y Route Selection contienen solo metadata técnica necesaria;
- no se introducen secrets, hostnames privados, nombres reales de archivos, rutas privadas ni contenido del portapapeles en metadata técnica;
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

Checkpoint 6: crear un adaptador controlado para `local-direct` que consuma chunks del Transfer Engine y use el transporte local existente, empezando por una sola superficie (texto o imagen). Mantener el camino legacy intacto hasta demostrar equivalencia, integridad y fallback seguro; recién después considerar sustitución.
