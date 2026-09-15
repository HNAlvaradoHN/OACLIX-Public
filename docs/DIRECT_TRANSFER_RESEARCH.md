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

## Siguiente decisión de arquitectura

Antes de seguir perfeccionando el receptor WebRTC permanente de segundo plano, comparar esta arquitectura objetivo contra el código real actual y clasificar cada componente como:

- conservar;
- reutilizar con cambios;
- reemplazar;
- eliminar.

No hacer un reinicio total de OACLIX salvo que esa comparación demuestre que es más barato y seguro que una migración incremental.
