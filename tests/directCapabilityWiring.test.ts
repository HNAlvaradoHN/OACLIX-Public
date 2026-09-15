import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('image-only Direct peer remains cloud fallback for room-core traffic', async () => {
  const manager = await read('src/realtime/lanPeerManager.ts')
  const start = manager.indexOf('hasCloudFallbackPeers()')
  const end = manager.indexOf('notifyCloudFallbackChange()', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const method = manager.slice(start, end)
  assert.match(method, /!peer\.capabilities\.has\('room-core'\)/)
})

test('image-only Direct peer cannot inject clipboard-change traffic', async () => {
  const manager = await read('src/realtime/lanPeerManager.ts')
  const publishIndex = manager.lastIndexOf('publishLanClipboardChange(this.roomId, message.change, remoteDeviceId)')
  assert.notEqual(publishIndex, -1)
  const guardWindow = manager.slice(Math.max(0, publishIndex - 300), publishIndex)
  assert.match(guardWindow, /if \(!peer\.capabilities\.has\('room-core'\)\) return/)
})

test('image Direct availability uses image capability instead of room-core status', async () => {
  const transfer = await read('src/realtime/localImageDirectTransfer.ts')
  const transport = await read('src/transport/localImageDirectTransport.ts')
  assert.match(transfer, /getImageDirectPeerIds\(\): string\[\]/)
  assert.match(transport, /sender\.getImageDirectPeerIds\(\)\.includes\(remoteDeviceId\)/)
  assert.doesNotMatch(transport, /sender\.getValidatedPeerIds\(\)\.includes\(remoteDeviceId\)/)
})
