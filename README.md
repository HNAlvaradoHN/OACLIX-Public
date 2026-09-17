# OACLIX

OACLIX es una aplicación local-first para mover contenido entre dispositivos vinculados con la menor fricción posible.

## Dirección oficial actual

La fuente de verdad funcional y de roadmap es [`PROJECT_STATE.md`](./PROJECT_STATE.md).

Principios vigentes:

- vincular una vez → elegir destino → enviar → recibir;
- sin salas visibles para el usuario;
- texto, imágenes y archivos viven en los dispositivos, no en almacenamiento cloud de OACLIX;
- LAN directa primero y P2P directo por Internet cuando los dispositivos están en redes distintas;
- no depender de TURN/relay de pago ni generar costos variables por GB;
- si una red impide una conexión P2P directa, la transferencia debe fallar antes de generar un cobro;
- compartir desde otras apps hacia OACLIX y desde OACLIX hacia otras apps mediante las capacidades nativas del sistema;
- historial/recientes guardados localmente en el dispositivo.

Los PR y ramas históricos pueden contener arquitectura, interfaz o roadmap anteriores. **No deben usarse como dirección actual del producto.** Consultar siempre `PROJECT_STATE.md` antes de continuar desarrollo.

## Verificación web

```bash
npm ci
npm test
npm run lint
npm run build
```

## Verificación Android

```bash
cd android
./gradlew testDebugUnitTest assembleDebug --no-daemon
```

Este repositorio usa configuración de desarrollo y no incluye credenciales, secretos ni material de firma de producción.
