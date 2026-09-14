# OACLIX — Clipboard Remote

Aplicación de portapapeles remoto con PWA, Android nativo y backend Cloudflare.

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
