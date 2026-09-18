import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const androidRoot = new URL('../android/', import.meta.url)

async function readAndroid(path: string) {
  return readFile(new URL(path, androidRoot), 'utf8')
}

test('la base Android usa un SDK estable actual y limita red al bloque de identidad', async () => {
  const [rootBuild, appBuild, manifest, identityApi, localActivity, shareReceiver] = await Promise.all([
    readAndroid('build.gradle.kts'),
    readAndroid('app/build.gradle.kts'),
    readAndroid('app/src/main/AndroidManifest.xml'),
    readAndroid('app/src/main/java/app/oaclix/android/identity/NativeIdentityApi.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/MainActivity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
  ])
  assert.match(rootBuild, /com\.android\.application"\) version "9\.1\.1"/)
  assert.match(appBuild, /compileSdk = 36/)
  assert.match(appBuild, /targetSdk = 36/)
  assert.match(appBuild, /minSdk = 26/)
  assert.match(appBuild, /applicationId = "app\.oaclix\.android"/)
  assert.match(appBuild, /applicationIdSuffix = "\.dev"/)
  assert.match(appBuild, /versionNameSuffix = "-dev"/)
  assert.match(appBuild, /gradleProperty\("OACLIX_API_BASE_URL"\)/)
  assert.match(appBuild, /orElse\(""\)/)
  assert.doesNotMatch(appBuild, /oaclix\.invalid/)
  assert.match(manifest, /android:allowBackup="false"/)
  assert.match(manifest, /android\.permission\.INTERNET/)
  assert.match(manifest, /android:usesCleartextTraffic="false"/)
  assert.match(identityApi, /\/api\/identity\/bootstrap/)
  assert.match(identityApi, /startsWith\("https:\/\/"\)/)
  assert.doesNotMatch(localActivity, /NativeIdentityApi|HttpURLConnection|java\.net\./)
  assert.doesNotMatch(shareReceiver, /NativeIdentityApi|HttpURLConnection|java\.net\./)
})

test('Vinculados permite configurar backend sin usar un host inválido', async () => {
  const [config, activity, layout, strings] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/connection/NativeBackendConfig.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/LinkDeviceActivity.kt'),
    readAndroid('app/src/main/res/layout/activity_link_device.xml'),
    readAndroid('app/src/main/res/values/strings.xml'),
  ])
  assert.match(config, /host\.endsWith\("\.invalid", ignoreCase = true\)/)
  assert.match(activity, /configureConnectionButton = findViewById\(R\.id\.configure_connection_button\)/)
  assert.match(activity, /NativeBackendConfig\.save\(this, input\.text\.toString\(\)\)/)
  assert.match(activity, /configureFlow\(loadRoster = true\)/)
  assert.match(layout, /@\+id\/configure_connection_button/)
  assert.match(strings, /name="link_connection_required">Configura la conexión de OACLIX para vincular dispositivos\./)
})

test('WebRTC directo no negocia SDP con constraints nulos', async () => {
  const peer = await readAndroid('app/src/main/java/app/oaclix/android/share/NativeDirectTextPeerManager.kt')
  assert.match(peer, /import livekit\.org\.webrtc\.MediaConstraints/)
  assert.match(peer, /createOffer\([\s\S]*?MediaConstraints\(\)\)/)
  assert.match(peer, /createAnswer\([\s\S]*?MediaConstraints\(\)\)/)
  assert.doesNotMatch(peer, /createOffer\([\s\S]{0,1200}?, null\)/)
  assert.doesNotMatch(peer, /createAnswer\([\s\S]{0,1200}?, null\)/)
  assert.match(peer, /runCatching \{[\s\S]*?createOffer/)
  assert.match(peer, /runCatching \{[\s\S]*?createAnswer/)
})

test('el Gradle Wrapper Android queda fijado y verificable', async () => {
  const [properties, wrapperJar, gradlew] = await Promise.all([
    readAndroid('gradle/wrapper/gradle-wrapper.properties'),
    stat(new URL('gradle/wrapper/gradle-wrapper.jar', androidRoot)),
    stat(new URL('gradlew', androidRoot)),
  ])
  assert.match(properties, /gradle-9\.3\.1-bin\.zip/)
  assert.match(properties, /distributionSha256Sum=b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06/)
  assert.ok(wrapperJar.size > 30_000)
  assert.notEqual(gradlew.mode & 0o111, 0)
})

test('Mi portapapeles conserva 8.000 inline y usa .txt privado para texto largo', async () => {
  const [policy, repository, provider, history, fileStore] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/localclipboard/LocalClipboardPolicy.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/localclipboard/SqliteLocalClipboardRepository.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/localclipboard/LocalClipboardRepositoryProvider.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/localclipboard/LocalClipboardHistory.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/localclipboard/LargeTextFileStore.kt'),
  ])
  assert.match(policy, /TEXT_RETENTION_MS = 21_600_000L/)
  assert.match(policy, /MAX_TEXT_LENGTH = 8_000/)
  assert.match(policy, /\^itm_\[a-f0-9\]\{32\}\$/)
  assert.match(policy, /require\(text\.isNotBlank\(\)\)/)
  assert.match(repository, /SQLiteOpenHelper/)
  assert.match(repository, /text_content TEXT NOT NULL/)
  assert.match(repository, /expires_at INTEGER NOT NULL/)
  assert.match(repository, /LocalClipboardPolicy\.normalize\(rawItems, now\)/)
  assert.match(provider, /context\.applicationContext/)
  assert.match(history, /LocalClipboardEntry\.Inline\(repository\.create/)
  assert.match(history, /LocalClipboardEntry\.TextFile\(fileStore\.create/)
  assert.match(fileStore, /DIRECTORY_NAME = "oaclix-large-text"/)
  assert.match(fileStore, /MAX_FILE_BYTES = 384 \* 1024/)
  assert.match(fileStore, /CodingErrorAction\.REPORT/)
})

test('copiar y guardar desde portapapeles siguen visibles sin recortar texto largo', async () => {
  const [activity, bridge, layout, strings] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/MainActivity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/OaclixClipboardBridge.kt'),
    readAndroid('app/src/main/res/layout/activity_main.xml'),
    readAndroid('app/src/main/res/values/strings.xml'),
  ])
  assert.match(activity, /ClipboardManager/)
  assert.match(activity, /private fun saveFromSystemClipboard\(\)/)
  assert.match(activity, /getString\(R\.string\.home_add_clipboard\)/)
  assert.match(activity, /item\.coerceToText\(this\)/)
  assert.match(activity, /history\.save\(text\)/)
  assert.match(activity, /copy\.setOnClickListener/)
  assert.match(activity, /history\.read\(item\)/)
  assert.match(activity, /OaclixClipboardBridge\.copy\(this, text\)/)
  assert.match(bridge, /ClipData\.newPlainText\(context\.getString\(R\.string\.clip_label\), text\)/)
  assert.match(bridge, /clipboard\.setPrimaryClip\(clip\)/)
  assert.match(layout, /@\+id\/send_something_button/)
  assert.match(strings, /name="home_add_clipboard">Guardar desde portapapeles</)
  assert.doesNotMatch(activity, /take\(8_000\)/)
  assert.doesNotMatch(bridge, /take\(|substring\(|ClipData\.newUri|writeText\(/)
  assert.doesNotMatch(layout, /android:maxLength="8000"/)
})

test('copiar protege la vista previa del sistema y evita confirmaciones duplicadas modernas', async () => {
  const [activity, bridge] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/MainActivity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/OaclixClipboardBridge.kt'),
  ])
  assert.match(bridge, /ClipDescription\.EXTRA_IS_SENSITIVE/)
  assert.match(bridge, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.TIRAMISU/)
  assert.match(activity, /Build\.VERSION\.SDK_INT <= Build\.VERSION_CODES\.S_V2/)
})

test('Android excluye datos privados completos de backup y transferencia', async () => {
  const [manifest, extractionRules, backupRules] = await Promise.all([
    readAndroid('app/src/main/AndroidManifest.xml'),
    readAndroid('app/src/main/res/xml/data_extraction_rules.xml'),
    readAndroid('app/src/main/res/xml/backup_rules.xml'),
  ])
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/)
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/)

  for (const domain of ['database', 'file', 'sharedpref']) {
    assert.match(extractionRules, new RegExp(`<cloud-backup>[\\s\\S]*?<exclude domain="${domain}" path="\\."`))
    assert.match(extractionRules, new RegExp(`<device-transfer>[\\s\\S]*?<exclude domain="${domain}" path="\\."`))
    assert.match(backupRules, new RegExp(`<exclude domain="${domain}" path="\\."`))
  }
})

test('Sharesheet recibe texto, .txt o imagen; texto conserva prioridad de archivo y envío directo', async () => {
  const [manifest, receiver, layout, strings] = await Promise.all([
    readAndroid('app/src/main/AndroidManifest.xml'),
    readAndroid('app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    readAndroid('app/src/main/res/layout/activity_share_receiver.xml'),
    readAndroid('app/src/main/res/values/strings.xml'),
  ])
  assert.match(manifest, /\.ShareReceiverActivity[\s\S]*?android:exported="true"[\s\S]*?android\.intent\.action\.SEND[\s\S]*?android\.intent\.category\.DEFAULT[\s\S]*?android:mimeType="text\/plain"/)
  assert.match(manifest, /android:mimeType="image\/\*"/)
  assert.doesNotMatch(manifest, /android\.intent\.action\.SEND_MULTIPLE/)
  assert.match(receiver, /if \(source\.action != Intent\.ACTION_SEND\) return null/)
  assert.match(receiver, /type == "text\/plain" -> SharedContentMode\.Text/)
  assert.match(receiver, /type\.startsWith\("image\/"\) -> SharedContentMode\.Image/)
  assert.match(receiver, /Intent\.EXTRA_STREAM/)
  assert.match(receiver, /source\.clipData/)
  assert.match(receiver, /val streamUri = sharedStreamUri\(source\)[\s\S]*?showBusyState\(R\.string\.share_loading_file\)[\s\S]*?ioExecutor\.execute[\s\S]*?history\.readSharedText\(streamUri\)/)
  assert.match(receiver, /getCharSequenceExtra\(Intent\.EXTRA_TEXT\)/)
  assert.match(receiver, /largeSharedText = text\.takeIf \{ it\.length > LocalClipboardPolicy\.MAX_TEXT_LENGTH \}/)
  assert.match(receiver, /largePreview\(text\)/)
  assert.match(receiver, /private fun currentText\(\): String = largeSharedText \?: input\.text/)
  assert.match(receiver, /busyLabel = R\.string\.share_saving/)
  assert.match(receiver, /confirmButton = findViewById\(R\.id\.share_save_button\)/)
  assert.match(receiver, /confirmButton\.setOnClickListener \{ confirmSharedContent\(\) \}/)
  assert.match(receiver, /history\.save\(text\)/)
  assert.match(receiver, /app\.sendDirectText\(destination\.deviceId, text\)/)
  assert.doesNotMatch(receiver, /NativeGeneralShareTransport|NativeDeviceShareTransport|device-transfer/)
  assert.match(strings, /name="share_loading_file">Leyendo archivo…/)
  assert.match(strings, /name="share_saving">Guardando…/)
  assert.match(strings, /name="share_sending">Enviando directamente…/)
  assert.doesNotMatch(receiver, /startActivity\(/)
  assert.doesNotMatch(layout, /android:maxLength=/)
})
