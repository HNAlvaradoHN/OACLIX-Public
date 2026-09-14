import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  CLOUD_IMAGE_MAX_BYTES,
  LOCAL_IMAGE_RETENTION_MS,
} from '../src/shared/localImageTransferCore.ts'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('Direct image protocol chunks the original without applying the cloud cap', async () => {
  const protocol = await read('src/realtime/localImageDirectTransfer.ts')
  const largerThanCloud = CLOUD_IMAGE_MAX_BYTES * 3 + 123

  assert.ok(largerThanCloud > CLOUD_IMAGE_MAX_BYTES)
  assert.match(protocol, /export const DIRECT_IMAGE_CHUNK_BYTES = 64 \* 1024/)
  assert.match(protocol, /chunkCount: Math\.ceil\(item\.byteSize \/ DIRECT_IMAGE_CHUNK_BYTES\)/)
  assert.match(protocol, /Number\.isSafeInteger\(item\.byteSize\)[\s\S]*Number\(item\.byteSize\) > 0/)
  assert.match(protocol, /expectedDirectImageChunkBytes/)
  assert.doesNotMatch(protocol, /CLOUD_IMAGE_MAX_BYTES/)
})

test('Direct image protocol validates identity, format, retention and chunk metadata', async () => {
  const protocol = await read('src/realtime/localImageDirectTransfer.ts')

  assert.match(protocol, /transfer\.senderDeviceId === transfer\.receiverDeviceId/)
  assert.match(protocol, /SUPPORTED_MIME_TYPES\.has\(item\.mimeType\)/)
  assert.match(protocol, /Number\(item\.expiresAt\) - Number\(item\.createdAt\) <= LOCAL_IMAGE_RETENTION_MS/)
  assert.match(protocol, /transfer\.chunkSize !== DIRECT_IMAGE_CHUNK_BYTES/)
  assert.match(protocol, /transfer\.chunkCount === Math\.ceil\(transfer\.item\.byteSize \/ transfer\.chunkSize\)/)
})

test('Direct image ACK stays targeted and has only terminal states', async () => {
  const protocol = await read('src/realtime/localImageDirectTransfer.ts')

  assert.match(protocol, /status: 'stored' \| 'expired' \| 'rejected'/)
  assert.match(protocol, /transferId: transfer\.transferId/)
  assert.match(protocol, /senderDeviceId: transfer\.senderDeviceId/)
  assert.match(protocol, /receiverDeviceId: transfer\.receiverDeviceId/)
  assert.match(protocol, /itemId: transfer\.item\.id/)
})

test('Direct receive path preserves originals larger than the cloud limit', async () => {
  const localStore = await read('src/data/localImageClipboard.ts')
  const directSize = CLOUD_IMAGE_MAX_BYTES + 1

  assert.ok(directSize > CLOUD_IMAGE_MAX_BYTES)
  assert.equal(LOCAL_IMAGE_RETENTION_MS, 6 * 60 * 60 * 1000)
  assert.match(localStore, /if \(!Number\.isSafeInteger\(item\.byteSize\) \|\| item\.byteSize <= 0\)/)
  assert.match(localStore, /if \(blob\.size !== item\.byteSize \|\| blob\.type !== item\.mimeType\)/)
  assert.match(localStore, /receivedVia: 'direct' \| 'cloud'/)
  assert.match(localStore, /receivedVia,/)
  assert.doesNotMatch(localStore, /CLOUD_IMAGE_MAX_BYTES/)
})

test('PWA Direct image wiring uses binary WebRTC, stores before ACK and never auto-falls back to cloud', async () => {
  const [manager, transport, panel, app] = await Promise.all([
    read('src/realtime/lanPeerManager.ts'),
    read('src/transport/localImageDirectTransport.ts'),
    read('src/components/LocalImageSharePanel.tsx'),
    read('src/App.tsx'),
  ])

  assert.match(manager, /channel\.binaryType = 'arraybuffer'/)
  assert.match(manager, /type: 'local-image-direct-start'/)
  assert.match(manager, /channel\.send\(chunk\)/)
  assert.match(manager, /IMAGE_BUFFER_HIGH_WATER_BYTES/)
  assert.match(manager, /publishLanLocalImageDirectTransfer/)

  assert.match(
    transport,
    /void storeReceivedLocalImageBlob\([\s\S]*?\)\.then\(\(stored\) => \{\s*sender\.sendLocalImageDirectAck/,
  )
  assert.match(transport, /requireAuthorizedDirectDevice/)
  assert.doesNotMatch(transport, /CLOUD_IMAGE_MAX_BYTES/)
  assert.doesNotMatch(transport, /device-image-transfer/)

  assert.match(panel, /Original por Directo local/)
  assert.match(panel, /Nube no se usará automáticamente/)
  assert.match(panel, /original sin límite cloud/)
  assert.match(app, /subscribeLocalImageDirectReceipts/)
  assert.match(app, /onShareImage=\{openLocalImageShare\}/)
})

test('Direct image sender reads bounded windows while keeping 64 KiB DataChannel messages', async () => {
  const manager = await read('src/realtime/lanPeerManager.ts')

  assert.match(manager, /const IMAGE_CHUNKS_PER_READ = 16/)
  assert.match(manager, /chunkBase \+= IMAGE_CHUNKS_PER_READ/)
  assert.match(manager, /blob\.slice\(windowStart, windowEnd\)\.arrayBuffer\(\)/)
  assert.match(manager, /new Uint8Array\(windowBuffer, chunkOffset, expectedBytes\)/)
  assert.match(manager, /expectedDirectImageChunkBytes\(transfer, chunkIndex\)/)
  assert.match(manager, /waitForImageBuffer\(remoteDeviceId, peer, channel\)/)
  assert.doesNotMatch(manager, /const chunk = await blob\.slice\(start, end\)\.arrayBuffer\(\)/)
})
