import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publishTransferControl,
  registerTransferControlSender,
} from '../src/realtime/transferControlBus.ts'
import type { TransferControlRequest } from '../src/shared/transferControlProtocol.ts'
import { createBlobTransferChunkSource } from '../src/transfer/transferChunkSource.ts'
import { createLocalTransferProductBoundary } from '../src/transfer/localTransferProductBoundary.ts'
import type { PreparedSenderTransferOperation } from '../src/transfer/transferOperationCoordinator.ts'
import type { TransferRouteSelection } from '../src/transfer/transferRouteManager.ts'
import { hasPendingTransferSource } from '../src/transfer/transferSendCoordinator.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'

function source(kind: 'text' | 'image' | 'file' = 'text') {
  return createBlobTransferChunkSource(new Blob(['hello']), kind, kind === 'image'
    ? {
        version: 1,
        provider: 'local-image',
        itemId: 'img_0123456789abcdef0123456789abcdef',
      }
    : {
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

function unavailableRoute(operation: PreparedSenderTransferOperation): TransferRouteSelection {
  return {
    ...selectedRoute(operation),
    status: 'unavailable',
    route: null,
  }
}

function captureRequest(roomId: string) {
  let captured: TransferControlRequest | null = null
  registerTransferControlSender(roomId, (_targetDeviceId, message) => {
    if (message.type === 'transfer-request') captured = message
    return true
  })

  return async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (captured) return captured
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    throw new Error('No se emitió transfer-request')
  }
}

function accept(roomId: string, request: TransferControlRequest) {
  publishTransferControl(roomId, {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: Date.now(),
  }, receiverDeviceId)
}

test('la frontera resuelve solo después de completar el handoff del data plane', async () => {
  const roomId = 'room_product_boundary_success'
  const readRequest = captureRequest(roomId)
  let markHandoffStarted!: () => void
  let finishHandoff!: () => void
  const handoffStarted = new Promise<void>((resolve) => {
    markHandoffStarted = resolve
  })
  const handoffFinished = new Promise<void>((resolve) => {
    finishHandoff = resolve
  })

  const boundary = createLocalTransferProductBoundary(roomId, {
    routeManager: {
      acceptPreparedSenderOperation(operation) {
        return selectedRoute(operation)
      },
    },
    async handoff() {
      markHandoffStarted()
      await handoffFinished
    },
    persist: async () => undefined,
  })

  const resultPromise = boundary.sendLocalSource(
    senderDeviceId,
    receiverDeviceId,
    source(),
  )
  const request = await readRequest()
  accept(roomId, request)
  await handoffStarted

  let resolved = false
  void resultPromise.then(() => {
    resolved = true
  })
  await Promise.resolve()
  assert.equal(resolved, false)

  finishHandoff()
  const result = await resultPromise
  assert.equal(result.requestId, request.requestId)
  assert.equal(result.selection.status, 'selected')
  assert.equal(result.selection.route, 'local-direct')
  assert.equal(result.transferId, result.selection.transferId)
  assert.match(result.transferId, /^txf_[a-f0-9]{32}$/)
  boundary.disconnect()
})

test('una selección unavailable rechaza la Promise del producto', async () => {
  const roomId = 'room_product_boundary_unavailable'
  const readRequest = captureRequest(roomId)
  const boundary = createLocalTransferProductBoundary(roomId, {
    routeManager: {
      acceptPreparedSenderOperation(operation) {
        return unavailableRoute(operation)
      },
    },
    persist: async () => undefined,
  })

  const resultPromise = boundary.sendLocalSource(
    senderDeviceId,
    receiverDeviceId,
    source(),
  )
  const request = await readRequest()
  accept(roomId, request)

  await assert.rejects(resultPromise, /ruta de datos seleccionada/)
  boundary.disconnect()
})

test('rechazo remoto termina la espera correlacionada y limpia la fuente pendiente', async () => {
  const roomId = 'room_product_boundary_rejected'
  const readRequest = captureRequest(roomId)
  const boundary = createLocalTransferProductBoundary(roomId, {
    routeManager: {
      acceptPreparedSenderOperation(operation) {
        return selectedRoute(operation)
      },
    },
    handoff: async () => undefined,
    persist: async () => undefined,
  })

  const resultPromise = boundary.sendLocalSource(
    senderDeviceId,
    receiverDeviceId,
    source(),
  )
  const request = await readRequest()
  assert.equal(hasPendingTransferSource(roomId, request.requestId), true)

  publishTransferControl(roomId, {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'rejected',
    decidedAt: Date.now(),
  }, receiverDeviceId)

  await assert.rejects(resultPromise, /rechazada/)
  assert.equal(hasPendingTransferSource(roomId, request.requestId), false)
  boundary.disconnect()
})

test('disconnect rechaza esperas pendientes y elimina sus fuentes técnicas', async () => {
  const roomId = 'room_product_boundary_disconnect'
  const readRequest = captureRequest(roomId)
  const boundary = createLocalTransferProductBoundary(roomId, {
    routeManager: {
      acceptPreparedSenderOperation(operation) {
        return selectedRoute(operation)
      },
    },
    handoff: async () => undefined,
    persist: async () => undefined,
  })

  const resultPromise = boundary.sendLocalSource(
    senderDeviceId,
    receiverDeviceId,
    source(),
  )
  const request = await readRequest()
  assert.equal(hasPendingTransferSource(roomId, request.requestId), true)

  boundary.disconnect()
  await assert.rejects(resultPromise, /desconectó/)
  assert.equal(hasPendingTransferSource(roomId, request.requestId), false)
})

test('la frontera no admite archivos antes de existir un adaptador probado', async () => {
  const roomId = 'room_product_boundary_file'
  let sent = false
  registerTransferControlSender(roomId, () => {
    sent = true
    return true
  })
  const boundary = createLocalTransferProductBoundary(roomId, {
    persist: async () => undefined,
  })

  await assert.rejects(
    boundary.sendLocalSource(senderDeviceId, receiverDeviceId, source('file')),
    /solo admite texto o imagen/,
  )
  assert.equal(sent, false)
  boundary.disconnect()
})
