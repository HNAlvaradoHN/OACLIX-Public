import { subscribeTransferControl } from '../realtime/transferControlBus.ts'
import type { TransferRouteIntent } from '../realtime/transferRouteIntent.ts'
import type { TransferControlRequest } from '../shared/transferControlProtocol.ts'
import type { TransferChunkSource } from './transferChunkSource.ts'
import { createTransferDataPlaneHandoff } from './transferDataPlaneDispatcher.ts'
import type {
  PersistTransferOperation,
  PreparedSenderTransferOperation,
} from './transferOperationCoordinator.ts'
import {
  createPreparedTransferRouteManager,
  type PreparedTransferRouteManager,
  type TransferRouteSelection,
} from './transferRouteManager.ts'
import {
  clearPendingTransferSources,
  connectTransferSendCoordinator,
  discardPendingTransferSource,
  sendTransferRequestForSource,
} from './transferSendCoordinator.ts'

type ProductDataPlaneHandoff = (
  operation: PreparedSenderTransferOperation,
  selection: TransferRouteSelection,
) => void | Promise<void>

export type LocalTransferProductBoundaryOptions = {
  routeManager?: PreparedTransferRouteManager
  handoff?: ProductDataPlaneHandoff
  persist?: PersistTransferOperation
  now?: () => number
}

export type LocalTransferProductSendResult = {
  requestId: string
  transferId: string
  selection: TransferRouteSelection
}

type PendingProductSend = {
  request: TransferControlRequest
  resolve(result: LocalTransferProductSendResult): void
  reject(error: unknown): void
  expiryTimer: ReturnType<typeof setTimeout> | null
}

function requestMatchesIntent(request: TransferControlRequest, intent: TransferRouteIntent) {
  return request.requestId === intent.requestId
    && request.senderDeviceId === intent.senderDeviceId
    && request.receiverDeviceId === intent.receiverDeviceId
    && request.contentKind === intent.contentKind
    && request.byteSize === intent.byteSize
    && request.createdAt === intent.requestCreatedAt
    && request.expiresAt === intent.requestExpiresAt
}

function requestMatchesOperation(
  request: TransferControlRequest,
  operation: PreparedSenderTransferOperation,
) {
  return requestMatchesIntent(request, operation.intent)
    && operation.manifest.requestId === request.requestId
    && operation.manifest.senderDeviceId === request.senderDeviceId
    && operation.manifest.receiverDeviceId === request.receiverDeviceId
    && operation.manifest.contentKind === request.contentKind
    && operation.manifest.byteSize === request.byteSize
}

function normalizedError(error: unknown, fallback: string) {
  return error instanceof Error ? error : new Error(fallback)
}

export function createLocalTransferProductBoundary(
  roomId: string,
  options: LocalTransferProductBoundaryOptions = {},
) {
  if (typeof roomId !== 'string' || roomId.length === 0) throw new Error('Sala inválida')

  const now = options.now ?? Date.now
  const routeManager = options.routeManager ?? createPreparedTransferRouteManager(roomId)
  const handoff = options.handoff ?? createTransferDataPlaneHandoff(roomId)
  const pendingByRequest = new Map<string, PendingProductSend>()
  let disconnected = false

  function clearExpiry(pending: PendingProductSend) {
    if (pending.expiryTimer === null) return
    clearTimeout(pending.expiryTimer)
    pending.expiryTimer = null
  }

  function rejectPending(requestId: string, error: unknown) {
    const pending = pendingByRequest.get(requestId)
    if (!pending) return false
    pendingByRequest.delete(requestId)
    clearExpiry(pending)
    pending.reject(error)
    return true
  }

  function resolvePending(
    requestId: string,
    operation: PreparedSenderTransferOperation,
    selection: TransferRouteSelection,
  ) {
    const pending = pendingByRequest.get(requestId)
    if (!pending) return false
    pendingByRequest.delete(requestId)
    clearExpiry(pending)
    pending.resolve({
      requestId,
      transferId: operation.manifest.transferId,
      selection,
    })
    return true
  }

  const disconnectCoordinator = connectTransferSendCoordinator(
    roomId,
    routeManager,
    {
      async onHandoff(operation, selection) {
        const pending = pendingByRequest.get(operation.intent.requestId)
        if (!pending) return
        if (!requestMatchesOperation(pending.request, operation)) {
          const error = new Error('La operación preparada no coincide con la solicitud del producto')
          rejectPending(operation.intent.requestId, error)
          throw error
        }

        await handoff(operation, selection)
        resolvePending(operation.intent.requestId, operation, selection)
      },
      onUnavailable(intent) {
        rejectPending(intent.requestId, new Error('La fuente local ya no está disponible'))
      },
      onError(intent, error) {
        rejectPending(intent.requestId, normalizedError(error, 'Falló la transferencia local'))
      },
    },
    options.persist,
  )

  const disconnectControl = subscribeTransferControl(roomId, (message, remoteDeviceId) => {
    const pending = pendingByRequest.get(message.requestId)
    if (!pending) return
    const request = pending.request
    if (
      remoteDeviceId !== request.receiverDeviceId
      || message.senderDeviceId !== request.senderDeviceId
      || message.receiverDeviceId !== request.receiverDeviceId
    ) return

    if (message.type === 'transfer-decision') {
      if (message.decision === 'accepted') {
        if (request.expiresAt <= now()) {
          discardPendingTransferSource(roomId, request.requestId)
          rejectPending(request.requestId, new Error('La solicitud de transferencia venció'))
          return
        }
        clearExpiry(pending)
        return
      }

      rejectPending(
        request.requestId,
        new Error(message.decision === 'busy'
          ? 'El dispositivo receptor está ocupado'
          : 'La transferencia fue rechazada'),
      )
      return
    }

    if (
      message.type === 'transfer-cancel'
      && message.cancelledByDeviceId === remoteDeviceId
    ) {
      rejectPending(request.requestId, new Error('La transferencia fue cancelada'))
    }
  })

  function sendLocalSource(
    senderDeviceId: string,
    receiverDeviceId: string,
    source: TransferChunkSource,
  ): Promise<LocalTransferProductSendResult> {
    if (disconnected) return Promise.reject(new Error('La frontera de transferencia está desconectada'))
    if (source.contentKind !== 'text' && source.contentKind !== 'image') {
      return Promise.reject(new Error('La frontera local solo admite texto o imagen'))
    }

    let registeredRequestId: string | null = null
    let resolvePromise!: (result: LocalTransferProductSendResult) => void
    let rejectPromise!: (error: unknown) => void
    const result = new Promise<LocalTransferProductSendResult>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    void sendTransferRequestForSource(
      roomId,
      senderDeviceId,
      receiverDeviceId,
      source,
      now(),
      (request) => {
        if (disconnected) throw new Error('La frontera de transferencia está desconectada')
        if (pendingByRequest.has(request.requestId)) {
          throw new Error('Solicitud de producto duplicada')
        }

        registeredRequestId = request.requestId
        const pending: PendingProductSend = {
          request,
          resolve: resolvePromise,
          reject: rejectPromise,
          expiryTimer: null,
        }
        const delay = Math.max(0, request.expiresAt - now())
        pending.expiryTimer = setTimeout(() => {
          discardPendingTransferSource(roomId, request.requestId)
          rejectPending(request.requestId, new Error('La solicitud de transferencia venció'))
        }, delay)
        pendingByRequest.set(request.requestId, pending)
      },
    ).catch((error) => {
      if (registeredRequestId) {
        rejectPending(registeredRequestId, error)
      } else {
        rejectPromise(error)
      }
    })

    return result
  }

  function disconnect() {
    if (disconnected) return
    disconnected = true
    disconnectCoordinator()
    disconnectControl()
    clearPendingTransferSources(roomId)
    for (const requestId of Array.from(pendingByRequest.keys())) {
      rejectPending(requestId, new Error('La frontera de transferencia se desconectó'))
    }
  }

  return {
    sendLocalSource,
    disconnect,
  }
}
