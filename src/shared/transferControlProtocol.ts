export type TransferContentKind = 'text' | 'image' | 'file'
export type TransferDecision = 'accepted' | 'rejected' | 'busy'

export type TransferControlRequest = {
  version: 1
  type: 'transfer-request'
  requestId: string
  senderDeviceId: string
  receiverDeviceId: string
  contentKind: TransferContentKind
  byteSize: number
  createdAt: number
  expiresAt: number
}

export type TransferControlDecision = {
  version: 1
  type: 'transfer-decision'
  requestId: string
  senderDeviceId: string
  receiverDeviceId: string
  decision: TransferDecision
  decidedAt: number
}

export type TransferControlCancel = {
  version: 1
  type: 'transfer-cancel'
  requestId: string
  senderDeviceId: string
  receiverDeviceId: string
  cancelledByDeviceId: string
  cancelledAt: number
}

export type TransferControlMessage =
  | TransferControlRequest
  | TransferControlDecision
  | TransferControlCancel

export const TRANSFER_REQUEST_MAX_TTL_MS = 5 * 60_000
export const TRANSFER_CONTROL_MAX_SERIALIZED_LENGTH = 2_048

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const REQUEST_ID_PATTERN = /^req_[a-f0-9]{24}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  const allowed = [...expected].sort()
  return keys.length === allowed.length && keys.every((key, index) => key === allowed[index])
}

function validDeviceId(value: unknown) {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value)
}

function validRequestId(value: unknown) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

function validTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validByteSize(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function validRequest(value: Record<string, unknown>): value is TransferControlRequest {
  if (!hasOnlyKeys(value, [
    'version',
    'type',
    'requestId',
    'senderDeviceId',
    'receiverDeviceId',
    'contentKind',
    'byteSize',
    'createdAt',
    'expiresAt',
  ])) return false

  if (
    value.version !== 1
    || value.type !== 'transfer-request'
    || !validRequestId(value.requestId)
    || !validDeviceId(value.senderDeviceId)
    || !validDeviceId(value.receiverDeviceId)
    || value.senderDeviceId === value.receiverDeviceId
    || (value.contentKind !== 'text' && value.contentKind !== 'image' && value.contentKind !== 'file')
    || !validByteSize(value.byteSize)
    || !validTimestamp(value.createdAt)
    || !validTimestamp(value.expiresAt)
  ) return false

  const createdAt = Number(value.createdAt)
  const expiresAt = Number(value.expiresAt)
  return expiresAt > createdAt && expiresAt - createdAt <= TRANSFER_REQUEST_MAX_TTL_MS
}

function validDecision(value: Record<string, unknown>): value is TransferControlDecision {
  return hasOnlyKeys(value, [
    'version',
    'type',
    'requestId',
    'senderDeviceId',
    'receiverDeviceId',
    'decision',
    'decidedAt',
  ])
    && value.version === 1
    && value.type === 'transfer-decision'
    && validRequestId(value.requestId)
    && validDeviceId(value.senderDeviceId)
    && validDeviceId(value.receiverDeviceId)
    && value.senderDeviceId !== value.receiverDeviceId
    && (value.decision === 'accepted' || value.decision === 'rejected' || value.decision === 'busy')
    && validTimestamp(value.decidedAt)
}

function validCancel(value: Record<string, unknown>): value is TransferControlCancel {
  return hasOnlyKeys(value, [
    'version',
    'type',
    'requestId',
    'senderDeviceId',
    'receiverDeviceId',
    'cancelledByDeviceId',
    'cancelledAt',
  ])
    && value.version === 1
    && value.type === 'transfer-cancel'
    && validRequestId(value.requestId)
    && validDeviceId(value.senderDeviceId)
    && validDeviceId(value.receiverDeviceId)
    && value.senderDeviceId !== value.receiverDeviceId
    && validDeviceId(value.cancelledByDeviceId)
    && (value.cancelledByDeviceId === value.senderDeviceId || value.cancelledByDeviceId === value.receiverDeviceId)
    && validTimestamp(value.cancelledAt)
}

export function validTransferControlMessage(value: unknown): value is TransferControlMessage {
  if (!isRecord(value)) return false
  if (JSON.stringify(value).length > TRANSFER_CONTROL_MAX_SERIALIZED_LENGTH) return false
  if (value.type === 'transfer-request') return validRequest(value)
  if (value.type === 'transfer-decision') return validDecision(value)
  if (value.type === 'transfer-cancel') return validCancel(value)
  return false
}

export function validTransferControlForRoute(
  value: unknown,
  actorDeviceId: string,
  targetDeviceId: string,
): value is TransferControlMessage {
  if (!DEVICE_ID_PATTERN.test(actorDeviceId) || !DEVICE_ID_PATTERN.test(targetDeviceId)) return false
  if (actorDeviceId === targetDeviceId || !validTransferControlMessage(value)) return false

  if (value.type === 'transfer-request') {
    return value.senderDeviceId === actorDeviceId && value.receiverDeviceId === targetDeviceId
  }

  if (value.type === 'transfer-decision') {
    return value.receiverDeviceId === actorDeviceId && value.senderDeviceId === targetDeviceId
  }

  const pairMatches = (
    (value.senderDeviceId === actorDeviceId && value.receiverDeviceId === targetDeviceId)
    || (value.senderDeviceId === targetDeviceId && value.receiverDeviceId === actorDeviceId)
  )
  return pairMatches && value.cancelledByDeviceId === actorDeviceId
}
