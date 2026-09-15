import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('LanPeerManager can send a clipboard change to exactly one validated peer', async () => {
  const manager = await read('src/realtime/lanPeerManager.ts')

  assert.match(manager, /sendClipboardChangeToPeer\(remoteDeviceId: string, change: LanClipboardChange\)/)
  assert.match(manager, /if \(!validLanClipboardChange\(change\)\) return false/)
  assert.match(manager, /const peer = this\.peers\.get\(remoteDeviceId\)/)
  assert.match(manager, /sendClipboardChangeToPeer[\s\S]*?!peer\?\.validated[\s\S]*?!peer\.capabilities\.has\('room-core'\)[\s\S]*?return false/)
  assert.match(manager, /peer\.channel\.send\(JSON\.stringify\(\{ type: 'clipboard-change', change \} satisfies DirectMessage\)\)/)
})

test('directed primitive does not replace the existing broadcast contract', async () => {
  const manager = await read('src/realtime/lanPeerManager.ts')

  assert.match(manager, /broadcastClipboardChange\(change: LanClipboardChange\)/)
  assert.match(manager, /for \(const peer of this\.peers\.values\(\)\)/)
  assert.match(manager, /sendClipboardChangeToPeer[\s\S]*?this\.peers\.get\(remoteDeviceId\)/)
})
