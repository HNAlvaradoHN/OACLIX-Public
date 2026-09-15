import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clipboardTransferSurface,
  createGeneralClipboardTransfer,
  validLocalClipboardTransfer,
} from '../src/realtime/localClipboardTransfer.ts'
import { prepareGeneralTargetedInboxItem } from '../src/data/generalTargetedInbox.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const roomId = 'room_abcdefghijklmnop'
const now = 1_800_000_000_000
const item = {
  id: 'itm_0123456789abcdef0123456789abcdef',
  text: 'texto dirigido',
  createdAt: now,
  expiresAt: now + 21_600_000,
}

test('General reutiliza el relay dirigido sin convertirlo en broadcast', () => {
  const transfer = createGeneralClipboardTransfer(
    item,
    senderDeviceId,
    receiverDeviceId,
    'xfr_0123456789abcdef01234567',
  )

  assert.equal(transfer.receiverDeviceId, receiverDeviceId)
  assert.equal(clipboardTransferSurface(transfer), 'general')
  assert.equal(validLocalClipboardTransfer(transfer), true)
  assert.equal(validLocalClipboardTransfer({ ...transfer, surface: 'otro' }), false)
})

test('el receptor de General valida origen y expiración antes de persistir', () => {
  const transfer = createGeneralClipboardTransfer(
    item,
    senderDeviceId,
    receiverDeviceId,
    'xfr_0123456789abcdef01234567',
  )

  assert.deepEqual(
    prepareGeneralTargetedInboxItem(roomId, transfer, senderDeviceId, now),
    {
      id: item.id,
      text: item.text,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      senderDeviceId,
    },
  )
  assert.equal(
    prepareGeneralTargetedInboxItem(roomId, transfer, senderDeviceId, item.expiresAt),
    null,
  )
  assert.throws(
    () => prepareGeneralTargetedInboxItem(roomId, transfer, receiverDeviceId, now),
    /origen/,
  )
})
