import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_PENDING_TRANSFER_REQUESTS_PER_DEVICE,
  nextPendingTransferExpiry,
  normalizePendingTransferRequests,
  pendingTransferRequestsForDevice,
  queuePendingTransferRequest,
  removePendingTransferRequest,
  removePendingTransferRequestsForDevice,
  type PendingTransferRequestRecord,
} from '../worker/realtime/pendingTransferRequests.ts'

const now = 1_800_000_000_000
const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const personId = 'per_aaaaaaaaaaaaaaaa'

function pendingRecord(index = 0): PendingTransferRequestRecord {
  const suffix = index.toString(16).padStart(24, '0')
  return {
    personId,
    fromDeviceId: senderDeviceId,
    message: {
      version: 1,
      type: 'transfer-request',
      requestId: `req_${suffix}`,
      senderDeviceId,
      receiverDeviceId,
      contentKind: 'image',
      byteSize: 1024 + index,
      createdAt: now,
      expiresAt: now + 60_000 + index,
    },
  }
}

test('la cola conserva solo solicitudes válidas y no expiradas', () => {
  const live = pendingRecord(1)
  const expired = { ...pendingRecord(2), message: { ...pendingRecord(2).message, expiresAt: now } }
  const wrongSender = { ...pendingRecord(3), fromDeviceId: 'dev_cccccccccccccccc' }

  assert.deepEqual(normalizePendingTransferRequests([live, expired, wrongSender], now), [live])
})

test('la cola es idempotente por requestId y no permite reemplazar identidad', () => {
  const first = pendingRecord(1)
  const queued = queuePendingTransferRequest([], first, now)
  assert.equal(queued.accepted, true)

  const duplicate = queuePendingTransferRequest(queued.pending, first, now)
  assert.equal(duplicate.accepted, true)
  assert.equal(duplicate.pending.length, 1)

  const collision = queuePendingTransferRequest(duplicate.pending, {
    ...first,
    personId: 'per_bbbbbbbbbbbbbbbb',
  }, now)
  assert.equal(collision.accepted, false)
  assert.equal(collision.pending.length, 1)
})

test('un receptor no puede acumular más de la cuota corta definida', () => {
  let pending: PendingTransferRequestRecord[] = []
  for (let index = 0; index < MAX_PENDING_TRANSFER_REQUESTS_PER_DEVICE; index += 1) {
    const result = queuePendingTransferRequest(pending, pendingRecord(index), now)
    assert.equal(result.accepted, true)
    pending = result.pending
  }

  const overflow = queuePendingTransferRequest(pending, pendingRecord(MAX_PENDING_TRANSFER_REQUESTS_PER_DEVICE), now)
  assert.equal(overflow.accepted, false)
  assert.equal(overflow.pending.length, MAX_PENDING_TRANSFER_REQUESTS_PER_DEVICE)
})

test('entrega, resolución, unlink y alarma operan solo sobre metadatos pendientes', () => {
  const first = pendingRecord(1)
  const second = pendingRecord(2)
  const pending = [first, second]

  assert.deepEqual(pendingTransferRequestsForDevice(pending, personId, receiverDeviceId, now), pending)
  assert.equal(nextPendingTransferExpiry(pending, now), first.message.expiresAt)

  const resolved = removePendingTransferRequest(
    pending,
    first.message.requestId,
    senderDeviceId,
    receiverDeviceId,
    now,
  )
  assert.deepEqual(resolved, [second])

  assert.deepEqual(removePendingTransferRequestsForDevice(pending, receiverDeviceId, now), [])
})
