import type {
  TransferControlMessage,
  TransferControlRequest,
  TransferContentKind,
} from '../shared/transferControlProtocol.ts'

export type TransferRouteIntent = {
  version: 1
  type: 'route-intent'
  requestId: string
  senderDeviceId: string
  receiverDeviceId: string
  contentKind: TransferContentKind
  byteSize: number
  requestCreatedAt: number
  requestExpiresAt: number
  decisionAt: number
  acceptedAt: number
}

type TransferRouteIntentListener = (intent: TransferRouteIntent) => void

const outgoingRequestsByRoom = new Map<string, Map<string, TransferControlRequest>>()
const listenersByRoom = new Map<string, Set<TransferRouteIntentListener>>()

function sameRequest(left: TransferControlRequest, right: TransferControlRequest) {
  return left.requestId === right.requestId
    && left.senderDeviceId === right.senderDeviceId
    && left.receiverDeviceId === right.receiverDeviceId
    && left.contentKind === right.contentKind
    && left.byteSize === right.byteSize
    && left.createdAt === right.createdAt
    && left.expiresAt === right.expiresAt
}

function roomRequests(roomId: string) {
  let room = outgoingRequestsByRoom.get(roomId)
  if (!room) {
    room = new Map()
    outgoingRequestsByRoom.set(roomId, room)
  }
  return room
}

function removeTrackedRequest(roomId: string, requestId: string) {
  const room = outgoingRequestsByRoom.get(roomId)
  if (!room?.delete(requestId)) return false
  if (room.size === 0) outgoingRequestsByRoom.delete(roomId)
  return true
}

export function trackSentTransferControl(
  roomId: string,
  targetDeviceId: string,
  message: TransferControlMessage,
) {
  if (message.type === 'transfer-request') {
    if (message.receiverDeviceId !== targetDeviceId) return false
    const room = roomRequests(roomId)
    const current = room.get(message.requestId)
    if (current && !sameRequest(current, message)) return false
    room.set(message.requestId, message)
    return true
  }

  if (message.type === 'transfer-cancel') {
    const current = outgoingRequestsByRoom.get(roomId)?.get(message.requestId)
    if (!current) return false
    if (
      current.senderDeviceId !== message.senderDeviceId
      || current.receiverDeviceId !== message.receiverDeviceId
    ) return false
    return removeTrackedRequest(roomId, message.requestId)
  }

  return false
}

export function listRetryableTrackedTransferRequests(
  roomId: string,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(now) || now <= 0) return []
  const room = outgoingRequestsByRoom.get(roomId)
  if (!room) return []

  const retryable: TransferControlRequest[] = []
  for (const [requestId, request] of room) {
    if (request.expiresAt <= now) {
      room.delete(requestId)
      continue
    }
    retryable.push({ ...request })
  }
  if (room.size === 0) outgoingRequestsByRoom.delete(roomId)
  return retryable
}

export function observeReceivedTransferControlForRouteIntent(
  roomId: string,
  remoteDeviceId: string,
  message: TransferControlMessage,
  now = Date.now(),
): TransferRouteIntent | null {
  const request = outgoingRequestsByRoom.get(roomId)?.get(message.requestId)
  if (!request) return null

  if (message.type === 'transfer-cancel') {
    if (
      message.senderDeviceId === request.senderDeviceId
      && message.receiverDeviceId === request.receiverDeviceId
      && remoteDeviceId === request.receiverDeviceId
    ) removeTrackedRequest(roomId, message.requestId)
    return null
  }

  if (message.type !== 'transfer-decision') return null
  if (
    remoteDeviceId !== request.receiverDeviceId
    || message.senderDeviceId !== request.senderDeviceId
    || message.receiverDeviceId !== request.receiverDeviceId
  ) return null

  removeTrackedRequest(roomId, message.requestId)
  if (
    message.decision !== 'accepted'
    || !Number.isSafeInteger(now)
    || now <= 0
    || request.expiresAt <= now
  ) return null

  const intent: TransferRouteIntent = {
    version: 1,
    type: 'route-intent',
    requestId: request.requestId,
    senderDeviceId: request.senderDeviceId,
    receiverDeviceId: request.receiverDeviceId,
    contentKind: request.contentKind,
    byteSize: request.byteSize,
    requestCreatedAt: request.createdAt,
    requestExpiresAt: request.expiresAt,
    decisionAt: message.decidedAt,
    acceptedAt: now,
  }

  for (const listener of listenersByRoom.get(roomId) ?? []) listener(intent)
  return intent
}

export function subscribeTransferRouteIntent(
  roomId: string,
  listener: TransferRouteIntentListener,
) {
  let listeners = listenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    listenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) listenersByRoom.delete(roomId)
  }
}
