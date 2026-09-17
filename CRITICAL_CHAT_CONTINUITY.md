# Regla crítica — continuidad y rotación preventiva de chats

Esta regla es obligatoria para cualquier chat que trabaje en OACLIX.

## Principio

**Nunca esperar a que un chat llegue al límite, se sature o quede atascado para cambiar de conversación.**

ChatGPT no dispone de un medidor fiable y visible que permita saber exactamente cuánto contexto queda. Por eso la continuidad del proyecto debe protegerse de forma preventiva.

## Cuándo rotar de chat

Antes de iniciar una nueva etapa significativa, evaluar si el chat actual ya acumula demasiado contexto operativo, por ejemplo:

- varios checkpoints terminados;
- muchas llamadas a herramientas;
- logs extensos de CI;
- múltiples capturas o archivos;
- cambios de arquitectura o decisiones importantes;
- varias ramas, PR o correcciones revisadas en la misma conversación.

Si el chat ya está cargado, **no iniciar el siguiente bloque grande en esa conversación**.

## Cierre obligatorio antes de rotar

Primero cerrar correctamente el checkpoint actual:

1. dejar el código en un estado funcional o claramente identificado como no integrado;
2. ejecutar las verificaciones relevantes;
3. registrar commit, rama y PR activos;
4. actualizar `PROJECT_STATE.md` con `✅` hecho, `⏳` activo y `⬜` pendiente;
5. registrar CI y cualquier fallo conocido;
6. dejar escrito el siguiente paso exacto;
7. distinguir versión estable (`main`) de versión en desarrollo;
8. no depender de memoria o del chat anterior para continuar.

Solo después se debe abrir un chat nuevo.

## Si aparecen señales de saturación

Si una respuesta tarda anormalmente, queda en “pensando” sin progreso verificable o el chat empieza a comportarse de forma inestable:

- no iniciar trabajo nuevo;
- comprobar el estado real en GitHub;
- cerrar/documentar el checkpoint si todavía es posible;
- rotar de chat cuanto antes.

El indicador válido de progreso no es que la interfaz diga “trabajando”, sino que exista evidencia verificable: cambios, commits, PR, CI o estado documentado.

## Regla de continuidad

**Un chat puede terminar; el proyecto no puede depender de él.**

El repositorio debe permitir que el siguiente chat continúe sin reconstruir contexto desde conversaciones anteriores ni adivinar qué quedó pendiente.
