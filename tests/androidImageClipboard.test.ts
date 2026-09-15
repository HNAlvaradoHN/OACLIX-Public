import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('Android image clipboard keeps local originals private and short-lived', async () => {
  const [store, transferPolicy] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageClipboardStore.kt'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageTransferPolicy.kt'),
  ])

  assert.match(store, /DIRECTORY_NAME = "oaclix-images"/)
  assert.match(store, /RETENTION_MS = 6L \* 60L \* 60L \* 1000L/)
  assert.match(store, /context\.filesDir/)
  assert.match(store, /createFromUri\(/)
  assert.match(store, /mimeTypeHint: String\? = null/)
  assert.match(store, /startsWith\("image\/"\)/)
  assert.match(store, /image\/png/)
  assert.match(store, /image\/jpeg/)
  assert.match(store, /image\/webp/)
  assert.match(store, /image\/gif/)
  assert.doesNotMatch(store, /MAX_IMAGE_BYTES/)
  assert.doesNotMatch(store, /total\s*<=\s*MAX_IMAGE_BYTES/)

  assert.match(transferPolicy, /CLOUD_MAX_IMAGE_BYTES = 10L \* 1024L \* 1024L/)
  assert.match(transferPolicy, /requiresCloudOptimization/)
})

test('OACLIX exposes image clipboard entries through a read-only provider', async () => {
  const [manifest, provider] = await Promise.all([
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/OaclixImageProvider.kt'),
  ])

  assert.match(manifest, /android:name="\.imageclipboard\.OaclixImageProvider"/)
  assert.match(manifest, /android:authorities="\$\{applicationId\}\.images"/)
  assert.match(provider, /ParcelFileDescriptor\.MODE_READ_ONLY/)
  assert.match(provider, /override fun insert[\s\S]*= null/)
  assert.match(provider, /override fun update[\s\S]*: Int = 0/)
  assert.match(provider, /override fun delete[\s\S]*: Int = 0/)
  assert.match(provider, /isExpired\(file\)/)
})

test('la PWA es la superficie de imágenes y Android conserva almacenamiento/copia nativos sin duplicar esa UI', async () => {
  const [mainActivity, shelf, clipboard, receiver, decoder] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/MainActivity.kt'),
    read('src/components/LocalImageClipboardShelf.tsx'),
    read('src/clipboard/imageSystemClipboard.ts'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageThumbnailDecoder.kt'),
  ])

  assert.match(mainActivity, /WebView\(this\)/)
  assert.doesNotMatch(mainActivity, /ImageClipboardStore\(this\)|item_image_preview|ImageThumbnailDecoder/)
  assert.match(shelf, /readLocalImages\(\)/)
  assert.match(shelf, /URL\.createObjectURL\(image\.blob\)/)
  assert.match(shelf, /<ClipboardCard/)
  assert.match(shelf, /deleteLocalImage\(image\.id\)/)
  assert.match(clipboard, /ClipboardItem/)
  assert.match(receiver, /ImageClipboardStore\(this\)/)
  assert.match(receiver, /imageStore\.createFromUri\(uri, mimeTypeHint = mimeType\)/)
  assert.match(decoder, /BitmapFactory\.Options\(\)\.apply \{ inJustDecodeBounds = true \}/)
  assert.match(decoder, /inSampleSize = sampleSize/)
})

test('Android Sharesheet accepts one image and stores its original locally', async () => {
  const [manifest, receiver, layout, strings] = await Promise.all([
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('android/app/src/main/res/layout/activity_share_receiver.xml'),
    read('android/app/src/main/res/values/strings.xml'),
  ])

  assert.match(manifest, /android:mimeType="image\/\*"/)
  assert.doesNotMatch(manifest, /android\.intent\.action\.SEND_MULTIPLE/)
  assert.match(receiver, /ImageClipboardStore\(this\)/)
  assert.match(receiver, /SharedContentMode\.Image/)
  assert.match(receiver, /private fun loadSharedImage\(source: Intent\)/)
  assert.match(receiver, /val uri = sharedStreamUri\(source\)/)
  assert.match(receiver, /sharedImageMimeType = source\.type/)
  assert.match(receiver, /contentMode == SharedContentMode\.Image[\s\S]*?listOf\(NativeShareDestination\.LocalClipboard\)/)
  assert.match(receiver, /private fun saveLocalImage\(uri: Uri, mimeType: String\?\)/)
  assert.match(receiver, /imageStore\.createFromUri\(uri, mimeTypeHint = mimeType\)/)
  assert.match(receiver, /decodeSharedImagePreview\(uri\)/)
  assert.match(receiver, /BitmapFactory\.Options\(\)\.apply \{ inJustDecodeBounds = true \}/)
  assert.match(layout, /@\+id\/share_image_section/)
  assert.match(layout, /@\+id\/share_image_preview/)
  assert.match(layout, /@\+id\/share_image_meta/)
  assert.match(strings, /name="share_image_subtitle"/)
  assert.match(strings, /name="share_destination_image_local_only"/)
  assert.match(strings, /name="share_image_meta">Local: original · Nube: copia máx\. 10 MB</)
})

test('image clipboard MVP does not add AccessibilityService or Autofill', async () => {
  const manifest = await read('android/app/src/main/AndroidManifest.xml')
  assert.doesNotMatch(manifest, /AccessibilityService|BIND_ACCESSIBILITY_SERVICE/)
  assert.doesNotMatch(manifest, /BIND_AUTOFILL_SERVICE|AutofillService/)
})
