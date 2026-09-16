import assert from 'node:assert/strict'
import test from 'node:test'
import {
  observeReceivedTransferControlForRouteIntent,
  subscribeTransferRouteIntent,
  trackSentTransferControl,
} from '../src/realtime/transferRouteIntent.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const now = 1_800_000_000_000

function request(requestId: string) {
  return {
    version: 1 as const,
    type: 'transfer-request' as const,
    requestId,
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'image' as const,
    byteSize: 4096,
    createdAt: now,
    expiresAt: now + 60_000,
  }
}

test('accepted produce solo una intención de ruta y todavía no elige transporte', () => {
  const roomId = 'room-route-intent-accepted'
  const original = request('req_100000000000000000000001')
  const received: unknown[] = []
  const unsubscribe = subscribeTransferRouteIntent(roomId, (intent) => received.push(intent))

  assert.equal(trackSentTransferControl(roomId, receiverDeviceId, original), true)
  const intent = observeReceivedTransferControlForRouteIntent(roomId, receiverDeviceId, {
    version: 1,
    type: 'transfer-decision',
    requestId: original.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: now + 500,
  }, now + 1_000)

  assert.ok(intent)
  assert.equal(intent.type, 'route-intent')
  assert.equal(intent.requestId, original.requestId)
  assert.equal(intent.contentKind, 'image')
  assert.equal(intent.byteSize, 4096)
  assert.equal(Object.hasOwn(intent, 'transport'), false)
  assert.equal(Object.hasOwn(intent, 'payload'), false)
  assert.deepEqual(received, [intent])

  unsubscribe()
})

test('si el emisor perdió su solicitud local no se finge que la transferencia empezó', () => {
  const roomId = 'room-route-intent-sender-gone'
  const original = request('req_100000000000000000000002')

  const intent = observeReceivedTransferControlForRouteIntent(roomId, receiverDeviceId, {
    version: 1,
    type: 'transfer-decision',
    requestId: original.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: now + 500,
  }, now + 1_000)

  assert.equal(intent, null)
})

test('accepted vencido, rejected y busy cierran control sin crear intención de ruta', () => {
  const cases = [
    { decision: 'accepted' as const, observedAt: now + 61_000 },
    { decision: 'rejected' as const, observedAt: now + 1_000 },
    { decision: 'busy' as const, observedAt: now + 1_000 },
  ]

  for (const [index, scenario] of cases.entries()) {
    const roomId = `room-route-intent-terminal-${index}`
    const original = request(`req_10000000000000000000000${index + 3}`)
    assert.equal(trackSentTransferControl(roomId, receiverDeviceId, original), true)
    assert.equal(observeReceivedTransferControlForRouteIntent(roomId, receiverDeviceId, {
      version: 1,
      type: 'transfer-decision',
      requestId: original.requestId,
      senderDeviceId,
      receiverDeviceId,
      decision: scenario.decision,
      decidedAt: now + 500,
    }, scenario.observedAt), null)

    assert.equal(observeReceivedTransferControlForRouteIntent(roomId, receiverDeviceId, {
      version: 1,
      type: 'transfer-decision',
      requestId: original.requestId,
      senderDeviceId,
      receiverDeviceId,
      decision: 'accepted',
      decidedAt: now + 1_500,
    }, now + 2_000), null)
  }
})

test('una decisión de otro dispositivo no puede consumir la solicitud rastreada', () => {
  const roomId = 'room-route-intent-wrong-peer'
  const original = request('req_100000000000000000000006')
  const otherDeviceId = 'dev_cccccccccccccccc'
  assert.equal(trackSentTransferControl(roomId, receiverDeviceId, original), true)

  assert.equal(observeReceivedTransferControlForRouteIntent(roomId, otherDeviceId, {
    version: 1,
    type: 'transfer-decision',
    requestId: original.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: now + 500,
  }, now + 1_000), null)

  assert.ok(observeReceivedTransferControlForRouteIntent(roomId, receiverDeviceId, {
    version: 1,
    type: 'transfer-decision',
    requestId: original.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: now + 1_500,
  }, now + 2_000))
})
