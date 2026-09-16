import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('desvincular separa la relación sin reemplazar la identidad local', async () => {
  const [panel, identity, worker, core, realtime] = await Promise.all([
    read('src/components/LinkedPanel.tsx'),
    read('src/identity/deviceIdentity.ts'),
    read('worker/index.ts'),
    read('worker/data/coreStore.ts'),
    read('worker/realtime/realtimeHub.ts'),
  ])

  assert.match(panel, /unlinkLinkedDevice\(deviceId\)/)
  assert.match(panel, /Dispositivo desvinculado correctamente/)
  assert.match(panel, /identidad OACLIX y contenido local se conservan/i)
  assert.doesNotMatch(panel, /bootstrapDeviceIdentityForExplicitRelink|revokeLinkedDevice/)

  assert.doesNotMatch(identity, /deleteRevokedCredential|bootstrapDeviceIdentityForExplicitRelink|isRevokedDeviceIdentityError/)
  assert.match(worker, /\/api\/identity\/devices\/unlink/)
  assert.match(worker, /identity\.devices\.unlink/)
  assert.match(core, /moveDeviceToStandaloneGroup/)
  assert.match(core, /SET person_id = \?1, revoked_at = NULL/)
  assert.match(core, /DELETE FROM device_link_codes WHERE source_device_id = \?1/)
  assert.match(realtime, /device-unlink-v1/)
  assert.match(realtime, /Dispositivo desvinculado/)
  assert.match(realtime, /private async unlinkDevice\([\s\S]*removePendingTransferRequestsForDevice\([\s\S]*await this\.writePendingTransferRequests\([\s\S]*this\.broadcastPresence\(\)/)
})

test('la acción normal de dispositivos ya no expone revocación', async () => {
  const [linking, worker, androidApi, androidFlow, keystore] = await Promise.all([
    read('src/identity/deviceLinking.ts'),
    read('worker/index.ts'),
    read('android/app/src/main/java/app/oaclix/android/identity/NativeIdentityLinkingApi.kt'),
    read('android/app/src/main/java/app/oaclix/android/identity/NativeLinkingFlow.kt'),
    read('android/app/src/main/java/app/oaclix/android/identity/AndroidKeystoreDeviceIdentity.kt'),
  ])

  for (const source of [linking, worker, androidApi, androidFlow, keystore]) {
    assert.doesNotMatch(source, /identity\.devices\.revoke|devices\/revoke|rotateRevokedCredential|revokeLinkedDevice|revokeAndLoad/)
  }
})

test('registros antiguos bloqueados se migran a identidad independiente al abrir OACLIX', async () => {
  const core = await read('worker/data/coreStore.ts')
  const worker = await read('worker/index.ts')

  assert.match(core, /existing\?\.revoked_at != null/)
  assert.match(core, /moveDeviceToStandaloneGroup\([\s\S]*existing\.person_id[\s\S]*input\.deviceId/)
  assert.match(core, /requiresStandaloneMigration: row\.revoked_at != null/)
  assert.match(worker, /requiresStandaloneMigration/)
  assert.match(worker, /Reabre OACLIX para actualizar la identidad de este dispositivo/)
})
