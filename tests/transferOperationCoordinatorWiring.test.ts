import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('preparar una operación no elige transporte ni mueve payload por control', async () => {
  const source = await readFile(new URL('../src/transfer/transferOperationCoordinator.ts', import.meta.url), 'utf8')
  assert.match(source, /subscribeTransferRouteIntent/)
  assert.match(source, /buildTransferManifestFromBlob/)
  assert.match(source, /createTransferJournal\(manifest, 'sender'/)
  assert.match(source, /await persist\(manifest, journal, now, sourceRef\)/)
  assert.doesNotMatch(source, /WebSocket|RTCPeerConnection|RTCDataChannel|sendDeviceTransfer|sendLocalImageDirect|device-image-transfer|device-transfer/)
})

test('referencia reanudable permite solo providers locales explícitos', async () => {
  const source = await readFile(new URL('../src/transfer/transferChunkSource.ts', import.meta.url), 'utf8')
  assert.match(source, /TransferSourceProvider = 'local-text' \| 'local-image'/)
  assert.doesNotMatch(source, /contentUri|absolutePath|fileName|privateKey|token/)
})
