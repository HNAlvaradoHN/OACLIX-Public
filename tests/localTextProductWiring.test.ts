import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appUrl = new URL('../src/App.tsx', import.meta.url)

test('App enruta texto local por la frontera del Transfer Engine y mantiene imagen legacy', async () => {
  const app = await readFile(appUrl, 'utf8')

  assert.match(app, /createLocalTextTransferChunkSource/)
  assert.match(app, /createLocalTransferProductBoundary/)
  assert.match(app, /localTransferBoundaryRef/)
  assert.match(app, /boundary\.sendLocalSource\(senderDeviceId, deviceId, createLocalTextTransferChunkSource\(item\)\)/)
  assert.match(app, /boundary\.disconnect\(\)/)
  assert.doesNotMatch(app, /sendLocalClipboardTextDirect/)
  assert.match(app, /sendLocalImageDirect\(roomId, deviceId, localImageShareItem\)/)
})
