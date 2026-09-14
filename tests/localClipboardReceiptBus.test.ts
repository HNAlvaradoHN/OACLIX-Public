import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publishLocalClipboardReceipt,
  subscribeLocalClipboardReceipts,
} from '../src/transport/localClipboardReceiptBus.ts'

const item = {
  id: 'itm_0123456789abcdef0123456789abcdef',
  text: 'Android dirigido visible',
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_021_600_000,
  receivedFromDeviceId: 'dev_aaaaaaaaaaaaaaaa',
}

test('el bus local publica el item guardado a la UI y deja de hacerlo al cancelar', () => {
  const received: typeof item[] = []
  const unsubscribe = subscribeLocalClipboardReceipts('room_12345678', (value) => {
    received.push(value as typeof item)
  })

  publishLocalClipboardReceipt('room_12345678', item)
  assert.deepEqual(received, [item])

  unsubscribe()
  publishLocalClipboardReceipt('room_12345678', item)
  assert.equal(received.length, 1)
})

test('el bus no mezcla recibos entre salas', () => {
  const received: string[] = []
  const unsubscribe = subscribeLocalClipboardReceipts('room_abcdefgh', (value) => {
    received.push(value.id)
  })

  publishLocalClipboardReceipt('room_ijklmnop', item)
  assert.deepEqual(received, [])
  unsubscribe()
})
