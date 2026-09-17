import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('Sharesheet Android usa icono OACLIX y una superficie visual propia', async () => {
  const [manifest, layout, styles, icon] = await Promise.all([
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/res/layout/activity_share_receiver.xml'),
    read('android/app/src/main/res/values/styles.xml'),
    read('android/app/src/main/res/drawable/ic_oaclix_mark.xml'),
  ])

  assert.match(manifest, /android:icon="@drawable\/ic_oaclix_mark"/)
  assert.match(manifest, /android:roundIcon="@drawable\/ic_oaclix_mark"/)
  assert.match(layout, /@drawable\/share_dialog_background/)
  assert.match(layout, /@drawable\/ic_oaclix_mark/)
  assert.match(styles, /android:windowBackground">@android:color\/transparent/)
  assert.match(styles, /android:backgroundDimAmount">0\.72/)
  assert.match(icon, /<vector/)
  assert.match(icon, /#8B7CFF/)
})

test('editor de compartir muestra contador, conserva 8.000 y no recorta en silencio', async () => {
  const [activity, layout, strings] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('android/app/src/main/res/layout/activity_share_receiver.xml'),
    read('android/app/src/main/res/values/strings.xml'),
  ])

  assert.match(activity, /LocalClipboardPolicy\.MAX_TEXT_LENGTH/)
  assert.match(activity, /share_character_count/)
  assert.match(activity, /text\.length <= LocalClipboardPolicy\.MAX_TEXT_LENGTH/)
  assert.match(activity, /text\.length > LocalClipboardPolicy\.MAX_TEXT_LENGTH/)
  assert.doesNotMatch(activity, /take\(8_000\)/)
  assert.doesNotMatch(layout, /android:maxLength=/)
  assert.match(layout, /@drawable\/share_editor_background/)
  assert.match(strings, /name="share_character_count"/)
})

test('destinos y acciones del Sharesheet tienen estados táctiles propios', async () => {
  const [activity, layout, destination, primary, secondary] = await Promise.all([
    read('android/app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    read('android/app/src/main/res/layout/activity_share_receiver.xml'),
    read('android/app/src/main/res/drawable/share_destination_selector.xml'),
    read('android/app/src/main/res/drawable/share_primary_button.xml'),
    read('android/app/src/main/res/drawable/share_secondary_button.xml'),
  ])

  assert.match(activity, /share_destination_selector/)
  assert.match(activity, /buttonTintList = buttonTint/)
  assert.match(layout, /@drawable\/share_primary_button/)
  assert.match(layout, /@drawable\/share_secondary_button/)
  assert.match(destination, /state_checked="true"/)
  assert.match(primary, /<ripple/)
  assert.match(secondary, /<ripple/)
})

test('pantalla principal Android reutiliza estilos visuales OACLIX en tarjetas y acciones', async () => {
  const [layout, itemLayout, styles] = await Promise.all([
    read('android/app/src/main/res/layout/activity_main.xml'),
    read('android/app/src/main/res/layout/item_local_clipboard.xml'),
    read('android/app/src/main/res/values/styles.xml'),
  ])

  assert.match(styles, /Widget\.Oaclix\.Button\.Primary/)
  assert.match(styles, /Widget\.Oaclix\.Button\.Secondary/)
  assert.match(styles, /Widget\.Oaclix\.Button\.Danger/)
  assert.match(styles, /android:textAllCaps">false/)
  assert.match(layout, /style="@style\/Widget\.Oaclix\.Button\.Primary"/)
  assert.match(layout, /style="@style\/Widget\.Oaclix\.Button\.Secondary"/)
  assert.match(layout, /@drawable\/local_item_background/)
  assert.match(layout, /@\+id\/linked_devices_shortcuts/)
  assert.match(layout, /@\+id\/items_container/)
  assert.doesNotMatch(layout, /android:backgroundTint="@color\/oaclix_accent"/)
  assert.match(itemLayout, /style="@style\/Widget\.Oaclix\.Button\.Secondary"/)
  assert.match(itemLayout, /style="@style\/Widget\.Oaclix\.Button\.Danger"/)
})
