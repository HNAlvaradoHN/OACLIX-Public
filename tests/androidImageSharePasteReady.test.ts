import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('shared images are stored locally and immediately published to Android Clipboard', async () => {
  const [receiver, bridge, publisher] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('android/app/src/main/java/app/oaclix/android/OaclixClipboardBridge.kt'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageClipboardPublisher.kt'),
  ])

  assert.match(receiver, /imageStore\.createFromUri\(uri, mimeTypeHint = mimeType\)/)
  assert.match(receiver, /onSuccess = \{ item ->[\s\S]*OaclixClipboardBridge\.copy\(this, imageStore\.contentUri\(item\)\)/)
  assert.match(receiver, /R\.string\.image_copied/)
  assert.match(bridge, /fun copy\(context: Context, uri: Uri\)/)
  assert.match(bridge, /ImageClipboardPublisher\.publish\(context, uri\)/)
  assert.match(publisher, /ClipData\.newUri\(/)
  assert.match(publisher, /clipboard\.setPrimaryClip\(clip\)/)
})
