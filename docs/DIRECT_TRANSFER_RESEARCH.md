# Investigación de transferencia Directo — OACLIX

Fecha: 2026-09-15

## Objetivo

Documentar técnicas verificables que puedan mejorar Directo sin introducir almacenamiento cloud de archivos, servicios con costo ni código incompatible con OACLIX.

## Hallazgos aplicables

### PairDrop

Referencia estudiada: `schlagmichdoch/PairDrop`.

- Licencia: GPL-3.0. No copiar código a OACLIX sin revisar compatibilidad de licencia; usar únicamente ideas/protocolos generales observados.
- Transporte: WebRTC `RTCDataChannel`, ordenado.
- Framing de archivos: chunks de 64,000 bytes.
- Control de flujo adicional: agrupa chunks en particiones de 1 MB y espera confirmación `partition-received` antes de continuar con la siguiente partición.
- El servidor participa en señalización; los bytes del archivo viajan por el canal de datos cuando WebRTC conecta.

Implicación para OACLIX: nuestro chunk actual de 64 KiB está en el mismo orden de magnitud. No hay evidencia de que aumentar arbitrariamente el chunk produzca mayor throughput. La mejora importante es controlar presión de envío y medir el pipeline completo.

### LocalSend

Referencia estudiada: `localsend/localsend`.

- Licencia: Apache-2.0, más permisiva que GPL-3.0.
- Es una referencia útil para transferencia local y descubrimiento, pero cualquier reutilización futura debe conservar avisos/licencia según corresponda.

## Estado técnico de OACLIX PR #2

La rama `feat/android-direct-image-native` ya implementa varias técnicas que deben conservarse:

- chunks binarios de 64 KiB;
- lectura PWA por ventanas de 16 chunks (1 MiB), evitando leer el archivo completo antes de enviar;
- `RTCDataChannel.bufferedAmount` como backpressure;
- high-water de 1 MiB y low-water de 256 KiB;
- espera por `bufferedamountlow` con timeout defensivo;
- Android escribe los chunks recibidos por streaming a almacenamiento privado;
- ACK `stored` solamente después de persistir;
- no existe fallback silencioso de bytes Directo a Nube.

Esto significa que OACLIX ya tiene una base de throughput más avanzada que un simple bucle `channel.send()` sin control de cola.

## Arquitectura objetivo sin cargos

Orden de preferencia:

1. conexión local/directa entre dispositivos;
2. WebRTC P2P directo entre redes mediante técnicas de NAT traversal que sean realmente gratuitas y no puedan generar facturación;
3. puente/relay únicamente si se encuentra una opción cuyo límite económico sea duro en $0 y que no almacene el archivo;
4. si no existe relay con garantía $0, fallar de forma explícita en lugar de activar un servicio facturable.

Un relay, si se incorpora, debe actuar solo como conducto de bytes. El archivo definitivo se persiste únicamente en el dispositivo receptor; OACLIX no debe convertir ese relay en almacenamiento cloud.

## Medición antes de optimizar

No llamar “rápida” a una implementación solo por cambiar el tamaño de chunk. La siguiente etapa de rendimiento debe medir al menos:

- bytes/segundo útiles y Mbps efectivos;
- tiempo hasta primer byte;
- tiempo total hasta ACK `stored`;
- pico de `bufferedAmount`;
- memoria del emisor y receptor;
- tamaño de archivo;
- tipo de ruta: LAN/P2P Internet/relay;
- modelo de dispositivo y tipo de enlace cuando sea posible.

Las comparaciones con Blip, Quick Share, PairDrop o LocalSend deben hacerse con el mismo archivo y la misma pareja de dispositivos/red para evitar conclusiones falsas.

## Gate actual

No modificar más el crash Android por hipótesis. PR #2 permanece sin merge hasta repetir el gate físico con el APK vigente. Si el cierre persiste, el siguiente dato obligatorio es stack/tombstone/logcat del crash antes de otro cambio de lifecycle/WebRTC.

## Siguiente bloque después del gate físico

1. confirmar estabilidad de PR #2;
2. medir PWA → Android con archivos pequeños, medianos y grandes;
3. registrar throughput y presión del DataChannel;
4. ajustar high/low-water o ventanas solo con evidencia de medición;
5. implementar Android → PWA reutilizando el mismo protocolo y las mismas reglas de persistencia/backpressure;
6. evaluar NAT traversal/relay $0 como etapa separada, sin mezclarlo con el gate de estabilidad.
