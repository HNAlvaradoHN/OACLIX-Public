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

- La versión estable sigue siendo la que exista realmente en `main`; no declarar nuevas funciones como estables hasta integrarlas y verificarlas.
- Las ramas `feat/transfer-control-plane` y `feat/transfer-engine` pertenecen al rumbo anterior y deben considerarse **superseded / no continuar como roadmap activo**.
- El antiguo siguiente paso "Checkpoint 11: migrar imagen local a Transfer Engine" deja de ser el siguiente paso oficial.
- No fusionar automáticamente PR históricos solo porque estén verdes; primero decidir qué partes siguen siendo útiles para el nuevo MVP.

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

Antes de escribir la nueva interfaz, hacer una **auditoría de reutilización** del código existente contra este MVP y clasificar cada componente relevante como:

- reutilizar;
- adaptar;
- eliminar/no continuar.

Después, implementar el primer flujo visible mínimo:

**Android Share Sheet → OACLIX → elegir dispositivo vinculado → transferencia directa → receptor → texto en portapapeles / archivo disponible localmente.**

Empezar por el caso mínimo que permita comprobar el flujo real de extremo a extremo. No construir panel lateral ni funciones avanzadas antes de esa prueba.

## 13. Regla para futuros chats

Un chat nuevo debe:

1. leer este archivo;
2. verificar `main` y CI;
3. revisar PR/ramas abiertas;
4. tratar PR/ramas de la dirección anterior como históricas salvo decisión explícita de reutilización;
5. revisar el código real relacionado con el MVP;
6. continuar desde el siguiente paso vigente de este archivo o de una actualización posterior ya integrada en `main`.

**Está prohibido reconstruir el roadmap desde conversaciones antiguas, PR superseded o documentación de ramas históricas.**
