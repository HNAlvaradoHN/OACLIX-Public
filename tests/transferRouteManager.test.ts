import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  publishDataChannelDeviceIds,
  publishRealtimeOnlineDeviceIds,
} from '../src/realtime/deviceAvailability.ts'
import type { TransferContentKind } from '../src/shared/transferControlProtocol.ts'
import { createBlobTransferChunkSource } from '../src/transfer/transferChunkSource.ts'
import { prepareSenderTransferOperation } from '../src/transfer/transferOperationCoordinator.ts'
import {
  createPreparedTransferRouteManager,
  selectPreparedTransferRoute,
} from '../src/transfer/transferRouteManager.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'

async function preparedOperation(contentKind: TransferContentKind = 'text') {
  const now = Date.now()
  const blob = new Blob(['hello'])
  const source = createBlobTransferChunkSource(blob, contentKind)
  return prepareSenderTransferOperation({
    version: 1,
    type: 'route-intent',
    requestId: 'req_0123456789abcdef01234567',
    senderDeviceId,
    receiverDeviceId,
    contentKind,
    byteSize: blob.size,
    requestCreatedAt: now - 1_000,
    requestExpiresAt: now + 60_000,
    decisionAt: now - 500,
    acceptedAt: now - 400,
  }, source, now, async () => undefined)
}

test('presencia online sin DataChannel validado no se trata como ruta local', async () => {
  const roomId = 'room_route_presence_only'
  publishRealtimeOnlineDeviceIds(roomId, [receiverDeviceId])
  const operation = await preparedOperation('text')
  const selection = await selectPreparedTransferRoute(roomId, operation)

  assert.equal(selection.status, 'unavailable')
  assert.equal(selection.route, null)
})

test('DataChannel validado selecciona local-direct para texto sin mover bytes', async () => {
  const roomId = 'room_route_text_direct'
  publishDataChannelDeviceIds(roomId, [receiverDeviceId])
  const operation = await preparedOperation('text')
  const manager = createPreparedTransferRouteManager(roomId)
  const selection = await manager.acceptPreparedSenderOperation(operation)

  assert.equal(selection.status, 'selected')
  assert.equal(selection.route, 'local-direct')
  assert.equal(selection.transferId, operation.manifest.transferId)
  assert.equal(selection.requestId, operation.manifest.requestId)
  assert.doesNotMatch(JSON.stringify(selection), /hello|payload|sourceRef|itemId/)
})

test('DataChannel validado selecciona local-direct para imagen', async () => {
  const roomId = 'room_route_image_direct'
  publishDataChannelDeviceIds(roomId, [receiverDeviceId])
  const operation = await preparedOperation('image')
  const selection = await selectPreparedTransferRoute(roomId, operation)

  assert.equal(selection.status, 'selected')
  assert.equal(selection.route, 'local-direct')
})

test('archivo queda unavailable aunque exista DataChannel porque aún no hay adaptador local probado', async () => {
  const roomId = 'room_route_file_unavailable'
  publishDataChannelDeviceIds(roomId, [receiverDeviceId])
  const operation = await preparedOperation('file')
  const selection = await selectPreparedTransferRoute(roomId, operation)

  assert.equal(selection.status, 'unavailable')
  assert.equal(selection.route, null)
})

test('Route Manager rechaza operaciones que ya no están en estado prepared', async () => {
  const roomId = 'room_route_invalid_journal'
  publishDataChannelDeviceIds(roomId, [receiverDeviceId])
  const operation = await preparedOperation('text')
  operation.journal = { ...operation.journal, status: 'transferring', updatedAt: Date.now() }

  await assert.rejects(
    () => selectPreparedTransferRoute(roomId, operation),
    /solo acepta operaciones sender preparadas/,
  )
})

test('selección de ruta está separada de transportes legacy y no envía bytes', async () => {
  const code = await readFile(new URL('../src/transfer/transferRouteManager.ts', import.meta.url), 'utf8')
  assert.match(code, /getDeviceAvailabilityState/)
  assert.doesNotMatch(code, /sendLocalClipboardTextDirect|sendLocalImageDirect|sendDeviceTransfer|RTCDataChannel|RTCPeerConnection|WebSocket/)
})
