# Transfer Engine — OACLIX

Fecha: 2026-09-16
Estado: Paso 2 en desarrollo sobre `feat/transfer-engine`, dependiente del Paso 1 (`feat/transfer-control-plane`).

## Objetivo

Mover texto, imágenes y archivos con un motor independiente del transporte. El motor no decide si la ruta es LAN, WebRTC, Wi-Fi Direct, Internet directo o relay: solo define cómo describir, verificar, reanudar y cerrar una transferencia.

## Checkpoint 1 — manifest, chunks, hashes y journal

### Manifest

`src/transfer/transferManifest.ts` introduce un manifest técnico sin contenido de usuario:

- correlaciona la transferencia con el `requestId` del plano de control y un `transferId` propio;
- conserva emisor, receptor, tipo general (`text` / `image` / `file`) y tamaño total;
- divide el contenido en chunks lógicos de **4 MiB**;
- cada chunk lleva `index`, longitud exacta y SHA-256;
- el último chunk puede ser menor;
- el manifest completo tiene un SHA-256 canónico que liga identidad, orden, tamaños y hashes de chunks;
- no contiene nombre de archivo, base64, texto, imagen ni payload.

Los 4 MiB son tamaño lógico del Transfer Engine, **no tamaño de frame de red**. Un transporte puede fragmentar un chunk en mensajes menores; por ejemplo, el DataChannel actual puede seguir usando frames de 64 KiB sin cambiar el contrato del motor.

La generación de hashes lee un chunk a la vez, evitando cargar archivos grandes completos en memoria solo para obtener integridad.

### Journal de progreso

`src/transfer/transferJournal.ts` define un journal serializable y transport-agnostic:

- queda ligado al `transferId` y al hash exacto del manifest;
- distingue rol `sender` / `receiver`;
- guarda progreso como rangos compactos de chunks completados;
- permite calcular rangos faltantes para reanudar sin empezar desde cero;
- marcar el mismo chunk otra vez es idempotente;
- una transferencia no puede pasar a `complete` mientras falte un chunk;
- el journal no guarda contenido, nombres de archivo ni mensajes de error con datos privados.

Semántica prevista:

- en receptor, “chunk completado” significa que el chunk fue recibido y verificado contra su SHA-256 antes de persistir el progreso;
- en emisor, “chunk completado” significará que el receptor confirmó ese chunk;
- el estado `complete` no sustituye el ACK final de almacenamiento: la integración posterior deberá marcar éxito visible solo después de que el receptor haya persistido y verificado todo.

## Privacidad y seguridad

- ningún payload nuevo viaja por el WebSocket de control;
- el manifest contiene únicamente metadata técnica mínima;
- no se introducen secrets, hostnames privados, nombres reales de archivos ni contenido de portapapeles;
- rige `SECURITY.md` para todo cambio público;
- un hash sirve para integridad, **no para confidencialidad**. El cifrado E2E de rutas remotas se resolverá en su capa correspondiente.

## Costo

Este checkpoint es código local y pruebas. No activa R2, TURN, SFU, almacenamiento cloud nuevo ni servicios facturables.

## No sustituye todavía

- el relay legacy de texto/imágenes;
- el DataChannel de imágenes existente;
- el control plane del Paso 1;
- Android wake/background;
- selección de ruta.

## Gate del checkpoint 1

Debe quedar demostrado que:

1. un blob se describe con chunks y hashes reproducibles sin incluir payload en el manifest;
2. un byte alterado hace fallar la verificación del chunk;
3. alterar metadata invalida el hash del manifest;
4. el journal reanuda desde los rangos faltantes e ignora progreso duplicado;
5. no se puede declarar una transferencia completa si faltan chunks;
6. Web/Worker, tests, lint, build, auditoría pública y Android siguen verdes.

## Siguiente checkpoint exacto

Persistir localmente manifest + journal con limpieza explícita y restauración segura después de reinicio, sin almacenar los bytes del archivo dentro del journal. Después se conectará el `Route Intent` del Paso 1 con la creación de una operación del Transfer Engine, todavía sin reemplazar transportes legacy.
