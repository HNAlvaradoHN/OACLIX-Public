# Seguridad y privacidad del repositorio público

Esta regla es prioritaria para todo OACLIX.

## Principio obligatorio

El repositorio `OACLIX-Public` es público. Nunca se debe publicar información privada, sensible u operativa real.

Queda prohibido incluir en código, documentación, commits, PR, issues, logs de ejemplo, capturas o archivos públicos:

- contraseñas, tokens, API keys, claves privadas o secretos;
- URLs internas, hostnames operativos privados, endpoints no públicos o credenciales de servicios;
- datos personales, correos privados, identificadores sensibles o información de cuentas;
- contenido real del portapapeles, imágenes privadas, archivos de usuarios o datos de prueba tomados de usuarios;
- keystores, certificados privados, archivos de firma o material criptográfico secreto;
- valores reales de GitHub Actions Secrets, variables privadas de Cloudflare o configuración reservada de producción.

## Regla de implementación

- Todo secreto debe vivir únicamente en almacenamiento privado apropiado, por ejemplo GitHub Actions Secrets, secretos de Cloudflare, Keystore u otra configuración privada aprobada.
- El repositorio público solo puede contener nombres de variables y placeholders seguros, por ejemplo `https://example.invalid`, `YOUR_API_URL` o valores ficticios inequívocos.
- Antes de cada commit o PR se debe revisar que el diff no exponga información sensible.
- Si una prueba necesita credenciales, endpoints o datos operativos, debe inyectarlos en tiempo de ejecución y nunca escribirlos en el repositorio.
- Los logs y mensajes de error no deben revelar secretos ni contenido privado del usuario.
- El contenido del portapapeles se considera privado por defecto.

## Si ocurre una exposición

No basta con borrar el valor del archivo. Se debe tratar como comprometido: revocar o rotar el secreto, revisar historial/artefactos/logs y limpiar cualquier otra copia pública antes de continuar.

Esta política tiene prioridad sobre conveniencia de desarrollo, depuración o documentación.
