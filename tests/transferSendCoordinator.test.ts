import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  connectTransferSendCoordinator,
  hasPendingTransferSource,
  sendTransferRequestForSource,
} from '../src/transfer/transferSendCoordinator.ts'
import { createBlobTransferChunkSource } from '../src/transfer/transferChunkSource.ts'
import {
  publishTransferControl,
  registerTransferControlSender,
} from '../src/realtime/transferControlBus.ts'
import type { TransferControlMessage } from '../src/shared/transferControlProtocol.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'

function source() {
  return createBlobTransferChunkSource(new Blob(['hello']), 'text', {
    version: 1,
    provider: 'local-text',
    itemId: 'itm_0123456789abcdef0123456789abcdef',
  })
}

test('registra la fuente antes de emitir transfer-request y nunca pone payload en control', async () => {
  const roomId = 'room_send_source_before_request'
  let sent: TransferControlMessage | null = null
  registerTransferControlSender(roomId, (_targetDeviceId, message) => {
    sent = message
    assert.equal(hasPendingTransferSource(roomId, message.requestId), true)
    return true
  })

  const request = await sendTransferRequestForSource(roomId, senderDeviceId, receiverDeviceId, source())
  assert.equal(sent?.type, 'transfer-request')
  assert.equal(request.byteSize, 5)
  assert.equal(request.contentKind, 'text')
  assert.equal(hasPendingTransferSource(roomId, request.requestId), true)
  assert.doesNotMatch(JSON.stringify(sent), /hello|payload|base64Data|fileName/)
})

test('accepted correlaciona requestId, persiste primero y luego entrega al Route Manager', async () => {
  const roomId = 'room_send_to_route_manager'
  const events: string[] = []
  registerTransferControlSender(roomId, () => true)

  let resolveHandoff!: () => void
  let rejectHandoff!: (error: unknown) => void
  const handedOff = new Promise<void>((resolve, reject) => {
    resolveHandoff = resolve
    rejectHandoff = reject
  })
  const disconnect = connectTransferSendCoordinator(
    roomId,
    {
      acceptPreparedSenderOperation(operation) {
        events.push('route-manager')
        assert.equal(operation.manifest.requestId.length, 28)
      },
    },
    {
      onHandoff() {
        events.push('handoff')
        resolveHandoff()
      },
      onError(_intent, error) {
        rejectHandoff(error)
      },
    },
    async () => { events.push('persist') },
  )

  const request = await sendTransferRequestForSource(roomId, senderDeviceId, receiverDeviceId, source())
  publishTransferControl(roomId, {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: Date.now(),
  }, receiverDeviceId)

  await handedOff
  disconnect()
  assert.equal(hasPendingTransferSource(roomId, request.requestId), false)
  assert.deepEqual(events, ['persist', 'route-manager', 'handoff'])
})

test('rejected limpia la fuente correlacionada y no entrega nada al Route Manager', async () => {
  const roomId = 'room_send_rejected_cleanup'
  let routeCalls = 0
  registerTransferControlSender(roomId, () => true)
  const disconnect = connectTransferSendCoordinator(
    roomId,
    { acceptPreparedSenderOperation() { routeCalls += 1 } },
    {},
    async () => undefined,
  )

  const request = await sendTransferRequestForSource(roomId, senderDeviceId, receiverDeviceId, source())
  publishTransferControl(roomId, {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'rejected',
    decidedAt: Date.now(),
  }, receiverDeviceId)

  disconnect()
  assert.equal(hasPendingTransferSource(roomId, request.requestId), false)
  assert.equal(routeCalls, 0)
})

test('fallo al emitir control revierte el registro local de la fuente', async () => {
  const roomId = 'room_send_control_failure'
  let requestId = ''
  registerTransferControlSender(roomId, (_targetDeviceId, message) => {
    requestId = message.requestId
    assert.equal(hasPendingTransferSource(roomId, requestId), true)
    return false
  })

  await assert.rejects(
    () => sendTransferRequestForSource(roomId, senderDeviceId, receiverDeviceId, source()),
    /No se pudo enviar/,
  )
  assert.equal(hasPendingTransferSource(roomId, requestId), false)
})

test('límite local por receptor evita acumular más fuentes que el control plane permite', async () => {
  const roomId = 'room_send_receiver_limit'
  registerTransferControlSender(roomId, () => true)
  for (let index = 0; index < 8; index += 1) {
    await sendTransferRequestForSource(roomId, senderDeviceId, receiverDeviceId, source())
  }
  await assert.rejects(
    () => sendTransferRequestForSource(roomId, senderDeviceId, receiverDeviceId, source()),
    /Demasiadas transferencias pendientes para ese dispositivo/,
  )
})

test('coordinador nuevo usa solo plano de control + handoff, sin transportar bytes por rutas legacy', async () => {
  const code = await readFile(new URL('../src/transfer/transferSendCoordinator.ts', import.meta.url), 'utf8')
  assert.match(code, /sendTransferControl/)
  assert.match(code, /connectRouteIntentToTransferEngine/)
  assert.match(code, /acceptPreparedSenderOperation/)
  assert.doesNotMatch(code, /sendLocalClipboardTransfer|sendLocalImageDirect|sendDeviceTransfer|RTCDataChannel|RTCPeerConnection|WebSocket/)
})
