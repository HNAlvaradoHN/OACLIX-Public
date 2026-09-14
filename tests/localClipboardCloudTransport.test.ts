import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  registerDeviceRelaySender,
  sendDeviceRelayTransfer,
} from '../src/realtime/deviceRelayBus.ts'
import type { LocalClipboardTransfer } from '../src/realtime/localClipboardTransfer.ts'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('el bus realtime expone un emisor dirigido de texto por Nube', () => {
  const roomId = 'gen_cloud_text_sender_test'
  const transfer = {
    version: 1,
    type: 'local-clipboard-transfer',
    transferId: 'xfr_0123456789abcdef01234567',
    senderDeviceId: 'dev_abcdefghijklmnop',
    receiverDeviceId: 'dev_ponmlkjihgfedcba',
    item: {
      id: 'itm_0123456789abcdef0123456789abcdef',
      text: 'hola',
      createdAt: 1,
      expiresAt: 2,
    },
  } satisfies LocalClipboardTransfer

  let target: string | null = null
  registerDeviceRelaySender(roomId, (targetDeviceId, relayed) => {
    target = targetDeviceId
    return relayed === transfer
  })

  assert.equal(sendDeviceRelayTransfer(roomId, transfer.receiverDeviceId, transfer), true)
  assert.equal(target, transfer.receiverDeviceId)
})

test('el transporte Nube exige ruta Nube, vínculo autorizado y ACK dirigido', async () => {
  const source = await read('src/transport/localClipboardCloudTransport.ts')

  assert.match(source, /getDeviceRouteStatus\(roomId, remoteDeviceId\) !== 'cloud'/)
  assert.match(source, /requireAuthorizedLinkedDevice\(roomId, remoteDeviceId\)/)
  assert.match(source, /createLocalClipboardTransfer\(item, localDeviceId, remoteDeviceId\)/)
  assert.match(source, /subscribeDeviceRelayAcks/)
  assert.match(source, /ackRemoteDeviceId !== remoteDeviceId/)
  assert.match(source, /ack\.transferId !== transfer\.transferId/)
  assert.match(source, /ack\.itemId !== transfer\.item\.id/)
  assert.match(source, /sendDeviceRelayTransfer\(roomId, remoteDeviceId, transfer\)/)
  assert.doesNotMatch(source, /sendLocalClipboardTextDirect|createClipboardText|cloudClipboardBoundary/)
})

test('SignalClient registra el relay saliente sobre el WebSocket autenticado existente', async () => {
  const source = await read('src/realtime/signalClient.ts')

  assert.match(source, /registerDeviceRelaySender\(roomId, \(targetDeviceId, transfer\) => this\.sendDeviceTransfer\(targetDeviceId, transfer\)\)/)
  assert.match(source, /type: 'device-transfer', targetDeviceId, transfer/)
  assert.match(source, /transfer\.senderDeviceId !== this\.readyDeviceId/)
  assert.match(source, /transfer\.receiverDeviceId !== targetDeviceId/)
})

test('la UI ofrece Nube solo como acción explícita y no como fallback automático', async () => {
  const panel = await read('src/components/LocalClipboardSharePanel.tsx')

  assert.match(panel, /status === 'cloud'/)
  assert.match(panel, /Enviar por Nube/)
  assert.match(panel, /sendLocalClipboardTextCloud\(identity\.generalRoomId, deviceId, item\)/)
  assert.match(panel, /no sube tu historial ni se usa como fallback automático/)
  assert.match(panel, /route === 'direct'[\s\S]*?onSendDirect\(deviceId\)[\s\S]*?else[\s\S]*?sendLocalClipboardTextCloud/)
})
