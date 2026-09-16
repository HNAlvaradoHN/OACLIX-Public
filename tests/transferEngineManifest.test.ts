import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRANSFER_ENGINE_CHUNK_BYTES,
  buildTransferManifestFromBlob,
  expectedTransferChunkBytes,
  verifyTransferChunk,
  verifyTransferManifest,
} from '../src/transfer/transferManifest.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const requestId = 'req_0123456789abcdef01234567'
const transferId = 'txf_0123456789abcdef0123456789abcdef'

function sampleBytes(size: number) {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
  return bytes
}

test('manifest usa chunks lógicos de 4 MiB y hashes SHA-256 sin payload embebido', async () => {
  const bytes = sampleBytes(TRANSFER_ENGINE_CHUNK_BYTES + 17)
  const blob = new Blob([bytes])
  const manifest = await buildTransferManifestFromBlob(blob, {
    requestId,
    transferId,
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'file',
    createdAt: 1_800_000_000_000,
  })

  assert.equal(manifest.byteSize, bytes.byteLength)
  assert.equal(manifest.chunkCount, 2)
  assert.equal(manifest.chunks[0]?.byteLength, TRANSFER_ENGINE_CHUNK_BYTES)
  assert.equal(manifest.chunks[1]?.byteLength, 17)
  assert.equal(manifest.chunks[0]?.sha256.length, 64)
  assert.equal(manifest.manifestSha256.length, 64)
  assert.equal(await verifyTransferManifest(manifest), true)

  const serialized = JSON.stringify(manifest)
  assert.doesNotMatch(serialized, /base64Data|fileName|payload|contentData/)
  assert.equal(serialized.includes('0,1,2,3'), false)
})

test('cada chunk se verifica de forma independiente y un byte alterado falla integridad', async () => {
  const bytes = sampleBytes(TRANSFER_ENGINE_CHUNK_BYTES + 9)
  const blob = new Blob([bytes])
  const manifest = await buildTransferManifestFromBlob(blob, {
    requestId,
    transferId,
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'image',
    createdAt: 1_800_000_000_000,
  })

  const first = bytes.slice(0, TRANSFER_ENGINE_CHUNK_BYTES)
  assert.equal(await verifyTransferChunk(manifest, 0, first), true)
  first[0] ^= 0xff
  assert.equal(await verifyTransferChunk(manifest, 0, first), false)
  assert.equal(expectedTransferChunkBytes(manifest.byteSize, 1), 9)
})

test('manifest detecta alteración de metadata aunque los hashes de chunks no cambien', async () => {
  const manifest = await buildTransferManifestFromBlob(new Blob([sampleBytes(32)]), {
    requestId,
    transferId,
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'text',
    createdAt: 1_800_000_000_000,
  })
  assert.equal(await verifyTransferManifest(manifest), true)

  const tampered = { ...manifest, byteSize: manifest.byteSize + 1 }
  assert.equal(await verifyTransferManifest(tampered), false)
})

test('archivo vacío tiene manifest válido sin inventar chunks', async () => {
  const manifest = await buildTransferManifestFromBlob(new Blob([]), {
    requestId,
    transferId,
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'file',
    createdAt: 1_800_000_000_000,
  })
  assert.equal(manifest.byteSize, 0)
  assert.equal(manifest.chunkCount, 0)
  assert.deepEqual(manifest.chunks, [])
  assert.equal(await verifyTransferManifest(manifest), true)
})
