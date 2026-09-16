import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearRealtimeOnlineState,
  getDeviceAvailabilityState,
  legacyRouteStatusFromAvailability,
  publishDataChannelDeviceIds,
  publishKnownLinkedDeviceIds,
  publishRealtimeOnlineDeviceIds,
} from '../src/realtime/deviceAvailability.ts'
import {
  publishTransferControl,
  registerTransferControlSender,
  sendTransferControl,
} from '../src/realtime/transferControlBus.ts'

const localDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const remoteDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const now = 1_800_000_000_000

function request(requestId: string, senderDeviceId = localDeviceId, receiverDeviceId = remoteDeviceId) {
  return {
    version: 1 as const,
    type: 'transfer-request' as const,
    requestId,
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'image' as const,
    byteSize: 2048,
    createdAt: now,
    expiresAt: now + 60_000,
  }
}

test('vinculado, presencia y canal de datos son estados independientes', () => {
  const roomId = 'room-availability-independent'

  publishKnownLinkedDeviceIds(roomId, [localDeviceId, remoteDeviceId])
  let state = getDeviceAvailabilityState(roomId, remoteDeviceId, now)
  assert.deepEqual(state, {
    linked: true,
    presence: 'unknown',
    dataChannel: 'unavailable',
    pendingTransfer: 'none',
    pendingRequestCount: 0,
  })
  assert.equal(legacyRouteStatusFromAvailability(state), 'checking')

  publishRealtimeOnlineDeviceIds(roomId, [localDeviceId, remoteDeviceId])
  state = getDeviceAvailabilityState(roomId, remoteDeviceId, now)
  assert.equal(state.linked, true)
  assert.equal(state.presence, 'online')
  assert.equal(state.dataChannel, 'unavailable')
  assert.equal(legacyRouteStatusFromAvailability(state), 'cloud')

  publishDataChannelDeviceIds(roomId, [remoteDeviceId])
  state = getDeviceAvailabilityState(roomId, remoteDeviceId, now)
  assert.equal(state.presence, 'online')
  assert.equal(state.dataChannel, 'available')
  assert.equal(legacyRouteStatusFromAvailability(state), 'direct')

  clearRealtimeOnlineState(roomId)
  state = getDeviceAvailabilityState(roomId, remoteDeviceId, now)
  assert.equal(state.linked, true)
  assert.equal(state.presence, 'unknown')
  assert.equal(state.dataChannel, 'available')
  assert.equal(legacyRouteStatusFromAvailability(state), 'direct')
})

test('presencia conocida offline no borra el vínculo conocido', () => {
  const roomId = 'room-availability-offline'
  publishKnownLinkedDeviceIds(roomId, [localDeviceId, remoteDeviceId])
  publishRealtimeOnlineDeviceIds(roomId, [localDeviceId])

  const state = getDeviceAvailabilityState(roomId, remoteDeviceId, now)
  assert.equal(state.linked, true)
  assert.equal(state.presence, 'offline')
  assert.equal(state.dataChannel, 'unavailable')
  assert.equal(legacyRouteStatusFromAvailability(state), 'offline')
})

test('solicitud pendiente se registra solo cuando el control realmente sale', () => {
  const roomId = 'room-availability-outgoing'
  const message = request('req_000000000000000000000001')

  registerTransferControlSender(roomId, () => false)
  assert.equal(sendTransferControl(roomId, remoteDeviceId, message), false)
  assert.equal(getDeviceAvailabilityState(roomId, remoteDeviceId, now).pendingTransfer, 'none')

  registerTransferControlSender(roomId, () => true)
  assert.equal(sendTransferControl(roomId, remoteDeviceId, message), true)
  let state = getDeviceAvailabilityState(roomId, remoteDeviceId, now)
  assert.equal(state.pendingTransfer, 'pending')
  assert.equal(state.pendingRequestCount, 1)

  publishTransferControl(roomId, {
    version: 1,
    type: 'transfer-decision',
    requestId: message.requestId,
    senderDeviceId: localDeviceId,
    receiverDeviceId: remoteDeviceId,
    decision: 'accepted',
    decidedAt: now + 1_000,
  }, remoteDeviceId)
  state = getDeviceAvailabilityState(roomId, remoteDeviceId, now + 1_000)
  assert.equal(state.pendingTransfer, 'none')
  assert.equal(state.pendingRequestCount, 0)
})

test('solicitud recibida también es pendiente y expira localmente sin convertirse en disponibilidad de canal', () => {
  const roomId = 'room-availability-incoming'
  const incoming = request(
    'req_000000000000000000000002',
    remoteDeviceId,
    localDeviceId,
  )

  publishTransferControl(roomId, incoming, remoteDeviceId)
  let state = getDeviceAvailabilityState(roomId, remoteDeviceId, now)
  assert.equal(state.pendingTransfer, 'pending')
  assert.equal(state.dataChannel, 'unavailable')

  state = getDeviceAvailabilityState(roomId, remoteDeviceId, incoming.expiresAt + 1)
  assert.equal(state.pendingTransfer, 'none')
  assert.equal(state.dataChannel, 'unavailable')
})
