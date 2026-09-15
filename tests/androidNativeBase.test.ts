import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const projectRoot = new URL('../', import.meta.url)
const androidRoot = new URL('../android/', import.meta.url)

async function readProject(path: string) {
  return readFile(new URL(path, projectRoot), 'utf8')
}

async function readAndroid(path: string) {
  return readFile(new URL(path, androidRoot), 'utf8')
}

test('la base Android usa un SDK estable actual y mantiene red nativa acotada', async () => {
  const [rootBuild, appBuild, manifest, identityApi, mainActivity, shareReceiver, directReceiver] = await Promise.all([
    readAndroid('build.gradle.kts'),
    readAndroid('app/build.gradle.kts'),
    readAndroid('app/src/main/AndroidManifest.xml'),
    readAndroid('app/src/main/java/app/oaclix/android/identity/NativeIdentityApi.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/MainActivity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/share/NativeImageDeviceRelayReceiver.kt'),
  ])
  assert.match(rootBuild, /com\.android\.application"\) version "9\.1\.1"/)
  assert.match(appBuild, /compileSdk = 36/)
  assert.match(appBuild, /targetSdk = 36/)
  assert.match(appBuild, /minSdk = 26/)
  assert.match(appBuild, /applicationId = "app\.oaclix\.android"/)
  assert.match(appBuild, /applicationIdSuffix = "\.dev"/)
  assert.match(appBuild, /versionNameSuffix = "-dev"/)
  assert.match(appBuild, /gradleProperty\("OACLIX_API_BASE_URL"\)/)
  assert.match(appBuild, /orElse\("https:\/\/oaclix\.invalid"\)/)
  assert.match(manifest, /android:allowBackup="false"/)
  assert.match(manifest, /android\.permission\.INTERNET/)
  assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/)
  assert.match(manifest, /android\.permission\.CHANGE_NETWORK_STATE/)
  assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/)
  assert.match(manifest, /android:usesCleartextTraffic="false"/)
  assert.match(identityApi, /\/api\/identity\/bootstrap/)
  assert.match(identityApi, /startsWith\("https:\/\/"\)/)
  assert.doesNotMatch(mainActivity, /HttpURLConnection|java\.net\./)
  assert.doesNotMatch(shareReceiver, /NativeIdentityApi|HttpURLConnection|java\.net\./)
  assert.match(directReceiver, /Looper\.getMainLooper\(\)/)
  assert.match(directReceiver, /Handler\(Looper\.getMainLooper\(\)\)\.post/)
})

test('Android usa la PWA empaquetada como superficie principal y no duplica su interfaz', async () => {
  const [activity, bridge, appBuild, packageJson, viteConfig, workflow, identity, imageStore] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/MainActivity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/OaclixWebBridge.kt'),
    readAndroid('app/build.gradle.kts'),
    readProject('package.json'),
    readProject('vite.config.ts'),
    readProject('.github/workflows/verify.yml'),
    readProject('src/identity/deviceIdentity.ts'),
    readProject('src/data/localImageClipboard.ts'),
  ])

  assert.match(activity, /WebView\(this\)/)
  assert.match(activity, /addJavascriptInterface\(OaclixWebBridge\(applicationContext\), NATIVE_BRIDGE_NAME\)/)
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/)
  assert.match(activity, /allowFileAccess = false/)
  assert.match(activity, /allowContentAccess = false/)
  assert.match(activity, /blockNetworkLoads = true/)
  assert.match(activity, /SHELL_PREFIX = "\/app\/"/)
  assert.match(activity, /assets\.open\(relativePath\)/)
  assert.match(activity, /url\.host != backendHost/)
  assert.match(activity, /NATIVE_IMAGE_PREFIX = "\/app-native\/image\/"/)
  assert.match(activity, /imageStore\.openInputStream\(item\)/)
  assert.match(activity, /"Cache-Control" to "no-store"/)
  assert.match(bridge, /AndroidKeystoreDeviceIdentity/)
  assert.match(bridge, /ImageClipboardStore/)
  assert.match(bridge, /@JavascriptInterface[\s\S]*?getDeviceId/)
  assert.match(bridge, /@JavascriptInterface[\s\S]*?createBootstrapProof/)
  assert.match(bridge, /@JavascriptInterface[\s\S]*?signAction/)
  assert.match(bridge, /@JavascriptInterface[\s\S]*?listLocalImages/)
  assert.match(bridge, /@JavascriptInterface[\s\S]*?deleteLocalImage/)
  assert.match(appBuild, /assets\.srcDir\(webBundleDir\)/)
  assert.match(appBuild, /verifyWebBundle/)
  assert.match(packageJson, /"build:android-web": "tsc -b && vite build --mode android"/)
  assert.match(viteConfig, /mode === 'android'/)
  assert.match(viteConfig, /base: androidShell \? '\/app\/' : '\/'/)
  assert.match(viteConfig, /outDir: 'dist-android'/)
  assert.match(workflow, /npm run build:android-web/)
  assert.match(identity, /window\.OaclixNative/)
  assert.match(identity, /bridge\.signAction\(action, JSON\.stringify\(payload\)\)/)
  assert.match(identity, /bridge\.createBootstrapProof\(\)/)
  assert.match(imageStore, /bridge\.listLocalImages\(\)/)
  assert.match(imageStore, /fetch\(`\/app-native\/image\/\$\{encodeURIComponent\(item\.id\)\}`/)
  assert.match(imageStore, /bridge\.deleteLocalImage\(item\.id\)/)
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

test('el puente de portapapeles nativo conserva privacidad y no recorta texto', async () => {
  const bridge = await readAndroid('app/src/main/java/app/oaclix/android/OaclixClipboardBridge.kt')
  assert.match(bridge, /ClipData\.newPlainText\(context\.getString\(R\.string\.clip_label\), text\)/)
  assert.match(bridge, /clipboard\.setPrimaryClip\(clip\)/)
  assert.match(bridge, /ClipDescription\.EXTRA_IS_SENSITIVE/)
  assert.match(bridge, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.TIRAMISU/)
  assert.doesNotMatch(bridge, /take\(|substring\(|ClipData\.newUri|writeText\(/)
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

test('Sharesheet recibe texto, .txt o imagen; texto conserva prioridad de archivo y progreso', async () => {
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
  assert.match(receiver, /NativeGeneralShareTransport\(baseUrl\)\.send\(text\)/)
  assert.match(strings, /name="share_loading_file">Leyendo archivo…/)
  assert.match(strings, /name="share_saving">Guardando…/)
  assert.doesNotMatch(receiver, /startActivity\(/)
  assert.doesNotMatch(layout, /android:maxLength=/)
})
