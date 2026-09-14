import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

async function missing(path: string) {
  try {
    await access(new URL(path, root))
    return false
  } catch {
    return true
  }
}

test('OACLIX aparece como acción PROCESS_TEXT y abre el selector compacto de recientes', async () => {
  const [manifest, activity, layout, strings] = await Promise.all([
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/java/app/oaclix/android/ProcessTextActivity.kt'),
    read('android/app/src/main/res/layout/activity_process_text.xml'),
    read('android/app/src/main/res/values/process_text_strings.xml'),
  ])

  assert.match(manifest, /android:name="\.ProcessTextActivity"/)
  assert.match(manifest, /android\.intent\.action\.PROCESS_TEXT/)
  assert.match(manifest, /android:mimeType="text\/plain"/)
  assert.match(activity, /Intent\.ACTION_PROCESS_TEXT/)
  assert.match(activity, /getCharSequenceExtra\(Intent\.EXTRA_PROCESS_TEXT\)/)
  assert.match(activity, /renderRecentItems\(loadRecentItems\(\)\)/)
  assert.match(activity, /history\.list\(\)\.forEach/)
  assert.match(activity, /imageStore\.list\(\)\.forEach/)
  assert.match(activity, /sortedByDescending \{ it\.createdAt \}/)
  assert.match(activity, /\.take\(MAX_RECENTS\)/)
  assert.match(activity, /private const val MAX_RECENTS = 5/)
  assert.match(layout, /@\+id\/process_text_recent_list/)
  assert.match(layout, /@\+id\/process_text_copy_selection/)
  assert.doesNotMatch(layout, /process_text_save_clipboard/)
  assert.match(strings, /OACLIX · Recientes/)
})

test('tocar un reciente de texto lee inline o .txt, intenta reemplazar y deja respaldo listo para Pegar', async () => {
  const activity = await read('android/app/src/main/java/app/oaclix/android/ProcessTextActivity.kt')

  assert.match(activity, /setOnClickListener \{ chooseTextRecent\(item\) \}/)
  assert.match(activity, /history\.read\(item\)/)
  assert.match(activity, /OaclixClipboardBridge\.copy\(this, text\)/)
  assert.match(activity, /Intent\(\)\.putExtra\(Intent\.EXTRA_PROCESS_TEXT, text\)/)
  assert.match(activity, /setResult\(RESULT_OK, result\)/)
  assert.match(activity, /Intent\.EXTRA_PROCESS_TEXT_READONLY/)
})

test('recientes rápidos mezclan imágenes con texto y muestran miniatura compacta, Imagen y tamaño', async () => {
  const [activity, imageStore, decoder, strings] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/ProcessTextActivity.kt'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageClipboardStore.kt'),
    read('android/app/src/main/java/app/oaclix/android/imageclipboard/ImageThumbnailDecoder.kt'),
    read('android/app/src/main/res/values/process_text_strings.xml'),
  ])

  assert.match(activity, /ImageClipboardStore\(this\)/)
  assert.match(activity, /RecentDisplayItem\.Image/)
  assert.match(activity, /createImageRecentRow/)
  assert.match(activity, /LinearLayout\.HORIZONTAL/)
  assert.match(activity, /ImageView\.ScaleType\.CENTER_CROP/)
  assert.match(activity, /LinearLayout\.LayoutParams\(dp\(50\), dp\(50\)\)/)
  assert.match(activity, /ImageThumbnailDecoder\.decode\(/)
  assert.match(decoder, /BitmapFactory\.Options\(\)\.apply \{ inJustDecodeBounds = true \}/)
  assert.match(decoder, /inSampleSize = sampleSize/)
  assert.match(decoder, /store\.openInputStream\(item\)/)
  assert.match(imageStore, /fun openInputStream\(item: ImageClipboardItem\): InputStream/)
  assert.match(imageStore, /FileInputStream\(file\)/)
  assert.match(activity, /formatImageSize\(item\.byteSize\)/)
  assert.match(strings, /name="process_text_image_title">Imagen</)
  assert.match(strings, /name="process_text_image_meta">%1\$s · %2\$s</)
})

test('tocar una imagen reciente la deja en Android Clipboard sin intentar EXTRA_PROCESS_TEXT', async () => {
  const activity = await read('android/app/src/main/java/app/oaclix/android/ProcessTextActivity.kt')

  assert.match(activity, /setOnClickListener \{ chooseImageRecent\(item\) \}/)
  assert.match(activity, /imageStore\.contentUri\(item\)/)
  assert.match(activity, /ClipData\.newUri\(contentResolver, getString\(R\.string\.image_clip_label\), uri\)/)
  assert.match(activity, /clipboard\.setPrimaryClip\(clip\)/)
  assert.match(activity, /process_text_image_copied/)
  assert.match(activity, /private fun chooseImageRecent[\s\S]*?setResult\(RESULT_CANCELED\)[\s\S]*?finish\(\)/)
})

test('Copiar selección guarda texto largo como historial .txt sin truncado propio', async () => {
  const activity = await read('android/app/src/main/java/app/oaclix/android/ProcessTextActivity.kt')

  assert.match(activity, /copySelectionAction\.setOnClickListener \{ copySelectedTextAndClose\(\) \}/)
  assert.match(activity, /OaclixClipboardBridge\.copy\(this, selectedText\)/)
  assert.match(activity, /history\.save\(selectedText\)/)
  assert.match(activity, /setResult\(RESULT_CANCELED\)/)
  assert.doesNotMatch(activity, /selectedText\.length <= LocalClipboardPolicy\.MAX_TEXT_LENGTH/)
  assert.doesNotMatch(activity, /selectedText\.take\(/)
  assert.doesNotMatch(activity, /selectedText\.substring\(/)
})

test('al abrir OACLIX con foco captura automáticamente solo el clipboard grande y elimina el paso Guardar lo que copié', async () => {
  const [activity, layout, strings] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/ProcessTextActivity.kt'),
    read('android/app/src/main/res/layout/activity_process_text.xml'),
    read('android/app/src/main/res/values/process_text_strings.xml'),
  ])

  assert.match(activity, /override fun onWindowFocusChanged\(hasFocus: Boolean\)/)
  assert.match(activity, /if \(!hasFocus \|\| largeClipboardChecked\) return/)
  assert.match(activity, /captureLargeClipboardOnOpen\(\)/)
  assert.match(activity, /getSystemService\(ClipboardManager::class\.java\)/)
  assert.match(activity, /clipboard\.primaryClip/)
  assert.match(activity, /getItemAt\(0\)[\s\S]*?\.text/)
  assert.match(activity, /text\.length <= LocalClipboardPolicy\.MAX_TEXT_LENGTH/)
  assert.match(activity, /history\.canSave\(text\)/)
  assert.match(activity, /visibleRecents[\s\S]*?history\.read\(entry\)/)
  assert.match(activity, /history\.save\(text\)/)
  assert.match(activity, /ioExecutor\.execute/)
  assert.match(activity, /process_text_large_clipboard_ready/)
  assert.doesNotMatch(layout, /process_text_save_clipboard/)
  assert.doesNotMatch(strings, /Guardar lo que copié/)
  assert.match(strings, /Texto grande copiado listo/)
})

test('historial unificado enruta >8.000 a archivo .txt privado y conserva inline para texto normal', async () => {
  const [history, fileStore, activity, strings] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/localclipboard/LocalClipboardHistory.kt'),
    read('android/app/src/main/java/app/oaclix/android/localclipboard/LargeTextFileStore.kt'),
    read('android/app/src/main/java/app/oaclix/android/ProcessTextActivity.kt'),
    read('android/app/src/main/res/values/process_text_strings.xml'),
  ])

  assert.match(history, /text\.length <= LocalClipboardPolicy\.MAX_TEXT_LENGTH/)
  assert.match(history, /LocalClipboardEntry\.Inline\(repository\.create\(text, now\)\)/)
  assert.match(history, /LocalClipboardEntry\.TextFile\(fileStore\.create\(text, now\)\)/)
  assert.match(history, /inlineItems \+ fileItems/)
  assert.match(fileStore, /DIRECTORY_NAME = "oaclix-large-text"/)
  assert.match(fileStore, /MAX_FILE_BYTES = 384 \* 1024/)
  assert.match(fileStore, /File\(directory, "\$id\.txt"\)/)
  assert.match(fileStore, /file\.writeBytes\(bytes\)/)
  assert.match(activity, /LocalClipboardEntry\.TextFile/)
  assert.match(strings, /process_text_file_preview/)
})

test('selector PROCESS_TEXT usa una ventana flotante compacta y mantiene Autofill/Accesibilidad fuera', async () => {
  const [manifest, styles, mainActivity, mainLayout, strings, gradle] = await Promise.all([
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/res/values/process_text_styles.xml'),
    read('android/app/src/main/java/app/oaclix/android/MainActivity.kt'),
    read('android/app/src/main/res/layout/activity_main.xml'),
    read('android/app/src/main/res/values/strings.xml'),
    read('android/app/build.gradle.kts'),
  ])

  const processActivity = manifest.match(
    /<activity[\s\S]*?android:name="\.ProcessTextActivity"[\s\S]*?<\/activity>/,
  )?.[0] ?? ''

  assert.notEqual(processActivity, '')
  assert.doesNotMatch(processActivity, /android:noHistory="true"/)
  assert.match(styles, /android:windowMinWidthMajor">86%/)
  assert.match(styles, /android:windowCloseOnTouchOutside">true/)
  assert.doesNotMatch(manifest, /AccessibilityService|BIND_ACCESSIBILITY_SERVICE|OaclixPasteAccessibilityService/)
  assert.doesNotMatch(manifest, /OaclixAutofillService|BIND_AUTOFILL_SERVICE/)
  assert.doesNotMatch(mainActivity, /OaclixPasteAccessibilityService|AutofillManager|ACTION_REQUEST_SET_AUTOFILL_SERVICE/)
  assert.doesNotMatch(mainLayout, /direct_paste_|autofill_/)
  assert.doesNotMatch(strings, /direct_paste_|name="autofill_/)
  assert.doesNotMatch(gradle, /androidx\.autofill/)
  assert.equal(await missing('android/app/src/main/java/app/oaclix/android/OaclixPasteAccessibilityService.kt'), true)
})

test('portapapeles OACLIX sigue usando texto plano y marca sensible Android 13+', async () => {
  const bridge = await read('android/app/src/main/java/app/oaclix/android/OaclixClipboardBridge.kt')

  assert.match(bridge, /ClipData\.newPlainText\(context\.getString\(R\.string\.clip_label\), text\)/)
  assert.match(bridge, /clipboard\.setPrimaryClip\(clip\)/)
  assert.match(bridge, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.TIRAMISU/)
  assert.match(bridge, /ClipDescription\.EXTRA_IS_SENSITIVE/)
  assert.doesNotMatch(bridge, /ClipData\.newUri|INLINE_CLIPBOARD_BYTES|ContentResolver|current\.txt|writeText/)
})
