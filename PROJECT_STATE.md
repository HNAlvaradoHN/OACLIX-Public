# OACLIX — Estado y dirección oficial

> **Fuente de verdad actual del producto.**
>
> Antes de continuar desarrollo, cualquier chat o colaborador debe leer este archivo y comprobar el estado real de `main`, ramas, PR y CI. Si una rama, PR o documento histórico contradice este archivo, **este archivo define la dirección funcional vigente**, salvo una decisión posterior documentada explícitamente.

## 1. Idea de producto vigente

OACLIX debe mover contenido entre dispositivos con el menor número posible de pasos:

**Vincular una vez → seleccionar o compartir contenido → elegir dispositivo → enviar → recibir.**

El usuario no debe tener que entender salas, WebRTC, señalización, rutas de transporte ni infraestructura interna.

La dirección anterior centrada en salas visibles, una experiencia tipo **General**, Transfer Control Plane / Transfer Engine como roadmap de producto y migraciones progresivas de esa interfaz queda sustituida.

Git conserva el historial. El proyecto activo conserva solo lo que siga sirviendo al producto vigente.

## 2. Principios no negociables

### Local-first y privacidad

- El contenido del usuario vive en sus dispositivos.
- OACLIX no debe almacenar en nube textos, imágenes, videos, documentos, archivos ni historial del usuario.
- Si un elemento se conserva en OACLIX, se guarda localmente en el dispositivo correspondiente.
- Una transferencia a otro dispositivo crea una copia local en el receptor.
- No registrar payload, nombres privados, rutas locales, URIs sensibles, secretos, claves privadas ni credenciales en telemetría innecesaria.
- Dispositivos y usuarios deben permanecer correctamente aislados.

### Costo de transferencia

- Objetivo obligatorio del núcleo: **$0 de gasto recurrente/variable por tráfico de usuarios**.
- No depender de TURN o relay de pago para que el MVP funcione.
- No activar servicios facturables por GB sin aprobación explícita.
- Si una conexión directa no es posible y la única alternativa genera un costo no aprobado, la transferencia falla de forma clara antes de producir ese costo.

### Transporte

Orden aprobado:

1. LAN directa cuando sea posible;
2. P2P directo por Internet entre redes distintas, después;
3. sin TURN/relay de pago en el MVP.

El servicio cloud puede manejar identidad, vinculación, presencia y metadata técnica de señalización. **El payload del usuario no pertenece al WebSocket/cloud del nuevo flujo.**

## 3. Experiencia principal

### Desde cualquier aplicación

**Compartir → OACLIX → elegir dispositivo vinculado → enviar.**

El primer flujo vertical es texto. Después de demostrarlo físicamente se ampliará el mismo contrato a imágenes y archivos genéricos.

### Desde OACLIX

La aplicación debe permitir:

- ver contenido reciente/local;
- ver contenido recibido;
- guardar o seleccionar contenido del dispositivo;
- elegir un dispositivo vinculado y enviarlo;
- compartir un elemento hacia WhatsApp, Telegram, Gmail u otra app compatible mediante el share sheet nativo.

OACLIX no controla qué conversación elige el usuario dentro de otra app.

## 4. Contrato de recepción de texto

Para una transferencia directa de texto:

1. el receptor valida la transferencia;
2. guarda el texto localmente;
3. copia el texto al Android Clipboard;
4. solo después responde ACK `stored` por DataChannel;
5. el emisor muestra éxito únicamente después de recibir ese ACK real.

Si la transferencia está vencida responde `expired`. Si el almacenamiento o el portapapeles requerido falla, responde `rejected` y el emisor no debe mostrar éxito.

El guardado recibido es idempotente por `itemId`: un reintento idéntico no duplica contenido y una colisión distinta se rechaza.

## 5. Interfaz vigente

La interfaz nueva prioriza:

- dispositivos vinculados;
- recientes / historial local;
- agregar o seleccionar contenido;
- enviar;
- compartir.

No exponer conceptos técnicos de transporte.

Fuera del MVP inmediato:

- panel lateral flotante;
- automatizaciones avanzadas;
- nube de contenido;
- sincronización cloud de historial;
- salas visibles;
- relay/TURN de pago;
- funciones decorativas que retrasen el flujo principal.

## 6. Vinculación

El usuario vincula sus dispositivos una vez y luego los reconoce por una identidad/nombre comprensible.

Después de vincular, el flujo cotidiano debe ser:

**contenido → dispositivo → enviar.**

Los identificadores y mecanismos internos de coordinación no deben convertirse en salas visibles ni pasos innecesarios.

## 7. Seguridad y arquitectura

- La identidad Android usa el material protegido por Keystore ya existente.
- La señalización debe ser metadata-only.
- `NativeDirectSignalProtocol` cubre presencia, `ready`, SDP e ICE.
- `NativeDirectTextProtocol` cubre payload y ACK exclusivamente para DataChannel.
- El peer LAN usa WebRTC/DataChannel cifrado y, en este gate, `iceServers = []`.
- No hay TURN, relay pagado ni fallback cloud de contenido en el flujo Android directo.
- El Android foreground debe tener **una sola sesión realtime por dispositivo**, para evitar que sockets concurrentes compitan por presencia/señales.
- El WebSocket de esa sesión solo puede emitir frames `signal` válidos de SDP/ICE; no debe transportar texto ni ACK.

`SECURITY.md` sigue siendo aplicable cuando no contradiga esta dirección.

## 8. Decisiones sustituidas o pospuestas

Quedan fuera del flujo Android activo del nuevo producto:

- destino visible `General`;
- `NativeDeviceShareTransport` de texto por WebSocket cloud;
- envío/recepción Android de imagen por relay cloud;
- preparadores y políticas Android exclusivos de imagen por nube;
- múltiples WebSockets realtime simultáneos por el mismo dispositivo.

El backend/PWA histórico todavía puede contener rutas legacy de relay. Eso **no las convierte en transporte aprobado para el nuevo Android** y no deben reutilizarse por inercia.

Imágenes directas, archivos genéricos y P2P entre redes distintas se posponen hasta demostrar el flujo físico de texto LAN.

## 9. Checkpoints integrados

### Etapa A — experiencia nativa local

- PR #10: primera experiencia visible nativa integrada mediante checkpoint `880a59797adeaa27a488f805c0bde9bd62e79848`.
- CI #154 verificó Web/Worker + Android después de integrar ese checkpoint.
- PR #11 cerró la documentación de Etapa A.

La Etapa A incluye:

- pantalla principal nativa;
- dispositivos vinculados visibles;
- texto e imágenes locales;
- copiar, compartir mediante share sheet nativo y eliminar;
- botón `Agregar` para texto, portapapeles, imagen y vinculación.

### Etapa B — contratos y peer directo

- PR #13 inició Etapa B y cerró la auditoría de reutilización en `docs/STAGE_B_TEXT_AUDIT.md`.
- PR #13 separó señalización metadata-only de payload/ACK directo; CI #159 quedó verde.
- PR #13 quedó integrado mediante `7acf915da3eb6b3039cfde0f3fd9da64115220dd`.
- PR #14 añadió `NativeDirectTextPeerManager` con WebRTC/DataChannel LAN, sin TURN/relay y sin payload cloud.
- PR #14 quedó integrado en `main` mediante `1477b7ec57b0ce9b3879e29bb13609d84b27f2e3`.
- CI #163 verificó el `main` posterior a PR #14 en Web/Worker + Android.

## 10. Checkpoint de desarrollo actual — PR #15

PR #15, rama `feat/native-direct-text-realtime-session`, conecta el peer directo al flujo Android real:

- una sola `NativeDirectTextSessionController` posee el WebSocket realtime durante el foreground;
- el WebSocket se limita a identidad/presencia y señalización SDP/ICE;
- el Share Sheet de texto lista dispositivos vinculados y usa `sendDirectText(...)`;
- el payload y el ACK viajan únicamente por WebRTC DataChannel;
- el receptor persiste de forma idempotente, copia al Android Clipboard y recién entonces responde `stored`;
- el emisor solo completa con éxito al recibir `stored`;
- el flujo Android visible ya no ofrece `General`;
- las imágenes del Share Sheet quedan locales hasta implementar imagen directa;
- se eliminaron transportes Android de payload cloud y helpers huérfanos relacionados.

Verificación de implementación antes de esta actualización documental:

- CI #186 sobre `b2402625cffa9a30a56481f10b1c095fd896d0ba`: **Web/Worker ✅ y Android `testDebugUnitTest + assembleDebug` ✅**.
- La prueba física de dos Android en la misma LAN **todavía no se ha realizado** y no debe marcarse como completada.

Estado integrado al momento de esta actualización:

- `main`: `1477b7ec57b0ce9b3879e29bb13609d84b27f2e3` antes de integrar PR #15.
- desarrollo: PR #15.
- Siempre verificar GitHub en vivo antes de asumir que estos refs siguen siendo los últimos.

## 11. Nuevo MVP — criterio de terminado

El primer MVP dispositivo-a-dispositivo queda demostrado cuando, entre dos Android reales vinculados en la misma LAN:

1. una app comparte texto hacia OACLIX;
2. OACLIX permite elegir el dispositivo receptor;
3. el texto viaja por DataChannel directo;
4. el receptor lo guarda localmente;
5. el receptor lo coloca en Android Clipboard;
6. el receptor responde `stored` después de esos pasos;
7. el emisor muestra éxito solo después del ACK;
8. el texto aparece en recientes y puede pegarse/compartirse desde el receptor;
9. no se observa payload de usuario transitando por el WebSocket/cloud.

Ese gate físico es obligatorio antes de ampliar a imágenes, archivos o P2P entre redes distintas.

## 12. Siguiente paso exacto

Primero cerrar la integración de PR #15:

1. ejecutar CI final después de esta actualización de estado;
2. verificar que `main` no cambió y que no existe trabajo paralelo conflictivo;
3. marcar PR #15 listo e integrarlo solo con CI verde;
4. verificar el CI posterior al merge en `main`.

Después, el siguiente checkpoint de producto es **prueba física de texto entre dos Android reales en la misma LAN**:

**Share Sheet → dispositivo vinculado → DataChannel directo → guardado local → Android Clipboard → ACK `stored` → éxito del emisor.**

Si esa prueba revela un fallo, reproducirlo y corregir la causa antes de continuar.

No comenzar imágenes directas, archivos genéricos, envío desde tarjetas, P2P entre redes, panel, TURN ni relay de contenido hasta cerrar este gate físico.

## 13. Plan vivo

Leyenda: `✅` hecho y verificado por código/CI; `⏳` activo o pendiente de verificación física; `⬜` no iniciado.

### Etapa A — primera experiencia visible en la APK

- ✅ Dirección oficial local-first, sin nube de contenido y sin costo variable por transferencias.
- ✅ Pantalla principal nativa y dispositivos vinculados.
- ✅ Texto e imágenes locales como tarjetas.
- ✅ Copiar, compartir a otras apps y eliminar localmente.
- ✅ Flujo `Agregar`.
- ✅ PR #10 + cierre documental PR #11 integrados y verificados.

### Etapa B — primer flujo real dispositivo a dispositivo

- ✅ Auditoría de reutilización y contratos directos de PR #13.
- ✅ Peer LAN nativo de texto sobre DataChannel de PR #14, sin TURN/relay.
- ✅ Una sola sesión realtime Android para presencia + SDP/ICE, verificada por código/CI en PR #15.
- ✅ Share Sheet de texto → dispositivo vinculado → peer directo, verificado por código/CI en PR #15.
- ✅ Receptor guarda localmente antes de confirmar, verificado por código/tests.
- ✅ Texto recibido se copia a Android Clipboard antes del ACK, verificado por código/tests.
- ✅ Emisor completa éxito solo con ACK `stored`, verificado por código/tests.
- ⏳ Integrar PR #15 y verificar CI de `main`.
- ⬜ Probar el flujo completo entre dos Android reales en la misma LAN.

### Etapa C — ampliar el mismo contrato

- ⬜ Reutilizar el transporte directo para imágenes.
- ⬜ Tratar archivos genéricos con un transporte común: PDF, Word, Excel, APK, ZIP, video y otros tipos compartibles.
- ⬜ P2P directo entre redes distintas sin TURN/relay de pago en el MVP.
- ⬜ Permitir enviar desde las tarjetas locales usando el mismo contrato ya probado.

### Después del núcleo funcional

- ⬜ Favoritos/fijados si aportan valor real.
- ⬜ Accesos directos específicos a apps solo si simplifican el flujo sin fragilidad.
- ⬜ Panel lateral u otras funciones avanzadas después de estabilizar el núcleo.

## 14. Ramas y trabajo histórico

PR #2, #3, #4, #5, #6 y #7 están cerrados como **SUPERSEDED** y no son trabajo pendiente activo.

Las ramas `docs/direct-transfer-research`, `feat/android-direct-image-native`, `feat/android-pwa-shell`, `feat/android-pwa-visual-parity`, `feat/functional-convergence-1`, `feat/transfer-control-plane` y `feat/transfer-engine` son históricas y no definen el roadmap actual.

`scratch-do-not-use` no contiene trabajo oficial.

No fusionar automáticamente trabajo histórico porque esté verde. Reutilizar únicamente piezas que acerquen al flujo vigente y después de auditar su encaje.

## 15. Regla para futuros chats

Un chat nuevo debe:

1. leer este archivo y `CRITICAL_CHAT_CONTINUITY.md`;
2. verificar `main`, CI, ramas activas, PR abiertos/recientes y commits recientes;
3. revisar el código real de la tarea;
4. distinguir checkpoint estable, desarrollo activo y prueba física pendiente;
5. tratar ramas/PR de la dirección anterior como históricos salvo decisión explícita de reutilización;
6. continuar desde el siguiente paso vigente, no desde memoria ni conversaciones antiguas.

Está prohibido reconstruir el roadmap desde documentación histórica aislada.

## 16. Cierre conceptual obligatorio

Antes de rotar de conversación, el repositorio debe permitir entender sin el chat anterior:

- qué producto se está construyendo;
- cómo debe comportarse para el usuario;
- decisiones aprobadas y descartadas;
- privacidad, seguridad, arquitectura y costo;
- qué está `✅`, qué está `⏳` y qué está `⬜`;
- criterios de terminado;
- ramas/PR activos relevantes;
- checkpoint estable y desarrollo activo cuando sean distintos;
- último CI relevante;
- siguiente paso exacto.

Cada etapa significativa debe actualizar este archivo antes de considerarse cerrada.
