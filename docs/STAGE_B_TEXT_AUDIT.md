# Etapa B — auditoría para texto dispositivo-a-dispositivo

Estado: **auditoría cerrada para el primer flujo de texto**.

Esta auditoría parte de `OACLIX-Public/main` en `f51883cbe93d36db9df770565695a98fe5a944c3` y de la dirección local-first definida en `PROJECT_STATE.md`.

## Reutilizar

- `AndroidKeystoreDeviceIdentity` y las APIs actuales de identidad/vinculación.
- `NativeShareDestinationSource` para obtener el roster autoritativo de dispositivos vinculados.
- El `ACTION_SEND` Android ya registrado para `text/plain`.
- `LocalClipboardHistory` como persistencia local del receptor.
- `OaclixClipboardBridge.copy(context, text)` para dejar el texto recibido listo para pegar.
- El canal realtime actual **solo** para presencia y señalización técnica.
- El mecanismo de ACK como concepto: el emisor no debe declarar éxito antes de que el receptor confirme persistencia.

## Adaptar

- La señalización WebRTC que existía en la rama histórica `feat/android-direct-image-native`: se rescata únicamente el contrato de presencia/SDP/ICE, no la superficie de imágenes ni su lifecycle anterior.
- La negociación debe anunciar capacidad `text-direct` y rechazar capacidades desconocidas.
- El protocolo de texto debe vivir exclusivamente en el futuro DataChannel; el servicio cloud no puede aceptar ni retransmitir ese payload.
- La recepción debe guardar localmente primero, publicar en Android Clipboard después y emitir `stored` únicamente tras completar esas operaciones.
- Reintentos/idempotencia deben correlacionarse por `transferId` + `itemId` para no duplicar historial.

## Eliminar / no continuar

- `General` como destino visible del producto.
- `NativeClipboardApi` / creación de texto en D1 como ruta del nuevo producto.
- `NativeGeneralShareTransport` como envío desde Android.
- `NativeDeviceShareTransport` como relay de texto dentro del WebSocket cloud.
- Cualquier fallback silencioso de Directo a Nube para contenido.
- Las ramas cerradas como `SUPERSEDED` no vuelven a ser base de desarrollo; solo se extraen piezas aisladas tras auditoría.

## Contratos creados en este checkpoint

### `NativeDirectSignalProtocol`
- Acepta presencia, SDP e ICE.
- Aplica límites estrictos de tamaños e identificadores.
- Publica capacidad `text-direct`.
- No tiene campo ni API para contenido de portapapeles.

### `NativeDirectTextProtocol`
- Frame de datos `direct-text-transfer`, pensado exclusivamente para DataChannel.
- Máximo actual: 8.000 caracteres, igual que texto local normal.
- Retención máxima: 6 horas, igual que `LocalClipboardPolicy`.
- ACK `direct-text-transfer-ack` con estados `stored`, `expired` y `rejected`.
- Valida dirección emisor/receptor y evita aceptar ACK en sentido inverso incorrecto.

## Siguiente checkpoint

Cablear `NativeDirectSignalProtocol` a un peer nativo pequeño y específico de texto:

1. añadir WebRTC solo si la dependencia histórica sigue pasando verificación de dependencias y CI;
2. usar `iceServers = []` para el primer gate LAN;
3. enviar `NativeDirectTextProtocol` únicamente por DataChannel;
4. persistir en `LocalClipboardHistory` antes del ACK;
5. copiar el texto recibido con `OaclixClipboardBridge`;
6. conectar finalmente el selector existente del Share Sheet;
7. gate físico con dos Android en la misma LAN antes de añadir P2P entre redes.

No incluir imágenes, archivos genéricos, favoritos, panel ni TURN/relay en este checkpoint.
