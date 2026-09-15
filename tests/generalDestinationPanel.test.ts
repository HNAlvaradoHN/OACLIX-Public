import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const panelPath = new URL('../src/components/GeneralDestinationPanel.tsx', import.meta.url)

async function panelSource() {
  return readFile(panelPath, 'utf8')
}

test('General destination picker chooses only deviceId and leaves route decision to runtime', async () => {
  const source = await panelSource()

  assert.match(source, /onSelect: \(deviceId: string\) => Promise<void>/)
  assert.match(source, /await onSelect\(deviceId\)/)
  assert.doesNotMatch(source, /onSelect\(deviceId,\s*status\)/)
  assert.match(source, /OACLIX comprobará de nuevo autorización y ruta justo al enviar/)
})

test('General destination picker only enables destinations with Directo or Nube route', async () => {
  const source = await panelSource()

  assert.match(source, /status === 'direct' \|\| status === 'cloud'/)
  assert.match(source, /status === 'offline'/)
  assert.match(source, /status === 'checking'/)
  assert.match(source, /Enviar aquí/)
})

test('General destination picker loads linked roster and reacts to Directo route changes', async () => {
  const source = await panelSource()

  assert.match(source, /loadLinkedShareDevices\(identity\.generalRoomId\)/)
  assert.match(source, /subscribeDirectLanStatus/)
  assert.match(source, /getDeviceRouteStatus\(identity\.generalRoomId, device\.id\)/)
})
