# Transfer Engine — OACLIX

Fecha: 2026-09-16
Estado: Paso 2 en desarrollo sobre `feat/transfer-engine`, dependiente del Paso 1 (`feat/transfer-control-plane`). Checkpoint 1 pasó CI #119 en Web/Worker y Android. Checkpoint 2 está implementado y pendiente de su gate CI.

## Objetivo

Mover texto, imágenes y archivos con un motor independiente del transporte. El motor no decide si la ruta es LAN, WebRTC, Wi-Fi Direct, Internet directo o relay: solo define cómo describir, verificar, reanudar y cerrar una transferencia.

## Dependencia de experiencia ya decidida

El Transfer Engine debe respetar el requisito fijado en el Paso 1: un dispositivo propio ya vinculado/confiable recibe sin pedir confirmación manual por cada transferencia. Que la app receptora esté cerrada tampoco debe cambiar esa experiencia; la etapa de Android wake despertará el receptor de forma ligera y temporal. Por eso este motor se diseña para reanudar desde journal después de interrupciones y no depende de mantener WebRTC u otro transporte pesado activo permanentemente.

## Checkpoint 1 — manifest, chunks, hashes y journal

`src/transfer/transferManifest.ts` y `src/transfer/transferJournal.ts` establecen:

- correlación `requestId` + `transferId`;
- chunks lógicos de **4 MiB**, independientes del tamaño de frame de red;
- SHA-256 por chunk y SHA-256 canónico del manifest;
- hashing de un chunk a la vez para no cargar un archivo grande completo solo para calcular integridad;
- journal sender/receiver ligado al hash exacto del manifest;
- progreso por rangos compactos, idempotencia y cálculo de rangos faltantes;
- prohibición de marcar `complete` mientras falten chunks;
- cero payload, base64, texto, imagen o nombre de archivo dentro de manifest/journal.

En receptor, un chunk solo debe marcarse completado después de recibirse y verificarse. En emisor, el progreso corresponderá a confirmaciones del receptor. El estado `complete` no sustituye el ACK final de persistencia.

Gate: CI #119 verde en tests, lint, build, auditoría pública, Web/Worker y Android.

## Checkpoint 2 — persistencia local reanudable

`src/transfer/transferStateStore.ts` persiste **solo** manifest + journal en IndexedDB local:

- base separada `oaclix-transfer-engine` y store `operations`;
- el snapshot acepta únicamente `version`, `type`, `manifest`, `journal` y `savedAt`; cualquier campo extra se rechaza para evitar que el journal se convierta accidentalmente en almacenamiento de contenido;
- antes de restaurar se verifica el hash completo del manifest y la coherencia del journal;
- solo estados `prepared` / `transferring` son reanudables; `complete` y `cancelled` no se conservan como trabajo pendiente;
- estado inactivo por más de 24 h se elimina; una operación de más de 7 días tampoco se restaura;
- entradas corruptas, vencidas o con key distinta del `transferId` se depuran al leer;
- existe borrado explícito por transferencia y limpieza total para futuros flujos de unlink/logout;
- no almacena bytes del archivo dentro del journal.

Esto permite restaurar **el conocimiento del progreso** tras reinicio. No promete todavía que el origen de bytes siga disponible: la siguiente integración debe resolver la referencia segura al contenido local según el tipo de origen, sin copiar archivos dentro del journal.

## Privacidad y seguridad

- ningún payload nuevo viaja por el WebSocket de control;
- manifest, journal y snapshot contienen únicamente metadata técnica necesaria;
- no se introducen secrets, hostnames privados, nombres reales de archivos ni contenido de portapapeles;
- rige `SECURITY.md` para todo cambio público;
- un hash sirve para integridad, no para confidencialidad. El cifrado E2E pertenece a la capa de ruta correspondiente.

## Costo

Todo lo anterior es lógica y almacenamiento local del dispositivo. No activa R2, TURN, SFU, almacenamiento cloud nuevo ni servicios facturables.

## No sustituye todavía

- el relay legacy de texto/imágenes;
- el DataChannel de imágenes existente;
- el control plane del Paso 1;
- Android wake/background;
- selección de ruta.

## Gate del checkpoint 2

Debe quedar demostrado que:

1. un snapshot válido se restaura tras serialización sin contener payload;
2. metadata extra, manifest alterado o journal no reanudable se rechazan;
3. estado inactivo/antiguo se depura;
4. Web/Worker, tests, lint, build, auditoría pública y Android siguen verdes.

## Siguiente checkpoint exacto

Conectar el `Route Intent` del Paso 1 con la creación de una operación del Transfer Engine y definir una abstracción de fuente de chunks que permita volver a abrir contenido local tras reinicio cuando el origen lo soporte. Todavía no sustituir ningún transporte legacy ni enviar bytes por el WebSocket de control.
