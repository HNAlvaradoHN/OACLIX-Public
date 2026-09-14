import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('Android no exporta el proveedor privado de imágenes y permite grants puntuales', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml')
  const provider = manifest.match(/<provider[\s\S]*?\/>/)?.[0] ?? ''

  assert.match(provider, /android:name="\.imageclipboard\.OaclixImageProvider"/)
  assert.match(provider, /android:exported="false"/)
  assert.match(provider, /android:grantUriPermissions="true"/)
  assert.doesNotMatch(provider, /android:exported="true"/)
})

test('Android excluye datos privados de backup y migración dispositivo a dispositivo', async () => {
  const [legacy, extraction] = await Promise.all([
    read('android/app/src/main/res/xml/backup_rules.xml'),
    read('android/app/src/main/res/xml/data_extraction_rules.xml'),
  ])

  for (const domain of ['database', 'file', 'sharedpref']) {
    assert.match(legacy, new RegExp(`<exclude domain="${domain}" path="\\." \\/>`))
    const matches = extraction.match(new RegExp(`<exclude domain="${domain}" path="\\." \\/>`, 'g')) ?? []
    assert.equal(matches.length, 2, `${domain} debe excluirse tanto de cloud-backup como de device-transfer`)
  }
})

test('Service Worker nunca cachea ni da fallback HTML a /api/', async () => {
  const worker = await read('public/sw.js')
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/)
  assert.match(worker, /fetch\(event\.request, \{ cache: 'no-store' \}\)/)
})

test('la caché de General depura físicamente elementos vencidos o inválidos', async () => {
  const cache = await read('src/data/clipboardCache.ts')
  assert.match(cache, /const items = normalizeItems\(stored\.items\)/)
  assert.match(cache, /if \(items\.length !== stored\.items\.length\)/)
  assert.match(cache, /await replaceStoredCache\(database, \{/)
  assert.match(cache, /items,/)
})

test('Direct-first depura texto vencido en IndexedDB sin perder marcadores de secuencia', async () => {
  const [stateStore, persistentState, outbound, inbound] = await Promise.all([
    read('src/data/directFirstStateStore.ts'),
    read('src/transport/directFirstPersistentState.ts'),
    read('src/transport/directFirstShadowOutbound.ts'),
    read('src/transport/directFirstShadowInbound.ts'),
  ])
  assert.match(stateStore, /redactExpiredDirectFirstContent/)
  assert.match(stateStore, /if \(redacted\.changed\) await putStoredState/)
  assert.match(persistentState, /text: ''/)
  assert.match(persistentState, /DIRECT_TEXT_RETENTION_MS/)
  assert.match(outbound, /redactExpiredDirectFirstChange/)
  assert.match(outbound, /directFirstContentExpiresAt/)
  assert.match(inbound, /productCommitted = result\.productCommitted\.filter/)
})

test('CI público verifica el wrapper Gradle sin ejecutar una Action Gradle adicional', async () => {
  const workflow = await read('.github/workflows/verify.yml')
  assert.doesNotMatch(workflow, /gradle\/actions\//)
  assert.match(workflow, /b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13/)
  assert.match(workflow, /sha256sum -c -/)
  assert.match(workflow, /test -f gradle\/verification-metadata\.xml/)
})

test('auditor público exige lockfile con integridad y metadata de Gradle', async () => {
  const auditor = await read('scripts/audit-public-snapshot.mjs')
  assert.match(auditor, /dependency missing sha512 integrity/)
  assert.match(auditor, /dependency is not pinned to the npm registry tarball/)
  assert.match(auditor, /missing dependency verification metadata/)
  assert.match(auditor, /no SHA-256 dependency checksums found/)
})

test('auditor trata ProGuard y Web App Manifest como texto inspeccionable', async () => {
  const auditor = await read('scripts/audit-public-snapshot.mjs')
  assert.match(auditor, /'\.pro'/)
  assert.match(auditor, /'\.webmanifest'/)
})
