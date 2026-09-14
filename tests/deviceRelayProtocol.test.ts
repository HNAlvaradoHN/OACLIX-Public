import assert from 'node:assert/strict'
import test from 'node:test'
import { parseDeviceRelayInput } from '../worker/realtime/deviceRelayProtocol.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const transfer = {
  version: 1 as const,
  type: 'local-clipboard-transfer' as const,
  transferId: 'xfr_0123456789abcdef01234567',
  senderDeviceId,
  receiverDeviceId,
  item: {
    id: 'itm_0123456789abcdef0123456789abcdef',
    text: 'Android dirigido',
    createdAt: 1_800_000_000_000,
    expiresAt: 1_800_021_600_000,
  },
}

test('el relay acepta solo una transferencia dirigida que coincide con emisor y destino', () => {
  const parsed = parseDeviceRelayInput({
    type: 'device-transfer',
    targetDeviceId: receiverDeviceId,
    transfer,
  }, senderDeviceId)

  assert.deepEqual(parsed, {
    type: 'device-transfer',
    targetDeviceId: receiverDeviceId,
    transfer,
  })
  assert.equal(parseDeviceRelayInput({
    type: 'device-transfer',
    targetDeviceId: senderDeviceId,
    transfer: { ...transfer, receiverDeviceId: senderDeviceId },
  }, senderDeviceId), null)
  assert.equal(parseDeviceRelayInput({
    type: 'device-transfer',
    targetDeviceId: receiverDeviceId,
    transfer: { ...transfer, senderDeviceId: 'dev_cccccccccccccccc' },
  }, senderDeviceId), null)
})

test('el ACK del relay debe invertir exactamente emisor y receptor sin cambiar item', () => {
  const ack = {
    version: 1 as const,
    type: 'local-clipboard-transfer-ack' as const,
    transferId: transfer.transferId,
    senderDeviceId,
    receiverDeviceId,
    itemId: transfer.item.id,
    status: 'stored' as const,
  }

  assert.deepEqual(parseDeviceRelayInput({
    type: 'device-transfer-ack',
    targetDeviceId: senderDeviceId,
    ack,
  }, receiverDeviceId), {
    type: 'device-transfer-ack',
    targetDeviceId: senderDeviceId,
    ack,
  })
  assert.equal(parseDeviceRelayInput({
    type: 'device-transfer-ack',
    targetDeviceId: senderDeviceId,
    ack: { ...ack, itemId: 'itm_bad' },
  }, receiverDeviceId), null)
})

test('el relay rechaza texto fuera de la política local y retención mayor a seis horas', () => {
  assert.equal(parseDeviceRelayInput({
    type: 'device-transfer',
    targetDeviceId: receiverDeviceId,
    transfer: { ...transfer, item: { ...transfer.item, text: ' '.repeat(4) } },
  }, senderDeviceId), null)
  assert.equal(parseDeviceRelayInput({
    type: 'device-transfer',
    targetDeviceId: receiverDeviceId,
    transfer: { ...transfer, item: { ...transfer.item, expiresAt: transfer.item.createdAt + 21_600_001 } },
  }, senderDeviceId), null)
})
