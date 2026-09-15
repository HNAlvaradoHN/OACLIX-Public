# Gate de integración Android + PWA

Este bloque no se considera listo hasta cumplir, en conjunto:

- build web normal verde;
- build web Android (`dist-android`) verde;
- tests y lint verdes;
- build Android verde con el bundle web incluido;
- la UI principal proviene de React/PWA, no de un layout Android duplicado;
- identidad y firma en Android pasan por Keystore mediante el bridge;
- `/api/*` y WebSocket conservan el mismo origen HTTPS del backend configurado;
- sharesheet y capacidades nativas existentes siguen presentes;
- APK físico con backend real verificado antes de pedir prueba al usuario.

El crash observado en tablet se valida dentro de esta arquitectura; no bloquea la construcción del shell ni justifica volver a duplicar UI nativa.
