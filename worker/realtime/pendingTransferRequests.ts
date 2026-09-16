import {
  transferControlRequestIsLive,
  validTransferControlMessage,
  type TransferControlRequest,
} from '../../src/shared/transferControlProtocol.ts'

export type PendingTransferRequestRecord = {
  personId: string
  fromDeviceId: string
  message: TransferControlRequest
}

export const PENDING_TRANSFER_STORAGE_KEY = 'transfer-control:pending:v1'
export const MAX_PENDING_TRANSFER_REQUESTS_PER_ROOM = 32
export const MAX_PENDING_TRANSFER_REQUESTS_PER_DEVICE = 8

const PERSON_ID_PATTERN = /^per_[A-Za-z0-9_-]{16,64}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/

function isPendingRecord(value: unknown): value is PendingTransferRequestRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<PendingTransferRequestRecord>
  return typeof record.personId === 'string'
    && PERSON_ID_PATTERN.test(record.personId)
    && typeof record.fromDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(record.fromDeviceId)
    && validTransferControlMessage(record.message)
    && record.message.type === 'transfer-request'
    && record.message.senderDeviceId === record.fromDeviceId
}

export function normalizePendingTransferRequests(value: unknown, now: number) {
  if (!Array.isArray(value)) return [] as PendingTransferRequestRecord[]
  return value
    .filter(isPendingRecord)
    .filter((record) => transferControlRequestIsLive(record.message, now))
    .slice(0, MAX_PENDING_TRANSFER_REQUESTS_PER_ROOM)
}

export function queuePendingTransferRequest(
  current: PendingTransferRequestRecord[],
  record: PendingTransferRequestRecord,
  now: number,
) {
  const pending = normalizePendingTransferRequests(current, now)
  if (!isPendingRecord(record) || !transferControlRequestIsLive(record.message, now)) {
    return { accepted: false, pending }
  }

  const existing = pending.find((candidate) => candidate.message.requestId === record.message.requestId)
  if (existing) {
    const sameRequest = existing.personId === record.personId
      && existing.fromDeviceId === record.fromDeviceId
      && existing.message.receiverDeviceId === record.message.receiverDeviceId
    return { accepted: sameRequest, pending }
  }

  const forReceiver = pending.filter((candidate) => (
    candidate.personId === record.personId
    && candidate.message.receiverDeviceId === record.message.receiverDeviceId
  )).length

  if (
    pending.length >= MAX_PENDING_TRANSFER_REQUESTS_PER_ROOM
    || forReceiver >= MAX_PENDING_TRANSFER_REQUESTS_PER_DEVICE
  ) {
    return { accepted: false, pending }
  }

  return { accepted: true, pending: [...pending, record] }
}

export function removePendingTransferRequest(
  current: PendingTransferRequestRecord[],
  personId: string,
  requestId: string,
  senderDeviceId: string,
  receiverDeviceId: string,
  now: number,
) {
  return normalizePendingTransferRequests(current, now).filter((record) => !(
    record.personId === personId
    && record.message.requestId === requestId
    && record.message.senderDeviceId === senderDeviceId
    && record.message.receiverDeviceId === receiverDeviceId
  ))
}

export function pendingTransferRequestsForDevice(
  current: PendingTransferRequestRecord[],
  personId: string,
  deviceId: string,
  now: number,
) {
  return normalizePendingTransferRequests(current, now).filter((record) => (
    record.personId === personId
    && record.message.receiverDeviceId === deviceId
  ))
}

export function removePendingTransferRequestsForDevice(
  current: PendingTransferRequestRecord[],
  deviceId: string,
  now: number,
) {
  return normalizePendingTransferRequests(current, now).filter((record) => (
    record.message.senderDeviceId !== deviceId
    && record.message.receiverDeviceId !== deviceId
  ))
}

export function nextPendingTransferExpiry(current: PendingTransferRequestRecord[], now: number) {
  const pending = normalizePendingTransferRequests(current, now)
  if (pending.length === 0) return null
  return Math.min(...pending.map((record) => record.message.expiresAt))
}
