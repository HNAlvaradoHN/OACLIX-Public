from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1))


manager = 'src/realtime/lanPeerManager.ts'
replace_once(
    manager,
    "      if (!peer?.validated || peer.channel?.readyState !== 'open') return true\n",
    "      if (\n        !peer?.validated\n        || peer.channel?.readyState !== 'open'\n        || !peer.capabilities.has('room-core')\n      ) return true\n",
)
replace_once(
    manager,
    "      if (message.change.type === 'upsert' && message.change.item.authorDeviceId !== remoteDeviceId) return\n      publishLanClipboardChange(this.roomId, message.change, remoteDeviceId)\n",
    "      if (!peer.capabilities.has('room-core')) return\n      if (message.change.type === 'upsert' && message.change.item.authorDeviceId !== remoteDeviceId) return\n      publishLanClipboardChange(this.roomId, message.change, remoteDeviceId)\n",
)

replace_once(
    'tests/generalDirectedDataChannel.test.ts',
    "  assert.match(manager, /if \\(!peer\\?\\.validated \\|\\| peer\\.channel\\?\\.readyState !== 'open'\\) return false/)\n",
    "  assert.match(manager, /sendClipboardChangeToPeer[\\s\\S]*?!peer\\?\\.validated[\\s\\S]*?!peer\\.capabilities\\.has\\('room-core'\\)[\\s\\S]*?return false/)\n",
)

Path('tests/directCapabilityWiring.test.ts').write_text("""import assert from 'node:assert/strict'
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
  assert.match(method, /!peer\\.capabilities\\.has\\('room-core'\\)/)
})

test('image-only Direct peer cannot inject clipboard-change traffic', async () => {
  const manager = await read('src/realtime/lanPeerManager.ts')
  const publishIndex = manager.lastIndexOf('publishLanClipboardChange(this.roomId, message.change, remoteDeviceId)')
  assert.notEqual(publishIndex, -1)
  const guardWindow = manager.slice(Math.max(0, publishIndex - 300), publishIndex)
  assert.match(guardWindow, /if \\(!peer\\.capabilities\\.has\\('room-core'\\)\\) return/)
})

test('image Direct availability uses image capability instead of room-core status', async () => {
  const transfer = await read('src/realtime/localImageDirectTransfer.ts')
  const transport = await read('src/transport/localImageDirectTransport.ts')
  assert.match(transfer, /getImageDirectPeerIds\\(\\): string\\[\\]/)
  assert.match(transport, /sender\\.getImageDirectPeerIds\\(\\)\\.includes\\(remoteDeviceId\\)/)
  assert.doesNotMatch(transport, /sender\\.getValidatedPeerIds\\(\\)\\.includes\\(remoteDeviceId\\)/)
})
""")
