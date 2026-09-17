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

Decisión de UX local aprobada, todavía no implementada: cada elemento podrá elegir retención de **1 h, 3 h, 6 h, 12 h, 24 h o Permanente**. Se mantiene **6 h como valor predeterminado** y habrá una acción rápida **Mantener** para convertir un elemento temporal en permanente. Esta decisión aplica a texto, imágenes y archivos locales y no implica nube.

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
- Los `.txt` locales largos compartidos hacia otras apps se exponen únicamente mediante un `ContentProvider` de solo lectura, con URI temporal y validación estricta del archivo local permitido.
- Los archivos genéricos locales se copian a almacenamiento privado de la app y se comparten mediante un `ContentProvider` separado de solo lectura, con URI temporal; el proveedor valida autoridad, nombre interno, ruta canónica y vencimiento antes de exponer bytes.

`SECURITY.md` sigue siendo aplicable cuando no contradiga esta dirección.

## 8. Decisiones sustituidas o pospuestas

Quedan fuera del flujo Android activo del nuevo producto:

- destino visible `General`;
- `NativeDeviceShareTransport` de texto por WebSocket cloud;
- envío/recepción Android de imagen por relay cloud;
- preparadores y políticas Android exclusivos de imagen por nube;
- múltiples WebSockets realtime simultáneos por el mismo dispositivo.

El backend/PWA histórico todavía puede contener rutas legacy de relay. Eso **no las convierte en transporte aprobado para el nuevo Android** y no deben reutilizarse por inercia.

Imágenes directas, envío directo de archivos genéricos y P2P entre redes distintas se posponen hasta demostrar el flujo físico de texto LAN. La selección/retención local de archivos genéricos sí forma parte de la experiencia Android local.

## 9. Checkpoints integrados

### Etapa A — experiencia nativa local

- PR #10: primera experiencia visible nativa integrada mediante checkpoint `880a59797adeaa27a488f805c0bde9bd62e79848`.
- CI #154 verificó Web/Worker + Android después de integrar ese checkpoint.
- PR #11 cerró la documentación de Etapa A.

La Etapa A incluye:

- pantalla principal nativa;
- dispositivos vinculados visibles;
- texto, imágenes y archivos genéricos locales;
- copiar texto/imágenes cuando existe un contrato de portapapeles útil, compartir mediante share sheet nativo y eliminar;
- botón `Agregar` para escribir texto, guardar portapapeles, elegir imagen y elegir archivo;
- vinculación accesible desde la interfaz principal sin duplicarla dentro de `Agregar`;
- Photo Picker nativo en Android 13+ y selector de galería compatible en Android anteriores soportados;
- textos locales mayores de 8.000 caracteres almacenados como `.txt` privado hasta 384 KB y compartidos a otras apps como archivo `.txt` real;
- archivos genéricos seleccionados mediante el selector de documentos, copiados por streaming a almacenamiento privado, retenidos seis horas y disponibles para compartir/eliminar localmente;
- los archivos genéricos no tienen un límite artificial de MB impuesto por OACLIX en esta ruta local; el límite práctico es el almacenamiento/IO disponible del dispositivo.

### Etapa B — contratos, peer y conexión al flujo real

- PR #13 cerró la auditoría de reutilización en `docs/STAGE_B_TEXT_AUDIT.md` y separó señalización metadata-only de payload/ACK directo; integrado mediante `7acf915da3eb6b3039cfde0f3fd9da64115220dd`.
- CI #159 verificó PR #13.
- PR #14 añadió `NativeDirectTextPeerManager` con WebRTC/DataChannel LAN, sin TURN/relay y sin payload cloud; integrado mediante `1477b7ec57b0ce9b3879e29bb13609d84b27f2e3`.
- CI #163 verificó el `main` posterior a PR #14.
- PR #15 conectó el peer al flujo Android real y quedó integrado mediante `6e563c7d9b697fa572695bb9b0d2c5597117b176`.
- CI #187 verificó el head final de PR #15 en Web/Worker y Android.
- CI #188 verificó el `main` posterior al merge de PR #15 en Web/Worker y Android, incluido `testDebugUnitTest + assembleDebug`.
- PR #16 hizo recuperable el APK debug verificado desde builds exitosos de `main`, con retención corta y SHA-256; integrado mediante `f0ca6d1f3606e0cef83a718225ee6a7633957010`.
- CI #191 verificó PR #16 en `main` y publicó el primer artefacto APK de ese flujo.
- PR #17 pulió la experiencia local observada durante la prueba: Photo Picker/galería, eliminación de la vinculación duplicada en `Agregar` y compartir texto largo como `.txt`; integrado mediante `22b959ee00912b33778cdc4b4f5f2b0d60e12c98`.
- CI #192 verificó el head final de PR #17 y CI #193 verificó el `main` posterior al merge, incluido `testDebugUnitTest + assembleDebug` y publicación del APK.
- PR #18 añadió la ruta local de archivos genéricos (`Elegir archivo` → copia privada → tarjeta local → Compartir/Eliminar) sin añadir transporte directo de archivos; integrado mediante `2875d21c178cba5ea60655e8e69a312b951df209`.
- CI #195 verificó el head final de PR #18 en Web/Worker y Android. CI #196 verificó el `main` posterior al merge: su primer intento Android falló antes de probar código por un `Connection reset by peer` al descargar Gradle; el reintento del mismo commit pasó `testDebugUnitTest + assembleDebug` y publicó el APK sin cambio de código.
- Durante la validación física del APK #197 se detectó que una instalación limpia intentaba resolver el placeholder `oaclix.invalid` como backend real, impidiendo generar códigos de vinculación.
- PR #19 intentó restaurar un endpoint de despliegue dentro del snapshot público, pero la auditoría lo rechazó correctamente; se cerró **sin integrar** y no se debilitó la protección de publicación.
- PR #20 corrigió la causa sin incrustar endpoints de despliegue en el repositorio público: el backend sin configurar queda vacío, los hosts `.invalid` se rechazan y **Vinculados** ofrece `Configurar conexión` para guardar localmente una URL HTTPS válida; integrado mediante `c5db993ef7491b2a4a8f1c452102c6cb067c795b`.
- CI #199 verificó el head final de PR #20 con auditoría pública, Web/Worker y Android verdes. CI #200 verificó el `main` posterior al merge, incluido `testDebugUnitTest + assembleDebug` y publicación del APK.

No hay PR abiertos al cerrar este checkpoint.

## 10. Estado integrado actual

El flujo Android de texto directo ya está integrado en `main`:

- una sola `NativeDirectTextSessionController` posee el WebSocket realtime durante el foreground;
- el WebSocket se limita a identidad/presencia y señalización SDP/ICE;
- el Share Sheet de texto lista dispositivos vinculados y usa `sendDirectText(...)`;
- payload y ACK viajan únicamente por WebRTC DataChannel;
- el receptor persiste de forma idempotente, copia al Android Clipboard y recién entonces responde `stored`;
- el emisor solo completa con éxito al recibir `stored`;
- el flujo Android visible ya no ofrece `General`;
- las imágenes del Share Sheet quedan locales hasta implementar imagen directa;
- se eliminaron transportes Android de payload cloud y helpers huérfanos relacionados.

La experiencia local Android integrada además incluye:

- `Agregar` sin la acción duplicada de vinculación;
- selección de imágenes mediante Photo Picker en Android 13+ y selector visual compatible en versiones anteriores soportadas;
- texto local de hasta 8.000 caracteres almacenado inline;
- texto local mayor de 8.000 caracteres almacenado completo como `.txt` privado, con límite actual de 384 KB;
- al compartir hacia otra app, el texto largo se entrega como archivo `.txt` de solo lectura con permiso URI temporal;
- `Elegir archivo` para archivos genéricos mediante `ACTION_OPEN_DOCUMENT`;
- copia por streaming del archivo elegido a almacenamiento privado `oaclix-files`, con retención de seis horas y sin nube;
- tarjeta local de archivo con extensión, nombre y tamaño; para archivos genéricos se ofrecen Compartir y Eliminar, pero no Copiar porque Android no define un contrato universal de “pegar archivo” comparable al texto/imagen;
- compartir archivos genéricos a otras apps conserva el MIME detectado y usa URI temporal de solo lectura;
- el envío directo dispositivo-a-dispositivo de texto **sigue limitado a 8.000 caracteres** y ni el `.txt` grande ni los archivos genéricos forman parte todavía del protocolo directo;
- una instalación pública sin backend inyectado ya no intenta resolver un host ficticio: queda explícitamente sin configurar;
- `NativeBackendConfig` rechaza hosts `.invalid`;
- la pantalla **Vinculados** permite configurar una URL HTTPS de conexión y la guarda solo en preferencias locales del dispositivo;
- el snapshot público sigue prohibiendo endpoints de despliegue reales; la configuración del backend pertenece al despliegue/instalación, no al código público.

Último checkpoint funcional integrado y verificado:

- checkpoint funcional de `main`: `c5db993ef7491b2a4a8f1c452102c6cb067c795b`.
- CI del head de PR: #199, auditoría pública ✅, Web/Worker ✅ y Android ✅.
- CI post-merge: #200, Web/Worker ✅ y Android ✅, incluido APK debug publicado.
- PR #19 quedó cerrado sin integrar porque violaba deliberadamente la auditoría pública al incrustar un endpoint de despliegue.
- PR abiertos: 0.
- Desarrollo activo paralelo: ninguno.
- La prueba física de dos Android en la misma LAN **todavía no se ha completado**.

Por tanto, el código está integrado y compilado, pero el primer MVP dispositivo-a-dispositivo todavía no debe declararse físicamente probado.

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

Ese gate físico es obligatorio antes de ampliar el transporte directo a imágenes, archivos o P2P entre redes distintas.

## 12. Siguiente paso exacto

El siguiente checkpoint de producto es **prueba física de texto entre dos Android reales vinculados en la misma LAN**:

**Share Sheet → dispositivo vinculado → DataChannel directo → guardado local → Android Clipboard → ACK `stored` → éxito del emisor.**

Orden de ejecución:

1. instalar una APK construida desde el checkpoint funcional integrado actual en ambos Android de prueba;
2. si la APK pública no trae backend inyectado, abrir **Vinculados → Configurar conexión** y guardar en cada dispositivo la URL HTTPS del backend de despliegue autorizado;
3. generar/consumir un código si los dispositivos necesitan volver a vincularse y confirmar que ambos aparecen como destinos;
4. mantener ambos Android en la misma LAN y con OACLIX en foreground para este gate;
5. desde una app externa, compartir un texto hacia OACLIX en el emisor;
6. elegir el otro dispositivo;
7. comprobar recepción local, Android Clipboard y ACK de éxito;
8. repetir al menos en sentido inverso;
9. comprobar además en la APK actual el Photo Picker, compartir un texto local >8.000 caracteres como `.txt` y el flujo local `Elegir archivo` → tarjeta → Compartir/Eliminar;
10. si falla, reproducir el problema, identificar la causa real y corregirla antes de ampliar alcance.

No comenzar imágenes directas, envío directo de archivos genéricos, envío desde tarjetas a otro dispositivo, P2P entre redes, panel, TURN ni relay de contenido hasta cerrar este gate físico.

## 13. Plan vivo

Leyenda: `✅` hecho y verificado por código/CI; `⏳` activo o pendiente de verificación física; `⬜` no iniciado.

### Etapa A — primera experiencia visible en la APK

- ✅ Dirección oficial local-first, sin nube de contenido y sin costo variable por transferencias.
- ✅ Pantalla principal nativa y dispositivos vinculados.
- ✅ Texto e imágenes locales como tarjetas.
- ✅ Copiar, compartir a otras apps y eliminar localmente.
- ✅ Flujo `Agregar` sin vinculación duplicada.
- ✅ Photo Picker/galería para elegir imágenes sin acceso general al almacenamiento.
- ✅ Texto local largo guardado completo como `.txt` hasta 384 KB y compartido hacia otras apps como archivo `.txt`.
- ✅ Archivos genéricos locales: elegir, copiar de forma privada por streaming, mostrar en recientes, compartir y eliminar; retención de seis horas.
- ✅ PR #10 + cierre documental PR #11 integrados y verificados.
- ✅ PR #17 integrado y verificado por CI #193 para el pulido local de imagen/.txt.
- ✅ PR #18 integrado y verificado por CI #195/#196 para archivos genéricos locales.
- ⬜ Implementar retención seleccionable 1 h / 3 h / 6 h / 12 h / 24 h / Permanente y acción rápida Mantener; decisión aprobada, no implementada todavía.

### Etapa B — primer flujo real dispositivo a dispositivo

- ✅ Auditoría de reutilización y contratos directos de PR #13.
- ✅ Peer LAN nativo de texto sobre DataChannel de PR #14, sin TURN/relay.
- ✅ Una sola sesión realtime Android para presencia + SDP/ICE.
- ✅ Share Sheet de texto → dispositivo vinculado → peer directo.
- ✅ Receptor guarda localmente antes de confirmar.
- ✅ Texto recibido se copia a Android Clipboard antes del ACK.
- ✅ Emisor completa éxito solo con ACK `stored`.
- ✅ PR #15 integrado y `main` verificado por CI #188.
- ✅ PR #16 publica APK debug de `main` con SHA-256 y retención corta.
- ✅ PR #20 corrige el setup de backend en instalaciones públicas: sin host ficticio y con configuración explícita desde Vinculados; CI #199/#200 verdes.
- ⏳ Probar físicamente el flujo completo entre dos Android reales en la misma LAN.

### Etapa C — ampliar el mismo contrato

- ⬜ Reutilizar el transporte directo para imágenes.
- ⬜ Añadir transporte directo común para archivos genéricos ya soportados localmente: PDF, Word, Excel, APK, ZIP, video y otros tipos compartibles.
- ⬜ P2P directo entre redes distintas sin TURN/relay de pago en el MVP.
- ⬜ Permitir enviar desde las tarjetas locales usando el mismo contrato ya probado.

### Después del núcleo funcional

- ⬜ Favoritos/fijados si aportan valor real.
- ⬜ Accesos directos específicos a apps solo si simplifican el flujo sin fragilidad.
- ⬜ Panel lateral u otras funciones avanzadas después de estabilizar el núcleo.

## 14. Ramas y trabajo histórico

PR #2, #3, #4, #5, #6 y #7 están cerrados como **SUPERSEDED** y no son trabajo pendiente activo. PR #19 también está cerrado sin integrar: su enfoque de incrustar el endpoint de despliegue en el snapshot público fue rechazado por la auditoría y sustituido por PR #20.

Las ramas `docs/direct-transfer-research`, `feat/android-direct-image-native`, `feat/android-pwa-shell`, `feat/android-pwa-visual-parity`, `feat/functional-convergence-1`, `feat/transfer-control-plane` y `feat/transfer-engine` son históricas y no definen el roadmap actual.

`scratch-do-not-use` no contiene trabajo oficial.

No fusionar automáticamente trabajo histórico porque esté verde. Reutilizar únicamente piezas que acerquen al flujo vigente y después de auditar su encaje.

## 15. Regla para futuros chats

Un chat nuevo debe:

1. leer este archivo y `CRITICAL_CHAT_CONTINUITY.md`;
2. verificar `main`, CI, ramas activas, PR abiertos/recientes y commits recientes;
3. revisar el código real de la tarea;
4. distinguir checkpoint integrado/CI de prueba física real;
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
