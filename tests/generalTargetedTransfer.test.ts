import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createGeneralTargetedTransfer,
  createGeneralTargetedTransferAck,
  validGeneralTargetedTransfer,
  validGeneralTargetedTransferAck,
} from '../src/realtime/generalTargetedTransfer.ts'

const now = 1_700_000_000_000
const item = {
  id: 'itm_0123456789abcdef0123456789abcdef',
  text: 'hola',
  createdAt: now,
  expiresAt: now + 21_600_000,
}
const personId = 'per_abcdefghijklmnop'
const senderDeviceId = 'dev_abcdefghijklmnop'
const receiverDeviceId = 'dev_qrstuvwxyzabcdef'
const transferId = 'gtr_0123456789abcdef01234567'

test('General targeted relay binds one person, sender, receiver and item', () => {
  const transfer = createGeneralTargetedTransfer(
    item,
    personId,
    senderDeviceId,
    receiverDeviceId,
    transferId,
  )

  assert.equal(validGeneralTargetedTransfer(transfer), true)
  assert.equal(transfer.senderPersonId, personId)
  assert.equal(transfer.senderDeviceId, senderDeviceId)
  assert.equal(transfer.receiverDeviceId, receiverDeviceId)
  assert.equal(transfer.item.id, item.id)
})

test('General targeted relay rejects self delivery and invalid retention', () => {
  assert.throws(
    () => createGeneralTargetedTransfer(item, personId, senderDeviceId, senderDeviceId, transferId),
    /inválida/,
  )

  assert.throws(
    () => createGeneralTargetedTransfer(
      { ...item, expiresAt: item.createdAt + 21_600_001 },
      personId,
      senderDeviceId,
      receiverDeviceId,
      transferId,
    ),
    /inválida/,
  )
})

test('General targeted ACK is tied to exact transfer, sender, receiver and item', () => {
  const transfer = createGeneralTargetedTransfer(
    item,
    personId,
    senderDeviceId,
    receiverDeviceId,
    transferId,
  )
  const ack = createGeneralTargetedTransferAck(transfer, 'stored')

  assert.equal(validGeneralTargetedTransferAck(ack), true)
  assert.deepEqual(ack, {
    version: 1,
    type: 'general-targeted-transfer-ack',
    transferId,
    senderDeviceId,
    receiverDeviceId,
    itemId: item.id,
    status: 'stored',
  })
})

test('General targeted validators reject wrong receiver and unsupported status', () => {
  const transfer = createGeneralTargetedTransfer(
    item,
    personId,
    senderDeviceId,
    receiverDeviceId,
    transferId,
  )

  assert.equal(validGeneralTargetedTransfer({ ...transfer, receiverDeviceId: senderDeviceId }), false)
  assert.equal(validGeneralTargetedTransferAck({
    ...createGeneralTargetedTransferAck(transfer, 'stored'),
    status: 'delivered',
  }), false)
})
