import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appPath = new URL('../src/App.tsx', import.meta.url)
const composerPath = new URL('../src/components/ClipboardComposer.tsx', import.meta.url)

test('General exige destino explícito y conserva el texto si se cancela el selector', async () => {
  const app = await readFile(appPath, 'utf8')
  const composer = await readFile(composerPath, 'utf8')
  assert.match(app, /GeneralDestinationPanel/)
  assert.match(app, /sendGeneralTargetedText\(roomId, deviceId, text\)/)
  assert.match(app, /routeText="Elige un dispositivo al enviar"/)
  assert.match(app, /return false/)
  assert.match(composer, /shouldClear !== false/)
  assert.match(composer, /resetKey/)
})

test('General mantiene recepción dirigida mientras OACLIX está abierta', async () => {
  const app = await readFile(appPath, 'utf8')
  assert.match(app, /ensureClipboardRoomForegroundReception\(roomId\)/)
  assert.match(app, /suspendClipboardRoomForegroundReception\(roomId\)/)
  assert.match(app, /subscribeGeneralTargetedReceipts/)
  assert.match(app, /readGeneralTargetedInbox\(roomId\)/)
})

test('los textos dirigidos se borran localmente sin emitir delete compartido', async () => {
  const app = await readFile(appPath, 'utf8')
  assert.match(app, /generalTargetedItems\.some/)
  assert.match(app, /deleteGeneralTargetedInboxItem\(roomId, itemId\)/)
  assert.match(app, /await deleteGeneralText\(itemId\)/)
})
