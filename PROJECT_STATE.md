# OACLIX — Estado y dirección oficial

> **Fuente de verdad actual del producto.**
>
> Antes de continuar desarrollo, cualquier chat o colaborador debe leer este archivo y comprobar el estado real de `main`, ramas, PR y CI. Si una rama, PR o documento histórico contradice este archivo, **este archivo define la dirección funcional vigente**, salvo una decisión posterior documentada explícitamente.

## 1. Cambio oficial de rumbo

La dirección anterior centrada en salas visibles, una experiencia tipo "General", checkpoints internos de Transfer Control Plane / Transfer Engine como roadmap de producto y migraciones progresivas de esa interfaz **queda sustituida**.

No continuar automáticamente Checkpoint 11 ni ningún roadmap antiguo solo porque aparezca en ramas o PR históricos.

El código existente puede reutilizarse si ayuda al nuevo producto, pero **no debe conservarse una arquitectura, interfaz o flujo únicamente porque ya fue construido**.

Git conserva el historial. El proyecto activo debe reflejar solo la dirección vigente.

## 2. Propósito actual

OACLIX debe permitir mover contenido entre dispositivos con el menor número posible de pasos:

**Vincular una vez → seleccionar o compartir contenido → elegir dispositivo → enviar → recibir.**

El usuario no debe tener que entender salas, rutas de transporte, WebRTC, señalización ni conceptos internos.

## 3. Principios no negociables

### Local-first

- El contenido del usuario vive en sus dispositivos.
- OACLIX no almacena en nube textos, imágenes, videos, documentos, archivos ni historial del usuario.
- Si un elemento se conserva en OACLIX, se guarda localmente en el dispositivo correspondiente.
- Si se envía a otro dispositivo, la copia recibida queda localmente en ese dispositivo.

### Sin costo variable por transferencias

- Objetivo obligatorio del núcleo: **$0 de gasto recurrente/variable por tráfico de usuarios**.
- No depender de TURN o relay de pago para que el producto básico funcione.
- No activar servicios que puedan facturar por GB sin aprobación explícita.
- Si una conexión directa no es posible y la única alternativa generaría un costo no aprobado, la transferencia debe fallar de forma clara antes de producir ese costo.

### Dispositivo a dispositivo

Orden deseado de transporte:

1. conexión directa en LAN cuando sea posible;
2. P2P directo por Internet entre redes distintas;
3. no usar relay de pago en el MVP.

Un servicio pequeño de señalización/vinculación puede intercambiar únicamente metadata técnica necesaria para que los dispositivos se encuentren. **No debe almacenar contenido del usuario.**

## 4. Experiencia principal

### Desde cualquier aplicación

El usuario debe poder usar el menú nativo de compartir:

**Compartir → OACLIX → elegir dispositivo vinculado → enviar.**

OACLIX debe aspirar a recibir cualquier contenido que el sistema permita compartir, incluyendo:

- texto;
- imágenes;
- videos;
- PDF;
- ZIP;
- documentos;
- archivos de otros formatos.

El transporte debe tratar archivos de forma genérica cuando sea razonable, sin diseñar una implementación distinta para cada extensión.

### Desde OACLIX

La aplicación debe permitir:

- ver elementos recientes/locales gestionados por OACLIX;
- ver contenido recibido;
- buscar o seleccionar contenido del dispositivo mediante APIs/selector del sistema;
- elegir un dispositivo vinculado y enviarlo;
- usar **Compartir** para entregar un elemento a WhatsApp, Telegram, Gmail u otra app compatible mediante el share sheet nativo del sistema.

OACLIX no controla qué conversación elige el usuario dentro de otra aplicación. Solo entrega correctamente el contenido al sistema de compartir.

## 5. Recepción

Cuando llega contenido:

- se guarda únicamente en el dispositivo receptor según el tipo y la acción correspondiente;
- debe aparecer en recientes/historial local cuando aplique;
- texto recibido debe quedar disponible en el portapapeles para pegar inmediatamente;
- imágenes deben poder copiarse/pegarse cuando las APIs y la app destino lo soporten, y siempre permanecer disponibles localmente para abrir/compartir/guardar;
- archivos deben poder abrirse, guardarse o volver a compartirse desde el dispositivo receptor.

No confundir "transferencia aceptada" con "transferencia terminada". La interfaz solo debe mostrar éxito cuando el contenido realmente llegó según el contrato de esa operación.

## 6. Interfaz nueva

La interfaz anterior basada en salas/General **no define el nuevo producto**.

La nueva experiencia debe priorizar, de manera simple:

- dispositivos vinculados;
- recientes / historial local;
- buscar o seleccionar contenido del móvil;
- enviar;
- compartir.

No exponer al usuario conceptos técnicos de transporte.

### Fuera del MVP actual

- panel lateral flotante;
- automatizaciones avanzadas;
- nube de contenido;
- sincronización cloud de historial;
- salas visibles;
- relay/TURN de pago;
- funciones decorativas que retrasen el flujo principal.

El panel lateral puede reconsiderarse después de que el flujo principal funcione bien.

## 7. Vinculación

El usuario vincula sus dispositivos una vez y luego los reconoce por una identidad/nombre comprensible.

Después de vincular, el flujo cotidiano debe ser simplemente:

**contenido → dispositivo → enviar.**

Los identificadores internos o mecanismos de coordinación pueden existir, pero no deben convertirse en "salas" visibles ni en pasos innecesarios para el usuario.

## 8. Seguridad y privacidad

- No exponer secretos, credenciales, claves privadas ni contenido real en logs.
- Aislar correctamente dispositivos/usuarios.
- Validar desde el lado confiable cualquier acción que afecte seguridad o datos.
- Metadata técnica persistente debe ser mínima y tener limpieza/expiración cuando corresponda.
- No registrar nombres privados, rutas locales, URIs sensibles o payload del usuario en telemetría innecesaria.
- Mantener cifrado apropiado para el contenido en tránsito.

`SECURITY.md` sigue siendo aplicable cuando no contradiga esta dirección.

## 9. Qué hacer con el trabajo anterior

Las ramas y PR antiguos pueden contener piezas reutilizables, por ejemplo:

- vinculación de dispositivos;
- descubrimiento/presencia;
- transporte directo;
- WebRTC/DataChannel;
- validación e integridad;
- adaptadores de texto/imagen;
- manejo de recepción;
- seguridad y aislamiento.

Pero deben evaluarse por utilidad para el nuevo flujo.

**No continuar un checkpoint histórico por inercia.**

Si una pieza añade complejidad sin acercar al usuario a:

**seleccionar → elegir dispositivo → enviar → recibir**, debe cuestionarse o retirarse.

## 10. Estado de desarrollo tras el cambio de dirección

- Checkpoint estable de producto: PR #10, integrado mediante el commit `880a59797adeaa27a488f805c0bde9bd62e79848`; ese SHA identifica el checkpoint de producto, **no debe tratarse como el HEAD permanente de `main`**.
- El HEAD real de `main` debe verificarse siempre en GitHub al iniciar o cerrar trabajo; commits documentales posteriores pueden moverlo sin cambiar la versión funcional del producto.
- CI #154 sobre el checkpoint integrado quedó verde en Web/Worker y Android; Android completó `testDebugUnitTest` y `assembleDebug`.
- PR #10 (`feat/native-mvp-home`) está integrado y cierra la primera experiencia visible nativa del nuevo rumbo.
- PR #11 integró el cierre documental de esa Etapa A; no introduce cambios funcionales.
- PR #2, #3, #4, #5, #6 y #7 están **cerrados como SUPERSEDED** y no son trabajo pendiente activo.
- Las ramas históricas `docs/direct-transfer-research`, `feat/android-direct-image-native`, `feat/android-pwa-shell`, `feat/android-pwa-visual-parity`, `feat/functional-convergence-1`, `feat/transfer-control-plane` y `feat/transfer-engine` no definen el roadmap actual.
- `scratch-do-not-use` no contiene trabajo oficial y no debe usarse.
- El antiguo siguiente paso "Checkpoint 11: migrar imagen local a Transfer Engine" queda cancelado como siguiente paso oficial.
- No fusionar automáticamente ramas o PR históricos porque estén verdes; primero decidir qué piezas siguen siendo útiles para el nuevo MVP.
- Documentación antigua que exista dentro de ramas históricas es solo historial y no puede reemplazar esta fuente de verdad.
- Etapa B inició en PR #13 (`feat/native-direct-text-stage-b`) desde `main` `f51883cbe93d36db9df770565695a98fe5a944c3`.
- La auditoría de reutilización para texto está cerrada en `docs/STAGE_B_TEXT_AUDIT.md`: identidad/vinculación, roster, almacenamiento local, Android Clipboard y señalización técnica se reutilizan; las rutas de contenido por D1/WebSocket cloud no continúan como transporte del nuevo flujo.
- PR #13 define dos contratos separados: `NativeDirectSignalProtocol` para metadata de presencia/SDP/ICE y `NativeDirectTextProtocol` para payload/ACK destinado exclusivamente al DataChannel.
- CI #159 sobre PR #13 quedó verde en Web/Worker y Android, incluido `testDebugUnitTest` + `assembleDebug`.

## 11. Nuevo MVP

El MVP debe demostrar de extremo a extremo, de forma visible y probada:

1. vincular dos dispositivos;
2. compartir/seleccionar un elemento;
3. elegir el dispositivo receptor;
4. transferir directamente sin almacenamiento cloud de contenido;
5. recibir y guardar localmente;
6. texto recibido disponible para pegar;
7. volver a compartir contenido recibido mediante el sistema nativo.

Primero debe funcionar un flujo vertical real antes de ampliar la interfaz o añadir extras.

## 12. Siguiente paso exacto

La Etapa A está cerrada. En Etapa B ya quedó cerrada y verificada la auditoría del primer flujo de texto y quedaron definidos los contratos de señalización metadata-only y de payload/ACK directo.

El siguiente checkpoint exacto es **construir el peer nativo LAN específico de texto**:

1. partir del `main` que resulte después de integrar PR #13 y volver a comprobar trabajo paralelo;
2. añadir WebRTC con verificación de dependencia intacta; no desactivar controles de Gradle;
3. usar inicialmente `iceServers = []` para demostrar conexión LAN directa sin TURN/relay;
4. usar el backend existente únicamente para presencia + SDP/ICE de `NativeDirectSignalProtocol`;
5. enviar `NativeDirectTextProtocol` únicamente por DataChannel; nunca por el WebSocket cloud;
6. en el receptor, validar y guardar en `LocalClipboardHistory`, después copiar con `OaclixClipboardBridge`, y solo entonces responder ACK `stored`;
7. el emisor no declara éxito sin ese ACK real;
8. después de probar el peer por código/CI, conectar el selector ya existente del Android Share Sheet;
9. cerrar el bloque con gate físico entre dos Android en la misma LAN.

No exponer todavía envío desde las tarjetas locales hasta que este mismo contrato directo esté demostrado extremo a extremo. No incluir todavía imágenes, archivos genéricos, favoritos, panel, TURN ni relay de contenido.

## 13. Regla para futuros chats

Un chat nuevo debe:

1. leer este archivo;
2. leer `CRITICAL_CHAT_CONTINUITY.md`;
3. verificar `main` y CI;
4. revisar PR/ramas abiertas;
5. tratar PR/ramas de la dirección anterior como históricas salvo decisión explícita de reutilización;
6. revisar el código real relacionado con el MVP;
7. comprobar que el cierre del chat anterior documentó tanto el **estado técnico** como la **idea vigente**, sus decisiones y el plan restante;
8. continuar desde el siguiente paso vigente de este archivo o de una actualización posterior ya integrada en `main`.

**Está prohibido reconstruir el roadmap desde conversaciones antiguas, PR superseded o documentación de ramas históricas.**

## 14. Plan vivo de la nueva idea

Leyenda: `✅` hecho y verificado en su etapa; `⏳` en desarrollo o pendiente de verificación; `⬜` todavía no iniciado.

### Etapa A — primera experiencia visible en la APK

- ✅ Dirección oficial local-first, sin nube de contenido y sin costo variable por transferencias.
- ✅ Pantalla principal nativa nueva integrada desde PR #10.
- ✅ Dispositivos vinculados reales visibles arriba y acceso a Vinculados.
- ✅ Texto e imágenes locales mostrados como tarjetas con miniatura cuando aplica.
- ✅ Acciones locales `Copiar`, `Compartir` mediante share sheet nativo y `Eliminar`.
- ✅ Botón único `Agregar` con escribir texto, guardar desde portapapeles, elegir imagen y vincular dispositivo.
- ✅ Compartir una tarjeta hacia WhatsApp, Telegram, Gmail u otra app compatible queda delegado al share sheet nativo; no se crean accesos directos específicos todavía.
- ✅ Gate final Web/Worker + Android verde en CI #153 antes de integrar.
- ✅ PR #10 integrado a `main` mediante el checkpoint `880a59797adeaa27a488f805c0bde9bd62e79848`.
- ✅ Estado integrado verificado nuevamente en CI #154; Android ensambló `debug` correctamente.
- ✅ Cierre documental de la etapa integrado mediante PR #11.

### Etapa B — primer flujo real dispositivo a dispositivo

- ✅ Auditoría de vinculación, señalización, LAN/DataChannel, almacenamiento y recepción cerrada en PR #13.
- ✅ Contratos separados para señalización metadata-only y texto/ACK directo definidos y verificados por CI #159.
- ⏳ Peer nativo LAN de texto sobre DataChannel, sin payload cloud.
- ⬜ Texto desde Android Share Sheet → elegir dispositivo vinculado → usar el peer directo.
- ⬜ Receptor guarda localmente antes de confirmar éxito.
- ⬜ Texto recibido queda en Android Clipboard listo para pegar.
- ⬜ Emisor muestra éxito solo después del ACK real del receptor.
- ⬜ Probar el flujo entre dos dispositivos Android reales en la misma LAN.

### Etapa C — ampliar el mismo contrato sin duplicar arquitectura

- ⬜ Reutilizar el flujo directo para imágenes.
- ⬜ Tratar archivos genéricos con un transporte común cuando sea razonable: PDF, Word, Excel, APK, ZIP, video y otros tipos compartibles.
- ⬜ P2P directo entre redes diferentes sin TURN/relay de pago en el MVP.
- ⬜ Permitir enviar desde las tarjetas de la pantalla principal usando el mismo contrato ya probado.

### Después del núcleo funcional

- ⬜ Favoritos/fijados si aportan valor al uso diario.
- ⬜ Accesos directos específicos a apps como WhatsApp/Telegram, solo si simplifican el flujo sin fragilidad innecesaria.
- ⬜ Panel lateral u otras funciones avanzadas únicamente después de que el núcleo sea estable.

Cada etapa significativa debe actualizar esta lista: lo terminado pasa a `✅`, lo activo a `⏳` y el siguiente paso exacto debe quedar escrito en la sección 12.

## 15. Cierre conceptual obligatorio de cada chat

Antes de rotar de conversación, el repositorio debe dejar documentado **qué idea se definió y cómo terminarla**, no únicamente qué archivos cambiaron.

El cierre debe registrar como mínimo:

- la idea de producto vigente en palabras claras;
- la experiencia de usuario acordada;
- decisiones aprobadas y sus razones cuando importen;
- decisiones sustituidas, descartadas o pospuestas;
- restricciones de privacidad, seguridad, arquitectura y costos;
- alcance actual y elementos fuera del alcance inmediato;
- qué partes de la idea ya están `✅` resueltas y verificadas;
- qué parte está `⏳` activa;
- qué pasos `⬜` faltan, en orden lógico;
- qué prueba o criterio convierte cada paso en terminado;
- el siguiente paso exacto para continuar.

Si durante un chat aparece una nueva idea o se modifica una anterior, el plan vivo debe actualizarse antes de cerrar el chat. **El siguiente chat debe poder entender qué estamos construyendo, por qué, qué falta y en qué orden, sin leer la conversación anterior.**
