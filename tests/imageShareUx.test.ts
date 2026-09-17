import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('visible PWA keeps linked-image reception alive without turning local-only startup into a requirement', async () => {
  const [receiver, clipboardApi, main] = await Promise.all([
    read('src/components/ForegroundLinkedImageReceiver.tsx'),
    read('src/data/clipboardApi.ts'),
    read('src/main.tsx'),
  ])

  assert.match(receiver, /await getLocalDeviceId\(\)/)
  assert.match(receiver, /await bootstrapDeviceIdentity\(\)/)
  assert.match(receiver, /document\.visibilityState !== 'visible'/)
  assert.match(receiver, /ensureClipboardRoomForegroundReception/)
  assert.match(receiver, /suspendClipboardRoomForegroundReception/)
  assert.match(receiver, /document\.addEventListener\('visibilitychange'/)

  assert.match(clipboardApi, /const foregroundReceiverRooms = new Set<string>\(\)/)
  assert.match(clipboardApi, /if \(contentConnectivityRooms\.has\(roomId\)\)/)
  assert.match(clipboardApi, /controlConnectivityRooms\.has\(roomId\) \|\| foregroundReceiverRooms\.has\(roomId\)/)
  assert.match(main, /<ForegroundLinkedImageReceiver \/>/)
})

test('Android share selector is compact, previews the incoming URI and keeps images local-only', async () => {
  const [layout, preview, presentation, strings, receiver] = await Promise.all([
    read('android/app/src/main/res/layout/activity_share_receiver.xml'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/SharedImagePreviewView.kt'),
    read('android/app/src/main/java/app/oaclix/android/share/NativeShareDestinationPresentation.kt'),
    read('android/app/src/main/res/values/strings.xml'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
  ])

  assert.match(layout, /SharedImagePreviewView/)
  assert.match(layout, /android:layout_width="86dp"/)
  assert.match(layout, /android:layout_height="86dp"/)
  assert.doesNotMatch(layout, /@android:drawable\/ic_menu_gallery/)

  assert.match(preview, /ImageDecoder\.createSource\(activity\.contentResolver, uri\)/)
  assert.match(preview, /Intent\.EXTRA_STREAM/)
  assert.match(preview, /intent\.clipData/)
  assert.match(preview, /document|Thread/)

  assert.match(presentation, /repeatedLinkedLabels/)
  assert.match(presentation, /shortDeviceTag/)
  assert.match(strings, /share_destination_image_local_only">Las imágenes se guardan localmente por ahora\./)
  assert.match(strings, /share_image_meta">Se guardará solo en este dispositivo</)
  assert.doesNotMatch(strings, /share_destination_image_devices_ready|imágenes por Nube/)
  assert.doesNotMatch(receiver, /· Nube|sendImageDevice|NativeImageDeviceShareTransport/)
})
