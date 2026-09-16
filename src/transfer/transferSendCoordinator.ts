import {
  TRANSFER_REQUEST_MAX_TTL_MS,
  validTransferControlMessage,
  type TransferControlMessage,
  type TransferControlRequest,
} from '../shared/transferControlProtocol.ts'
import {
  sendTransferControl,
  subscribeTransferControl,
} from '../realtime/transferControlBus.ts'
import type { TransferRouteIntent } from '../realtime/transferRouteIntent.ts'
import {
  connectRouteIntentToTransferEngine,
  type PersistTransferOperation,
  type PreparedSenderTransferOperation,
  type TransferEngineRouteHandlers,
} from './transferOperationCoordinator.ts'
import {
  openTransferChunkSource,
  type TransferChunkSource,
} from './transferChunkSource.ts'
import type {
  PreparedTransferRouteManager,
  TransferRouteSelection,
} from './transferRouteManager.ts'

const MAX_PENDING_SOURCES_PER_ROOM = 32
const MAX_PENDING_SOURCES_PER_RECEIVER = 8
const pendingSourcesByRoom = new Map<string, Map<string, PendingTransferSource>>()

type PendingTransferSource = {
  request: TransferControlRequest
  source: TransferChunkSource
}

export type TransferRequestRegistrationObserver = (
  request: TransferControlRequest,
) => void

export type TransferSendCoordinatorHandlers = {
  onHandoff?(
    operation: PreparedSenderTransferOperation,
    selection: TransferRouteSelection,
  ): void | Promise<void>
  onUnavailable?(intent: TransferRouteIntent): void
  onError?(intent: TransferRouteIntent, error: unknown): void
}

function createRequestId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `req_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function roomSources(roomId: string) {
  let sources = pendingSourcesByRoom.get(roomId)
  if (!sources) {
    sources = new Map()
    pendingSourcesByRoom.set(roomId, sources)
  }
  return sources
}

function removePendingSource(roomId: string, requestId: string) {
  const sources = pendingSourcesByRoom.get(roomId)
  if (!sources?.delete(requestId)) return false
  if (sources.size === 0) pendingSourcesByRoom.delete(roomId)
  return true
}

function cleanupExpiredPendingSources(roomId: string, now = Date.now()) {
  const sources = pendingSourcesByRoom.get(roomId)
  if (!sources) return
  for (const [requestId, pending] of sources) {
    if (pending.request.expiresAt <= now) sources.delete(requestId)
  }
  if (sources.size === 0) pendingSourcesByRoom.delete(roomId)
}

function assertPendingCapacity(sources: Map<string, PendingTransferSource>, receiverDeviceId: string) {
  if (sources.size >= MAX_PENDING_SOURCES_PER_ROOM) {
    throw new Error('Demasiadas transferencias pendientes en esta sala')
  }
  let receiverCount = 0
  for (const pending of sources.values()) {
    if (pending.request.receiverDeviceId === receiverDeviceId) receiverCount += 1
  }
  if (receiverCount >= MAX_PENDING_SOURCES_PER_RECEIVER) {
    throw new Error('Demasiadas transferencias pendientes para ese dispositivo')
  }
}

function pendingSourceMatchesIntent(pending: PendingTransferSource, intent: TransferRouteIntent) {
  const request = pending.request
  return request.requestId === intent.requestId
    && request.senderDeviceId === intent.senderDeviceId
    && request.receiverDeviceId === intent.receiverDeviceId
    && request.contentKind === intent.contentKind
    && request.byteSize === intent.byteSize
    && request.createdAt === intent.requestCreatedAt
    && request.expiresAt === intent.requestExpiresAt
}

function consumePendingSource(roomId: string, intent: TransferRouteIntent) {
  cleanupExpiredPendingSources(roomId, intent.acceptedAt)
  const pending = pendingSourcesByRoom.get(roomId)?.get(intent.requestId)
  if (!pending || !pendingSourceMatchesIntent(pending, intent)) return null
  removePendingSource(roomId, intent.requestId)
  return pending.source
}

function cleanupResolvedControl(
  roomId: string,
  message: TransferControlMessage,
  remoteDeviceId: string,
) {
  const pending = pendingSourcesByRoom.get(roomId)?.get(message.requestId)
  if (!pending) return

  if (message.type === 'transfer-decision') {
    if (
      remoteDeviceId === pending.request.receiverDeviceId
      && message.senderDeviceId === pending.request.senderDeviceId
      && message.receiverDeviceId === pending.request.receiverDeviceId
    ) removePendingSource(roomId, message.requestId)
    return
  }

  if (
    message.type === 'transfer-cancel'
    && message.senderDeviceId === pending.request.senderDeviceId
    && message.receiverDeviceId === pending.request.receiverDeviceId
    && message.cancelledByDeviceId === remoteDeviceId
  ) removePendingSource(roomId, message.requestId)
}

export function hasPendingTransferSource(roomId: string, requestId: string, now = Date.now()) {
  cleanupExpiredPendingSources(roomId, now)
  return pendingSourcesByRoom.get(roomId)?.has(requestId) ?? false
}

export function discardPendingTransferSource(roomId: string, requestId: string) {
  return removePendingSource(roomId, requestId)
}

export function clearPendingTransferSources(roomId: string) {
  return pendingSourcesByRoom.delete(roomId)
}

export async function sendTransferRequestForSource(
  roomId: string,
  senderDeviceId: string,
  receiverDeviceId: string,
  source: TransferChunkSource,
  now = Date.now(),
  onRegistered?: TransferRequestRegistrationObserver,
) {
  const blob = await openTransferChunkSource(source)
  const request: TransferControlRequest = {
    version: 1,
    type: 'transfer-request',
    requestId: createRequestId(),
    senderDeviceId,
    receiverDeviceId,
    contentKind: source.contentKind,
    byteSize: blob.size,
    createdAt: now,
    expiresAt: now + TRANSFER_REQUEST_MAX_TTL_MS,
  }
  if (!validTransferControlMessage(request)) throw new Error('Solicitud de transferencia inválida')

  cleanupExpiredPendingSources(roomId, now)
  const sources = roomSources(roomId)
  assertPendingCapacity(sources, receiverDeviceId)
  if (sources.has(request.requestId)) throw new Error('Colisión de solicitud de transferencia')

  sources.set(request.requestId, { request, source })
  try {
    onRegistered?.({ ...request })
  } catch (error) {
    removePendingSource(roomId, request.requestId)
    throw error
  }

  if (!sendTransferControl(roomId, receiverDeviceId, request)) {
    removePendingSource(roomId, request.requestId)
    throw new Error('No se pudo enviar la solicitud de transferencia')
  }
  return request
}

export function connectTransferSendCoordinator(
  roomId: string,
  routeManager: PreparedTransferRouteManager,
  handlers: TransferSendCoordinatorHandlers = {},
  persist?: PersistTransferOperation,
) {
  const routeHandlers: TransferEngineRouteHandlers = {
    onPrepared(operation) {
      void Promise.resolve(routeManager.acceptPreparedSenderOperation(operation))
        .then(async (selection) => {
          await handlers.onHandoff?.(operation, selection)
        })
        .catch((error) => handlers.onError?.(operation.intent, error))
    },
    onUnavailable: handlers.onUnavailable,
    onError: handlers.onError,
  }
  const disconnectEngine = connectRouteIntentToTransferEngine(
    roomId,
    (intent) => consumePendingSource(roomId, intent),
    routeHandlers,
    persist,
  )
  const disconnectControl = subscribeTransferControl(roomId, (message, remoteDeviceId) => {
    cleanupResolvedControl(roomId, message, remoteDeviceId)
  })

  return () => {
    disconnectEngine()
    disconnectControl()
  }
}
