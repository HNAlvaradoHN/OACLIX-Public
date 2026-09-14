import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLocalClipboardTransfer,
  createLocalClipboardTransferAck,
  validLocalClipboardTransfer,
  validLocalClipboardTransferAck,
} from '../src/realtime/localClipboardTransfer.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const item = {
  id: 'itm_0123456789abcdef0123456789abcdef',
  text: 'texto local',
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_021_600_000,
}

test('la transferencia local queda dirigida a un único dispositivo', () => {
  const transfer = createLocalClipboardTransfer(
    item,
    senderDeviceId,
    receiverDeviceId,
    'xfr_0123456789abcdef01234567',
  )

  assert.equal(transfer.senderDeviceId, senderDeviceId)
  assert.equal(transfer.receiverDeviceId, receiverDeviceId)
  assert.deepEqual(transfer.item, item)
  assert.equal(validLocalClipboardTransfer(transfer), true)
})

test('una transferencia local rechaza destino propio y retención fuera del límite', () => {
  assert.throws(() => createLocalClipboardTransfer(
    item,
    senderDeviceId,
    senderDeviceId,
    'xfr_0123456789abcdef01234567',
  ))

  assert.throws(() => createLocalClipboardTransfer(
    { ...item, expiresAt: item.createdAt + 21_600_001 },
    senderDeviceId,
    receiverDeviceId,
    'xfr_0123456789abcdef01234567',
  ))
})

test('el ACK conserva origen, destino e item de la transferencia', () => {
  const transfer = createLocalClipboardTransfer(
    item,
    senderDeviceId,
    receiverDeviceId,
    'xfr_0123456789abcdef01234567',
  )
  const ack = createLocalClipboardTransferAck(transfer, 'stored')

  assert.deepEqual(ack, {
    version: 1,
    type: 'local-clipboard-transfer-ack',
    transferId: transfer.transferId,
    senderDeviceId,
    receiverDeviceId,
    itemId: item.id,
    status: 'stored',
  })
  assert.equal(validLocalClipboardTransferAck(ack), true)
  assert.equal(validLocalClipboardTransferAck({ ...ack, receiverDeviceId: senderDeviceId }), false)
})
