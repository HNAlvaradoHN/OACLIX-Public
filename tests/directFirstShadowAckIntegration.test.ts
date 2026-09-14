import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  publishLanDirectFirstPrepAck,
  subscribeLanDirectFirstPrepAcks,
} from '../src/realtime/lanDirectFirstPrep.ts'

const roomId = 'room_general_1234'
const remote = 'dev_qrstuvwxyzabcdef'
const local = 'dev_abcdefghijklmnop'
const ack = {
  version: 1 as const,
  type: 'ack' as const,
  changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
  authorDeviceId: local,
  authorSequence: 1,
}

test('bus de ACK conserva identidad del peer que confirmó', () => {
  const observed: Array<[string, typeof ack]> = []
  const unsubscribe = subscribeLanDirectFirstPrepAcks(roomId, (remoteDeviceId, value) => {
    observed.push([remoteDeviceId, value])
  })

  publishLanDirectFirstPrepAck(roomId, remote, ack)
  unsubscribe()
  publishLanDirectFirstPrepAck(roomId, 'dev_otherabcdefghijk', ack)

  assert.deepEqual(observed, [[remote, ack]])
})

test('manager y transporte conectan ACK durable receptor → DataChannel → emisor', () => {
  const managerSource = readFileSync(new URL('../src/realtime/lanPeerManager.ts', import.meta.url), 'utf8')
  const transportSource = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')

  assert.match(managerSource, /type: 'direct-first-ack'/)
  assert.match(managerSource, /sendDirectFirstPrepAck\(remoteDeviceId: string, ack: LanDirectFirstPrepAck\)/)
  assert.match(managerSource, /message\.ack\.authorDeviceId !== this\.ownDeviceId/)
  assert.match(managerSource, /publishLanDirectFirstPrepAck\(this\.roomId, remoteDeviceId, message\.ack\)/)
  assert.match(managerSource, /publishLanClipboardChange\(this\.roomId, message\.change, remoteDeviceId\)/)

  assert.match(transportSource, /subscribeLanDirectFirstPrepAcks\(roomId/)
  assert.match(transportSource, /directFirstShadowOutbound\.acknowledge/)
  assert.match(transportSource, /for \(const ack of result\.acks\) manager\.sendDirectFirstPrepAck\(remoteDeviceId, ack\)/)
})

test('upsert/delete direct-only usan checkpoint + DataChannel y cloud queda como fallback', () => {
  const transportSource = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')
  const outboundSource = readFileSync(new URL('../src/transport/directFirstShadowOutbound.ts', import.meta.url), 'utf8')
  const inboundSource = readFileSync(new URL('../src/transport/directFirstShadowInbound.ts', import.meta.url), 'utf8')

  assert.match(transportSource, /resolveAllDirectCoverage/)
  assert.match(transportSource, /directOnly: true/)
  assert.match(transportSource, /directFirstShadowOutbound\.prepareUpsert/)
  assert.match(transportSource, /directFirstShadowOutbound\.prepareDelete/)
  assert.match(transportSource, /cloudClipboardBoundary\.createText\(roomId, text\)/)
  assert.match(transportSource, /cloudClipboardBoundary\.deleteText\(roomId, itemId\)/)
  assert.match(transportSource, /directFirstShadowInbound\.receiveDelete/)
  assert.match(outboundSource, /operation: 'delete'/)
  assert.match(outboundSource, /directOnly: true as const/)
  assert.match(inboundSource, /metadata\.authorDeviceId !== remoteDeviceId/)
  assert.match(inboundSource, /change\.directOnly/)
})
