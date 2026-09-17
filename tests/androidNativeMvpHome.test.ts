import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('la nueva pantalla nativa prioriza dispositivos, contenido local y una sola acción Agregar', async () => {
  const [activity, layout, itemLayout, strings] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/MainActivity.kt'),
    read('android/app/src/main/res/layout/activity_main.xml'),
    read('android/app/src/main/res/layout/item_local_clipboard.xml'),
    read('android/app/src/main/res/values/strings.xml'),
  ])

  assert.match(layout, /@\+id\/linked_devices_shortcuts/)
  assert.match(layout, /@\+id\/items_container/)
  assert.match(layout, /@\+id\/send_something_button/)
  assert.match(layout, /@string\/home_add_content/)

  assert.match(activity, /NativeLinkingFlow\(baseUrl, identity\)\.load\(\)/)
  assert.match(activity, /filter \{ it\.id != currentDeviceId \}/)
  assert.match(activity, /private fun showAddContentMenu\(\)/)
  assert.match(activity, /showWriteTextDialog\(\)/)
  assert.match(activity, /saveFromSystemClipboard\(\)/)
  assert.match(activity, /chooseImage\(\)/)
  assert.match(activity, /openLinkedDevices\(\)/)

  assert.match(itemLayout, /@\+id\/copy_button/)
  assert.match(itemLayout, /@\+id\/share_button/)
  assert.match(itemLayout, /@\+id\/delete_button/)
  assert.match(activity, /Intent\.ACTION_SEND/)
  assert.match(activity, /putExtra\(Intent\.EXTRA_TEXT, text\)/)
  assert.match(activity, /putExtra\(Intent\.EXTRA_STREAM, uri\)/)
  assert.match(activity, /Intent\.FLAG_GRANT_READ_URI_PERMISSION/)
  assert.doesNotMatch(activity, /NativeGeneralShareTransport/)

  assert.match(strings, /name="home_add_write_text">Escribir texto</)
  assert.match(strings, /name="home_add_clipboard">Guardar desde portapapeles</)
  assert.match(strings, /name="home_add_image">Elegir imagen</)
  assert.match(strings, /<plurals name="home_devices_ready">/)
})
