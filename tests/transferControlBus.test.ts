import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  publishTransferControl,
  registerTransferControlSender,
  retryTrackedTransferRequests,
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

test('al reconectar solo se reintentan solicitudes locales todavía vivas', () => {
  const roomId = 'room_control_retry_live'
  const now = 1_800_000_100_000
  const live = {
    ...message,
    requestId: 'req_1123456789abcdef01234567',
    createdAt: now - 1_000,
    expiresAt: now + 30_000,
  }
  const expired = {
    ...message,
    requestId: 'req_2123456789abcdef01234567',
    createdAt: now - 60_000,
    expiresAt: now - 1,
  }
  const sent: string[] = []
  registerTransferControlSender(roomId, (_targetDeviceId, control) => {
    sent.push(control.requestId)
    return true
  })

  assert.equal(sendTransferControl(roomId, receiverDeviceId, live), true)
  assert.equal(sendTransferControl(roomId, receiverDeviceId, expired), true)
  sent.length = 0

  assert.equal(retryTrackedTransferRequests(roomId, now), 1)
  assert.deepEqual(sent, [live.requestId])
})

test('SignalClient dispara el retry únicamente después de recibir ready autenticado', async () => {
  const source = await readFile(new URL('../src/realtime/signalClient.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /message\.type === 'ready'[\s\S]*?this\.readyDeviceId = message\.deviceId[\s\S]*?publishCloudConnectivity\(this\.roomId, 'online'\)[\s\S]*?retryTrackedTransferRequests\(this\.roomId\)/,
  )
})
