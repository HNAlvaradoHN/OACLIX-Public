import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('Vinculados Android reutiliza superficies y estilos visuales OACLIX', async () => {
  const [layout, activity] = await Promise.all([
    read('android/app/src/main/res/layout/activity_link_device.xml'),
    read('android/app/src/main/java/app/oaclix/android/LinkDeviceActivity.kt'),
  ])

  assert.match(layout, /style="@style\/Widget\.Oaclix\.Button\.Primary"/)
  assert.match(layout, /style="@style\/Widget\.Oaclix\.Button\.Secondary"/)
  assert.match(layout, /@drawable\/share_editor_background/)
  assert.match(layout, /@drawable\/local_item_background/)
  assert.doesNotMatch(layout, /android:backgroundTint="@color\/oaclix_accent"/)

  assert.match(activity, /R\.drawable\.local_item_background/)
  assert.match(activity, /R\.style\.Widget_Oaclix_Button_Secondary/)
  assert.match(activity, /R\.style\.Widget_Oaclix_Button_Danger/)
  assert.match(activity, /styledActionButton/)
})
