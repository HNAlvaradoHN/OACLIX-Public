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

test('Vinculados vive en la PWA mientras Sharesheet conserva solo el roster nativo necesario', async () => {
  const [mainActivity, linkedPanel, linkingFlow, shareReceiver, destinationSource, linkingApi, manifest] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/MainActivity.kt'),
    read('src/components/LinkedPanel.tsx'),
    read('android/app/src/main/java/app/oaclix/android/identity/NativeLinkingFlow.kt'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('android/app/src/main/java/app/oaclix/android/share/NativeShareDestinationSource.kt'),
    read('android/app/src/main/java/app/oaclix/android/identity/NativeIdentityLinkingApi.kt'),
    read('android/app/src/main/AndroidManifest.xml'),
  ])

  assert.match(mainActivity, /WebView\(this\)/)
  assert.doesNotMatch(mainActivity, /NativeIdentityLinkingApi|identity\.link\.|devices\/list|LinkDeviceActivity/)
  assert.match(linkedPanel, /createDeviceLinkCode/)
  assert.match(linkedPanel, /consumeDeviceLinkCode/)
  assert.match(linkedPanel, /listLinkedDevices/)
  assert.match(linkedPanel, /renameLinkedDevice/)
  assert.match(linkedPanel, /unlinkLinkedDevice/)
  assert.match(linkedPanel, /subscribeDirectLanStatus/)

  assert.match(linkingFlow, /NativeIdentityApi/)
  assert.match(linkingFlow, /consumeLinkCode/)
  assert.match(linkingFlow, /listLinkedDevices/)
  assert.match(linkingFlow, /createLinkCode/)
  assert.match(linkingFlow, /renameLinkedDevice/)
  assert.match(linkingFlow, /unlinkLinkedDevice/)
  assert.doesNotMatch(linkingFlow, /rotateRevoked|revokeLinkedDevice|revokeAndLoad/)

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
