import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('Android vinculación usa exactamente los endpoints y acciones firmadas del Worker', async () => {
  const [api, worker] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/identity/NativeIdentityLinkingApi.kt'),
    read('worker/index.ts'),
  ])

  for (const value of [
    '/api/identity/link/create',
    '/api/identity/link/consume',
    '/api/identity/devices/list',
    '/api/identity/devices/rename',
    '/api/identity/devices/unlink',
    'identity.link.create',
    'identity.link.consume',
    'identity.devices.list',
    'identity.devices.rename',
    'identity.devices.unlink',
  ]) {
    assert.match(api, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(worker, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.doesNotMatch(api, /devices\/revoke|identity\.devices\.revoke|revokeLinkedDevice/)
  assert.doesNotMatch(worker, /devices\/revoke|identity\.devices\.revoke|handleRevokeDevice/)
  assert.match(api, /identity\.signAction\(action, payloadJson\)/)
  assert.match(api, /"payload", JSONObject\(proof\.payloadJson\)/)
  assert.match(api, /instanceFollowRedirects = false/)
  assert.match(api, /normalizeDeviceLabel/)
})

test('Android normaliza el código con el mismo alfabeto y longitud que el Worker', async () => {
  const [api, store] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/identity/NativeIdentityLinkingApi.kt'),
    read('worker/data/deviceLinkStore.ts'),
  ])

  assert.match(api, /ABCDEFGHJKLMNPQRSTUVWXYZ23456789/)
  assert.match(api, /\{10\}/)
  assert.match(api, /uppercase\(\)\.replace\(Regex\("\[\\\\s-\]"\), ""\)/)
  assert.match(store, /LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'/)
  assert.match(store, /LINK_CODE_LENGTH = 10/)
})

test('Sharesheet solo consulta roster y Vinculados delega administración en un flujo separado', async () => {
  const [mainActivity, linkActivity, linkingFlow, shareReceiver, destinationSource, linkingApi, manifest, layout] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/MainActivity.kt'),
    read('android/app/src/main/java/app/oaclix/android/LinkDeviceActivity.kt'),
    read('android/app/src/main/java/app/oaclix/android/identity/NativeLinkingFlow.kt'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('android/app/src/main/java/app/oaclix/android/share/NativeShareDestinationSource.kt'),
    read('android/app/src/main/java/app/oaclix/android/identity/NativeIdentityLinkingApi.kt'),
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/res/layout/activity_link_device.xml'),
  ])

  assert.doesNotMatch(mainActivity, /NativeIdentityLinkingApi|identity\.link\.|devices\/list/)
  assert.match(mainActivity, /LinkDeviceActivity/)
  assert.match(linkActivity, /NativeLinkingFlow/)
  assert.doesNotMatch(linkActivity, /NativeIdentityLinkingApi|NativeIdentityApi/)
  assert.match(linkActivity, /generateCode/)
  assert.match(linkActivity, /renameDevice/)
  assert.match(linkActivity, /unlinkDevice/)
  assert.match(linkingFlow, /NativeIdentityApi/)
  assert.match(linkingFlow, /consumeLinkCode/)
  assert.match(linkingFlow, /listLinkedDevices/)
  assert.match(linkingFlow, /createLinkCode/)
  assert.match(linkingFlow, /renameLinkedDevice/)
  assert.match(linkingFlow, /unlinkLinkedDevice/)
  assert.doesNotMatch(linkingFlow, /rotateRevoked|revokeLinkedDevice|revokeAndLoad/)
  assert.match(layout, /generated_link_code/)
  assert.match(layout, /linked_devices_container/)
  assert.match(layout, /refresh_linked_devices_button/)
  assert.match(manifest, /android:name="\.LinkDeviceActivity"/)
  assert.match(manifest, /android:name="\.LinkDeviceActivity"[\s\S]*?android:exported="false"/)

  assert.match(shareReceiver, /NativeShareDestinationSource/)
  assert.doesNotMatch(shareReceiver, /NativeIdentityLinkingApi|createLinkCode|consumeLinkCode|identity\.link\.create|identity\.link\.consume/)
  assert.match(destinationSource, /NativeIdentityApi/)
  assert.match(destinationSource, /bootstrapIdentity/)
  assert.match(destinationSource, /NativeIdentityLinkingApi/)
  assert.doesNotMatch(destinationSource, /createLinkCode|consumeLinkCode|identity\.link\.create|identity\.link\.consume/)
  assert.match(linkingApi, /NativeLinkedDevicesSnapshot/)
})
