# Investigación de transferencia Directo — OACLIX

Fecha: 2026-09-15

## Objetivo

Conservar solo las conclusiones que cambian decisiones de OACLIX. No documentar cada búsqueda ni convertir esta nota en un inventario de aplicaciones.

## Decisiones técnicas resultantes

### 1. No reiniciar OACLIX completo

La UI PWA, identidad por dispositivo, vinculación, roster/backend y almacenamiento local siguen siendo aprovechables. La parte que debe replantearse es la capa de comunicación de `Directo`.

### 2. Separar control y datos

Cloud/backend debe encargarse de:

- identidad y dispositivos vinculados;
- roster/presencia;
- solicitudes y aceptación;
- señalización/negociación;
- wake/push cuando corresponda.

Los bytes de texto/imagen/archivo no deben pasar normalmente por la nube.

### 3. Directo no debe depender de un WebRTC permanente

WebRTC sigue siendo útil, especialmente para navegador/PWA, pero no debe ser el mecanismo permanente de presencia ni el centro de toda la arquitectura Android.

Patrón preferido:

1. descubrir/coordinar;
2. levantar el transporte pesado solo cuando haya transferencia;
3. transferir;
4. cerrar el transporte.

Esto reduce consumo, complejidad de background y riesgo de crashes.

### 4. Ruta automática por capacidades

El usuario solo elige el dispositivo. OACLIX decide la mejor ruta disponible.

Orden objetivo, sujeto a pruebas reales:

1. LAN directa;
2. Wi‑Fi Direct / mecanismo cercano nativo cuando aplique;
3. WebRTC para navegador y casos compatibles;
4. Internet directo / NAT traversal;
5. relay E2E solo si existe una opción económicamente segura.

Wi‑Fi Aware puede explorarse después, pero nunca ser requisito porque depende del hardware.

### 5. El relay no debe convertirse en almacenamiento cloud

Si se incorpora relay, debe actuar como conducto temporal de bytes cifrados extremo a extremo. El archivo definitivo se persiste solo en el receptor.

No debe existir fallback silencioso de `Directo` a almacenamiento cloud.

### 6. Transfer Engine separado del transporte

Imágenes y archivos grandes deben usar un motor común con:

- manifest/metadatos;
- chunks o bloques;
- hash/integridad;
- journal durable;
- retry;
- resume;
- ACK final solo después de persistir correctamente.

La ruta de red no debe definir la lógica de persistencia. En el futuro una transferencia puede cambiar de ruta sin rehacer el motor de archivos.

### 7. Texto pequeño y archivos grandes no necesitan el mismo transporte

Clipboard de texto puede usar una ruta ligera. Imágenes/archivos grandes necesitan streaming, backpressure y resume. No obligar a un único transporte a resolver ambos problemas.

## Referencias que aportaron patrones útiles

No copiar implementaciones sin revisar licencia. Se usan como referencias arquitectónicas:

- Blip: control central + directo primero + relay fallback;
- Quick Share / Bada / NearDrop: proximidad, BLE, Wi‑Fi Direct y conexiones temporales;
- LocalSend: LAN simple, descubrimiento y transferencia directa sin nube;
- Magic Wormhole: rendezvous separado de transit y fallback de relay;
- libp2p/DCUtR: coordinación vía relay para intentar luego conexión directa;
- RustDesk: rendezvous + hole punching + relay;
- Tailscale/Taildrop: selección automática entre directo y relay cifrado;
- Syncthing: bloques, hashes y reanudación robusta;
- KDE Connect: dispositivos vinculados, clipboard y archivos como capacidades separadas;
- croc: relay, resume y emparejamiento seguro;
- Flying Carpet: enlaces locales/ad-hoc sin infraestructura;
- PairDrop: WebRTC DataChannel y backpressure para navegador.

## Lo valioso que OACLIX ya tiene

La base actual de Directo incluye ideas que deben conservarse aunque cambie la arquitectura:

- chunks binarios de 64 KiB;
- lectura por ventanas en PWA;
- `RTCDataChannel.bufferedAmount` como backpressure;
- high/low-water para controlar cola;
- escritura Android por streaming;
- almacenamiento privado;
- ACK `stored` después de persistir;
- ausencia de fallback silencioso de bytes Directo a Nube.

## Cloudflare: función objetivo y regla de costo

Cloudflare debe quedar como plano de control, no como carretera principal de datos.

Mantener mientras sigan dentro del plan gratuito y sean necesarios:

- Workers / Static Assets;
- D1 para identidad, relaciones y metadatos pequeños;
- Durable Objects / WebSocket para presencia y señalización.

No usar para Directo normal:

- R2 como almacenamiento de transferencias;
- relay facturable sin límite duro;
- TURN/SFU o cualquier servicio que pueda generar cobro automático sin aprobación explícita.

### Auditoría real de cuenta — 2026-09-15

Verificado manualmente en el panel Cloudflare:

- `Workers Free`: activo;
- facturas visibles: ninguna;
- uso facturable observado: `$0.00`;
- costo proyectado observado: `$0.00`;
- existía `R2 Paid`, con un bucket vacío `oanix-encrypted-objects`;
- el bucket fue eliminado (`0 objetos`, `0 B` antes de eliminarlo);
- `R2 Paid` fue cancelado y quedó en estado `Finalizando`, con fin indicado para 2026-10-06;
- método de pago existía en la cuenta, por lo que cualquier servicio facturable futuro debe tratarse como riesgo real.

Regla del proyecto:

> OACLIX no activará servicios con posibilidad de generar cargos sin aprobación explícita del Ing. Si una función gratuita alcanza su límite, debe degradarse o detenerse antes de convertir consumo en facturación.

## Qué no implementar ahora

- DHT completa;
- CRDT para el clipboard básico;
- Wi‑Fi Aware como requisito;
- Bluetooth para mover imágenes grandes;
- WebRTC nativo permanentemente activo;
- almacenamiento cloud obligatorio para Directo;
- un protocolo P2P gigante propio antes de validar rutas simples.

## Orden recomendado de construcción

1. hacer confiable el plano de control: roster, presencia, solicitud pendiente y estado independiente del canal de datos;
2. crear/aislar el Transfer Engine con chunks, hashes, resume y journal;
3. añadir ruta LAN directa simple;
4. mantener WebRTC como ruta para PWA/navegador;
5. resolver wake/background Android con mecanismo ligero y transporte temporal;
6. añadir Wi‑Fi Direct para proximidad/offline;
7. estudiar Internet directo/NAT traversal;
8. añadir relay E2E solo si puede mantenerse dentro de una política de costo segura;
9. optimizar después con QUIC/Wi‑Fi Aware u otras rutas si las métricas lo justifican.

## Medición antes de optimizar

No cambiar tamaños de chunk ni transporte por intuición. Medir al menos:

- Mbps efectivos;
- tiempo hasta primer byte;
- tiempo total hasta ACK `stored`;
- memoria pico;
- `bufferedAmount` o equivalente;
- tamaño de archivo;
- ruta usada;
- comportamiento al perder red, cambiar de red o reabrir la app.

Comparar siempre con el mismo archivo y la misma pareja de dispositivos/red.

## Estado actual de desarrollo

- PR #2 `feat/android-direct-image-native`: gate físico pendiente; no fusionar.
- PR #3 `docs/direct-transfer-research`: contiene esta investigación/decisiones.
- PR #4 `feat/android-pwa-visual-parity`: visual, aislado de transporte/backend.
- PR #5 `feat/android-pwa-shell`: desarrollo Android/PWA y Directo; no considerar estable hasta gate físico.

## Comparación contra el código real actual

La comparación de `main` y los PR activos confirma que no conviene reiniciar OACLIX completo. La migración debe ser incremental y concentrarse en comunicación.

### Conservar

- **PWA/UI React**: no depende de una arquitectura de transporte concreta y sigue siendo la superficie común correcta.
- **Identidad criptográfica por dispositivo**: P-256, firma de acciones y `deviceId` derivado de la clave son una base útil; en Android PR #5 la clave privada pasa a Keystore mediante bridge.
- **Vinculación y roster en D1**: usuarios/personas, dispositivos, nombres, salas y membresías pertenecen al plano de control y se conservan.
- **Worker/API autenticada**: conservar autenticación, validación de acciones, administración de dispositivos y metadatos pequeños.
- **Durable Object/WebSocket autenticado**: conservarlo para presencia, señalización y mensajes de control pequeños.
- **Almacenamiento local**: IndexedDB/PWA y almacenamiento privado Android siguen siendo la ubicación correcta del contenido local.
- **Sharesheet Android y bridge PWA/nativo** de PR #5: son capacidades de plataforma y no dependen de WebRTC permanente.
- **Escritura Android por streaming + commit final + ACK `stored`**: conservar el principio de persistir antes de confirmar.

### Reutilizar con cambios

- **`LanPeerManager`**: hoy mezcla presencia, negociación, WebRTC, retry, transferencia de texto, transferencia de imagen y estado de producto. Debe dividirse en un coordinador de rutas y adaptadores de transporte. Su implementación WebRTC puede sobrevivir como `WebRtcTransport` para PWA, pero no como dueño de toda la comunicación.
- **`RealtimeSignalClient`**: conservar conexión autenticada, presencia y señalización. Retirar de él la responsabilidad de transportar payloads de clipboard/imagen por `device-transfer` / `device-image-transfer`.
- **`RealtimeHub`**: conservar autenticación, presencia y enrutamiento de `signal`; reducirlo a control. Eliminar el relay de contenido pesado y los límites creados específicamente para frames base64 de imágenes.
- **`localImageDirectTransfer` y backpressure WebRTC**: reutilizar framing, tamaños, validaciones y control de cola como primer adaptador del futuro Transfer Engine; añadir hashes, journal y resume sin amarrarlos a WebRTC.
- **Direct-first durable state existente**: aprovechar las ideas de secuencia, ACK, replay y persistencia, pero no seguir ampliando la actual red de `shadow`, `gap repair` y reconciliación cloud como núcleo universal. El Transfer Engine debe absorber solo las partes útiles de durabilidad de forma más simple.
- **Cloud/D1 de texto**: conservarlo como función explícita de Nube/General cuando el producto la requiera; no usar escritura cloud automática como sustituto invisible de una transferencia `Directo` fallida.

### Reemplazar

- **`routePolicy.ts` actual** (`Directo local` / `Nube` / `Desconectado`): reemplazar por selección por capacidades/rutas, con estados como `LAN`, `Wi‑Fi Direct`, `WebRTC`, `Internet Direct`, `Relay` y `No disponible`; la UI puede seguir mostrando nombres simples.
- **WebRTC como presencia permanente**: presencia viene del plano de control; WebRTC debe crearse por sesión de transferencia y cerrarse al terminar o quedar ocioso.
- **Background Android de PR #5**: no convertir `BackgroundDirectAvailabilityService` + WebRTC nativo siempre disponible en arquitectura final. Mantener solo lo necesario para validar/salvar el shell; el diseño final debe usar wake/control ligero y levantar transporte temporal.
- **Recepción PWA que acumula todos los chunks de una imagen en memoria antes de crear `Blob`**: para archivos grandes debe pasar a escritura/streaming durable dentro del Transfer Engine.

### Eliminar cuando la migración tenga reemplazo funcional

- relay de imágenes base64 por Durable Object/WebSocket (`device-image-transfer`);
- límite y framing de ~10 MiB creado para ese relay cloud;
- `device-transfer` de contenido como camino normal del WebSocket de control;
- receptores cloud-relay que existan solo para esos payloads;
- cualquier inicialización WebRTC nativa cuyo único objetivo sea mantener al receptor disponible permanentemente en segundo plano.

No borrar estas piezas antes de que exista una ruta sustituta probada; la eliminación debe ocurrir en la misma etapa que introduce el reemplazo para no dejar dos arquitecturas acumuladas.

## Decisión sobre los PR activos

- **PR #3** sigue siendo la rama correcta para esta decisión/documentación.
- **PR #4** puede permanecer aislado; no afecta la arquitectura.
- **PR #2** y **PR #5** no deben fusionarse tal como están hasta resolver el cambio de dirección de Directo.
- De **PR #5** conviene rescatar PWA shell, Keystore bridge, Sharesheet/importación local y endurecimiento WebView. La parte de receptor WebRTC nativo permanente en background queda como implementación transitoria, no como objetivo final.
- No invertir más trabajo en optimizar el WebRTC permanente de background salvo lo mínimo necesario para obtener un diagnóstico reproducible o separar limpiamente las piezas reutilizables.

## Plan de migración recomendado

La siguiente implementación debe hacerse en bloques pequeños, manteniendo OACLIX usable:

1. **Separar control de payload** sin cambiar todavía la UI: crear contrato de solicitud de transferencia y mantener Durable Object solo para control/señalización.
2. **Extraer un Transfer Engine mínimo** para imagen: `manifest + chunks + hash + journal + ACK persisted`; inicialmente usar el WebRTC PWA existente como primer transporte.
3. **Separar `WebRtcTransport` de `LanPeerManager`** y dejar al nuevo Route Manager elegirlo solo cuando corresponda.
4. **Añadir LAN directa simple** como segundo transporte y medir contra WebRTC con los mismos archivos/dispositivos.
5. **Migrar Android background** a wake/control ligero + servicio temporal de transferencia; eliminar receptor WebRTC permanente cuando el reemplazo pase prueba física.
6. **Añadir Wi‑Fi Direct** para Android cercano/offline.
7. Solo después estudiar Internet directo/NAT traversal y relay E2E con límite de costo seguro.

## Resultado de la comparación

**No reiniciar OACLIX. No seguir expandiendo la arquitectura Directo actual. Migrar la comunicación por capas.**

La inversión ya hecha que sí vale la pena conservar está principalmente en identidad, vinculación, PWA, almacenamiento local, autenticación, presencia/señalización y primitivas de transferencia segura. El costo técnico innecesario está concentrado en usar el mismo WebSocket/WebRTC como presencia, transporte, fallback cloud y background, y en la complejidad de reconciliación creada alrededor de esa mezcla.

La dirección aprobable técnicamente es convertir esas piezas en módulos independientes antes de añadir más transportes.

## Siguiente paso exacto

No reiniciar OACLIX ni seguir parchando el receptor permanente. El siguiente cambio de código debe ser el bloque 1: **introducir el contrato de control para solicitudes de transferencia y separar los payloads de `RealtimeSignalClient`/`RealtimeHub`, sin eliminar aún el camino antiguo hasta que el nuevo contrato tenga pruebas y pueda migrarse por etapas**.
