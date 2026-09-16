import assert from 'node:assert/strict'
import test from 'node:test'
import {
  connectTransferSendCoordinator,
  sendTransferRequestForSource,
} from '../src/transfer/transferSendCoordinator.ts'
import { createBlobTransferChunkSource } from '../src/transfer/transferChunkSource.ts'
import type { PreparedSenderTransferOperation } from '../src/transfer/transferOperationCoordinator.ts'
import type { TransferRouteSelection } from '../src/transfer/transferRouteManager.ts'
import {
  publishTransferControl,
  registerTransferControlSender,
} from '../src/realtime/transferControlBus.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'

function source() {
  return createBlobTransferChunkSource(new Blob(['hello']), 'text', {
    version: 1,
    provider: 'local-text',
    itemId: 'itm_0123456789abcdef0123456789abcdef',
  })
}

function selectedRoute(operation: PreparedSenderTransferOperation): TransferRouteSelection {
  return {
    version: 1,
    type: 'transfer-route-selection',
    requestId: operation.manifest.requestId,
    transferId: operation.manifest.transferId,
    senderDeviceId: operation.manifest.senderDeviceId,
    receiverDeviceId: operation.manifest.receiverDeviceId,
    contentKind: operation.manifest.contentKind,
    status: 'selected',
    route: 'local-direct',
    selectedAt: Date.now(),
  }
}

test('fallo asíncrono del handoff del data plane vuelve a onError', async () => {
  const roomId = 'room_async_data_plane_error'
  const expected = new Error('data plane falló')
  registerTransferControlSender(roomId, () => true)

  let resolveError!: (error: unknown) => void
  const receivedError = new Promise<unknown>((resolve) => {
    resolveError = resolve
  })
  const disconnect = connectTransferSendCoordinator(
    roomId,
    {
      acceptPreparedSenderOperation(operation) {
        return selectedRoute(operation)
      },
    },
    {
      async onHandoff() {
        await Promise.resolve()
        throw expected
      },
      onError(_intent, error) {
        resolveError(error)
      },
    },
    async () => undefined,
  )

  const request = await sendTransferRequestForSource(
    roomId,
    senderDeviceId,
    receiverDeviceId,
    source(),
  )
  publishTransferControl(roomId, {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: Date.now(),
  }, receiverDeviceId)

  assert.equal(await receivedError, expected)
  disconnect()
})
