#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="security/public-snapshot-candidate"
ANDROID_TOOLS_ZIP="commandlinetools-linux-15859902_latest.zip"
ANDROID_TOOLS_SHA256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"
ANDROID_TOOLS_URL="https://dl.google.com/android/repository/${ANDROID_TOOLS_ZIP}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/.android-sdk-oaclix}"
PUSH_ASSETS=false

if [[ "${1:-}" == "--push-assets" ]]; then
  PUSH_ASSETS=true
elif [[ $# -gt 0 ]]; then
  echo "Uso: bash scripts/verify-prepublic-codespace.sh [--push-assets]" >&2
  exit 2
fi

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] \
  || fail "Ejecuta este script en $EXPECTED_BRANCH."
[[ -z "$(git status --porcelain)" ]] || fail "El árbol debe estar limpio antes de verificar."

ensure_node_22() {
  if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(`.`)[0]')" == "22" ]]; then
    return
  fi
  if [[ -n "${NVM_DIR:-}" && -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm install 22
    nvm use 22
  else
    fail "Node 22 no está disponible y no se encontró nvm."
  fi
  [[ "$(node -p 'process.versions.node.split(`.`)[0]')" == "22" ]] || fail "No se pudo activar Node 22."
}

activate_java_17() {
  local java17_home
  java17_home="$(find /usr/lib/jvm -maxdepth 1 -type d -name 'java-17-openjdk-*' -print -quit 2>/dev/null || true)"
  [[ -n "$java17_home" && -x "$java17_home/bin/java" ]] || return 1
  export JAVA_HOME="$java17_home"
  export PATH="$JAVA_HOME/bin:$PATH"
  java -version 2>&1 | head -n 1 | grep -Eq '"17([.]|\")'
}

ensure_java_17() {
  if command -v java >/dev/null 2>&1 && java -version 2>&1 | head -n 1 | grep -Eq '"17([.]|\")'; then
    return
  fi
  if activate_java_17; then return; fi
  command -v sudo >/dev/null 2>&1 || fail "Java 17 no está disponible y no existe sudo."
  sudo apt-get update
  sudo apt-get install -y openjdk-17-jdk
  activate_java_17 || fail "Java 17 se instaló pero no se pudo activar."
}

ensure_android_sdk() {
  export ANDROID_SDK_ROOT
  export ANDROID_HOME="$ANDROID_SDK_ROOT"
  export PATH="$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$ANDROID_SDK_ROOT/platform-tools:$PATH"

  if [[ ! -x "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" ]]; then
    command -v curl >/dev/null 2>&1 || fail "Falta curl."
    command -v unzip >/dev/null 2>&1 || {
      command -v sudo >/dev/null 2>&1 || fail "Falta unzip y no existe sudo."
      sudo apt-get update
      sudo apt-get install -y unzip
    }

    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir"' EXIT
    curl --fail --location --retry 3 --output "$tmp_dir/$ANDROID_TOOLS_ZIP" "$ANDROID_TOOLS_URL"
    echo "$ANDROID_TOOLS_SHA256  $tmp_dir/$ANDROID_TOOLS_ZIP" | sha256sum -c -
    unzip -q "$tmp_dir/$ANDROID_TOOLS_ZIP" -d "$tmp_dir/extracted"
    mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools/latest"
    cp -a "$tmp_dir/extracted/cmdline-tools/." "$ANDROID_SDK_ROOT/cmdline-tools/latest/"
  fi

  yes | sdkmanager --licenses >/dev/null || true
  sdkmanager "platforms;android-36" "build-tools;36.0.0"
}

ensure_node_22
echo "==> Node $(node --version), npm $(npm --version)"

echo "==> Regenerando package-lock.json desde el registry oficial"
rm -rf node_modules
rm -f package-lock.json
npm install --package-lock-only --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org/
[[ -s package-lock.json ]] || fail "npm no generó package-lock.json."
git diff --exit-code -- package.json || fail "package.json cambió durante la generación del lockfile."

ensure_java_17
echo "==> Java activo: $(java -version 2>&1 | head -n 1)"
ensure_android_sdk

echo "==> Generando metadata SHA-256 de dependencias Gradle"
rm -f android/gradle/verification-metadata.xml
(
  cd android
  OACLIX_ANDROID_VERSION_CODE=1 ./gradlew \
    --write-verification-metadata sha256 \
    testDebugUnitTest assembleDebug --no-daemon
)
[[ -s android/gradle/verification-metadata.xml ]] \
  || fail "Gradle no generó verification-metadata.xml."

echo "==> Auditando snapshot saneado"
node scripts/audit-public-snapshot.mjs .

echo "==> Instalación npm limpia desde lockfile"
npm ci --no-audit --no-fund

echo "==> Test / Lint / Build web + Worker"
npm test
npm run lint
npm run build

echo "==> Verificando Android otra vez con metadata ya activa"
(
  cd android
  OACLIX_ANDROID_VERSION_CODE=1 ./gradlew testDebugUnitTest assembleDebug --no-daemon
)

echo "==> Comprobaciones finales del diff"
git diff --check
unexpected="$(git status --porcelain --untracked-files=all \
  | grep -vE '^ M package-lock\.json$|^\?\? android/gradle/verification-metadata\.xml$' || true)"
[[ -z "$unexpected" ]] || {
  echo "$unexpected" >&2
  fail "La verificación modificó archivos distintos de los dos assets reproducibles esperados."
}

node - <<'NODE'
const lock = require('./package-lock.json')
let checked = 0
for (const [path, descriptor] of Object.entries(lock.packages ?? {})) {
  if (!path || !descriptor || typeof descriptor !== 'object' || descriptor.link === true) continue
  if (typeof descriptor.version !== 'string') continue
  if (!/^sha512-[A-Za-z0-9+/=]+$/.test(descriptor.integrity ?? '')) {
    throw new Error(`${path}: falta integrity sha512`)
  }
  if (!(descriptor.resolved ?? '').startsWith('https://registry.npmjs.org/')) {
    throw new Error(`${path}: resolved no apunta al registry oficial`)
  }
  checked += 1
}
if (checked === 0) throw new Error('No se validó ninguna dependencia npm')
console.log(`npm lock: ${checked} dependencias con resolved + integrity`)
NODE

grep -q '<verify-metadata>true</verify-metadata>' android/gradle/verification-metadata.xml \
  || fail "Gradle metadata no habilitó verify-metadata."
grep -Eq '<sha256 value="[0-9a-f]{64}"' android/gradle/verification-metadata.xml \
  || fail "Gradle metadata no contiene SHA-256."

echo
echo "VERIFICACION PREPUBLICA FINAL: OK"
echo "No se publicó ningún repositorio ni se desplegó producción."

if [[ "$PUSH_ASSETS" == true ]]; then
  git add package-lock.json android/gradle/verification-metadata.xml
  staged="$(git diff --cached --name-only | sort)"
  expected=$'android/gradle/verification-metadata.xml\npackage-lock.json'
  [[ "$staged" == "$expected" ]] || fail "Solo lockfile npm y metadata Gradle pueden quedar preparados."
  git commit -m "Lock public dependency supply chain"
  git push origin HEAD
  echo "Los dos assets reproducibles quedaron registrados en la rama privada candidata."
else
  echo "Siguiente paso: registrar únicamente package-lock.json y android/gradle/verification-metadata.xml."
fi
