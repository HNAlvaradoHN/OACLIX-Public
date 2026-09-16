import assert from 'node:assert/strict'
import test from 'node:test'
import {
  publishTransferControl,
  registerTransferControlSender,
  sendTransferControl,
  subscribeTransferControl,
} from '../src/realtime/transferControlBus.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const message = {
  version: 1 as const,
  type: 'transfer-request' as const,
  requestId: 'req_0123456789abcdef01234567',
  senderDeviceId,
  receiverDeviceId,
  contentKind: 'text' as const,
  byteSize: 12,
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_000_300_000,
}

test('el bus separa envío de control de la entrega a listeners', () => {
  const roomId = 'room_control_bus_1'
  const sent: unknown[] = []
  registerTransferControlSender(roomId, (targetDeviceId, control) => {
    sent.push({ targetDeviceId, control })
    return true
  })

  assert.equal(sendTransferControl(roomId, receiverDeviceId, message), true)
  assert.deepEqual(sent, [{ targetDeviceId: receiverDeviceId, control: message }])

  const received: unknown[] = []
  const unsubscribe = subscribeTransferControl(roomId, (control, remoteDeviceId) => {
    received.push({ control, remoteDeviceId })
  })
  publishTransferControl(roomId, message, senderDeviceId)
  unsubscribe()
  publishTransferControl(roomId, message, senderDeviceId)

  assert.deepEqual(received, [{ control: message, remoteDeviceId: senderDeviceId }])
})

test('sin cliente registrado el control falla cerrado', () => {
  assert.equal(sendTransferControl('room_without_sender', receiverDeviceId, message), false)
})
