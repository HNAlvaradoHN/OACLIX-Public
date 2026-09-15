# Plano de control de transferencias — OACLIX

Fecha: 2026-09-15
Estado: Paso 1 iniciado; checkpoint 1 implementado en `feat/transfer-control-plane`.

## Objetivo

Separar la coordinación de una transferencia de los bytes reales. Cloudflare puede coordinar quién quiere enviar, quién recibe y si acepta, pero este canal no debe transportar texto, imagen ni archivo como payload.

## Checkpoint 1 implementado

- contrato compartido `transfer-request` / `transfer-decision` / `transfer-cancel`;
- destino explícito por `deviceId`;
- metadatos mínimos: tipo de contenido, tamaño y vigencia;
- validación de dirección: solo el emisor crea la solicitud y solo el receptor decide;
- cualquiera de los dos extremos puede cancelar su solicitud;
- mensajes de control limitados a 2 KiB y con claves exactas para impedir usar este camino como relay encubierto de contenido;
- `RealtimeHub` reenvía `transfer-control` únicamente a otro dispositivo vinculado de la misma persona;
- se mantiene el camino viejo sin cambios mientras la migración nueva no tenga reemplazo probado.

## Todavía pendiente dentro del Paso 1

1. integrar el cliente PWA/Android con este contrato sin mezclarlo con `device-transfer` / `device-image-transfer`;
2. añadir solicitudes pendientes cuando el receptor esté temporalmente offline, guardando solo control/metadatos y con expiración corta;
3. separar el estado `dispositivo conocido`, `online`, `solicitud pendiente` y `canal de datos disponible`;
4. conectar aceptación/rechazo con el futuro Route Manager;
5. retirar el relay viejo de contenido por WebSocket solo cuando la ruta nueva esté probada.

## Regla de costo

Este paso no activa R2, TURN, SFU ni ningún servicio facturable. El Durable Object/WebSocket continúa siendo plano de control. Los bytes de transferencias nuevas no deben pasar por este mensaje.

## Siguiente checkpoint exacto

Cablear `RealtimeSignalClient` a `transfer-control`, publicar eventos por un bus separado y probar solicitud/aceptación entre dos clientes online. Después se añade persistencia corta para receptor offline.
