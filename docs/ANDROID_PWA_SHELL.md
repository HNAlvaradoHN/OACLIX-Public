# Android PWA shell

OACLIX Android usa la PWA como superficie principal y reserva Kotlin para capacidades nativas.

## Diseño

- La UI React se compila con `npm run build:android-web` usando base `/app/`.
- Gradle empaqueta `dist-android` como assets del APK.
- `MainActivity` sirve `/app/*` desde assets dentro de un `WebView` HTTPS cuyo host coincide con el backend configurado.
- Las rutas `/api/*` y WebSocket quedan fuera de `/app/`, por lo que usan el backend real del mismo origen sin CORS adicional.
- El `WebView` no permite acceso a archivos/contenido local ni contenido mixto.
- El Service Worker de navegador no toma control dentro del shell Android.
- `OaclixWebBridge` expone únicamente identidad/firmas respaldadas por Android Keystore. La PWA conserva su implementación IndexedDB en navegador normal.

## Responsabilidad nativa

Android sigue siendo responsable de sharesheet, portapapeles del sistema, almacenamiento privado, recepción en segundo plano/foreground y transportes nativos futuros. La interfaz y la lógica de producto común no deben duplicarse en layouts Kotlin/XML.

## Build físico

El repositorio público conserva `https://oaclix.invalid` como backend por defecto. Una APK física debe inyectar `OACLIX_API_BASE_URL` durante el build; el endpoint real no debe quedar escrito en el snapshot público.
