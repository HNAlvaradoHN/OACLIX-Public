import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  createTransferDataPlaneHandoff,
  dispatchPreparedTransferDataPlane,
} from '../src/transfer/transferDataPlaneDispatcher.ts'
import { createBlobTransferChunkSource } from '../src/transfer/transferChunkSource.ts'
import { prepareSenderTransferOperation } from '../src/transfer/transferOperationCoordinator.ts'
import type { PreparedSenderTransferOperation } from '../src/transfer/transferOperationCoordinator.ts'
import type { TransferRouteSelection } from '../src/transfer/transferRouteManager.ts'
import type { TransferContentKind } from '../src/shared/transferControlProtocol.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const now = 1_800_000_000_000

function sourceFor(contentKind: TransferContentKind) {
  const reference = contentKind === 'text'
    ? { version: 1 as const, provider: 'local-text' as const, itemId: 'itm_0123456789abcdef0123456789abcdef' }
    : contentKind === 'image'
      ? { version: 1 as const, provider: 'local-image' as const, itemId: 'itm_fedcba9876543210fedcba9876543210' }
      : null
  const blob = contentKind === 'image'
    ? new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
    : new Blob(['hello'])
  return createBlobTransferChunkSource(blob, contentKind, reference)
}

async function prepared(contentKind: TransferContentKind) {
  const source = sourceFor(contentKind)
  const operation = await prepareSenderTransferOperation({
    version: 1,
    type: 'route-intent',
    requestId: contentKind === 'text'
      ? 'req_0123456789abcdef01234567'
      : contentKind === 'image'
        ? 'req_1123456789abcdef01234567'
        : 'req_2123456789abcdef01234567',
    senderDeviceId,
    receiverDeviceId,
    contentKind,
    byteSize: source.byteSize,
    requestCreatedAt: now - 2_000,
    requestExpiresAt: now + 120_000,
    decisionAt: now - 500,
    acceptedAt: now - 400,
  }, source, now, async () => undefined)

  const selection: TransferRouteSelection = {
    version: 1,
    type: 'transfer-route-selection',
    requestId: operation.manifest.requestId,
    transferId: operation.manifest.transferId,
    senderDeviceId,
    receiverDeviceId,
    contentKind,
    status: 'selected',
    route: 'local-direct',
    selectedAt: now,
  }
  return { operation, selection }
}

function adapterResult(operation: PreparedSenderTransferOperation, selection: TransferRouteSelection) {
  return Promise.resolve({ selection: { ...selection }, journal: operation.journal })
}

test('despacha texto local-direct únicamente al adaptador de texto', async () => {
  const { operation, selection } = await prepared('text')
  const calls: string[] = []

  const result = await dispatchPreparedTransferDataPlane('room_dispatch_text', operation, selection, {
    executeText: async (roomId, receivedOperation, receivedSelection) => {
      calls.push('text')
      assert.equal(roomId, 'room_dispatch_text')
      assert.equal(receivedOperation, operation)
      assert.equal(receivedSelection, selection)
      return adapterResult(operation, selection)
    },
    executeImage: async () => {
      calls.push('image')
      return adapterResult(operation, selection)
    },
  })

  assert.deepEqual(calls, ['text'])
  assert.equal(result.selection.transferId, operation.manifest.transferId)
})

test('despacha imagen local-direct únicamente al adaptador de imagen', async () => {
  const { operation, selection } = await prepared('image')
  const calls: string[] = []

  await dispatchPreparedTransferDataPlane('room_dispatch_image', operation, selection, {
    executeText: async () => {
      calls.push('text')
      return adapterResult(operation, selection)
    },
    executeImage: async (roomId, receivedOperation, receivedSelection) => {
      calls.push('image')
      assert.equal(roomId, 'room_dispatch_image')
      assert.equal(receivedOperation, operation)
      assert.equal(receivedSelection, selection)
      return adapterResult(operation, selection)
    },
  })

  assert.deepEqual(calls, ['image'])
})

test('rechaza selección unavailable antes de invocar cualquier adaptador', async () => {
  const { operation, selection } = await prepared('text')
  let calls = 0

  await assert.rejects(
    () => dispatchPreparedTransferDataPlane(
      'room_dispatch_unavailable',
      operation,
      { ...selection, status: 'unavailable', route: null },
      {
        executeText: async () => { calls += 1; return adapterResult(operation, selection) },
        executeImage: async () => { calls += 1; return adapterResult(operation, selection) },
      },
    ),
    /no tiene una ruta de datos seleccionada/,
  )

  assert.equal(calls, 0)
})

test('rechaza archivo aunque una selección defectuosa intente marcar local-direct', async () => {
  const { operation, selection } = await prepared('file')
  let calls = 0

  await assert.rejects(
    () => dispatchPreparedTransferDataPlane('room_dispatch_file', operation, selection, {
      executeText: async () => { calls += 1; return adapterResult(operation, selection) },
      executeImage: async () => { calls += 1; return adapterResult(operation, selection) },
    }),
    /No existe adaptador de data plane/,
  )

  assert.equal(calls, 0)
})

test('rechaza selección que no corresponde a la operación preparada', async () => {
  const { operation, selection } = await prepared('text')
  let calls = 0

  await assert.rejects(
    () => dispatchPreparedTransferDataPlane(
      'room_dispatch_mismatch',
      operation,
      { ...selection, transferId: `${selection.transferId}_otro` },
      {
        executeText: async () => { calls += 1; return adapterResult(operation, selection) },
        executeImage: async () => { calls += 1; return adapterResult(operation, selection) },
      },
    ),
    /selección de ruta no coincide/,
  )

  assert.equal(calls, 0)
})

test('handoff reutilizable espera al dispatcher antes de resolverse', async () => {
  const { operation, selection } = await prepared('text')
  const events: string[] = []
  const handoff = createTransferDataPlaneHandoff('room_dispatch_handoff', {
    executeText: async () => {
      events.push('adapter')
      return adapterResult(operation, selection)
    },
    executeImage: async () => adapterResult(operation, selection),
  })

  await handoff(operation, selection)
  events.push('resolved')
  assert.deepEqual(events, ['adapter', 'resolved'])
})

test('dispatcher solo conoce adaptadores del Transfer Engine y no transportes legacy', async () => {
  const code = await readFile(new URL('../src/transfer/transferDataPlaneDispatcher.ts', import.meta.url), 'utf8')
  assert.match(code, /executeLocalDirectTextTransfer/)
  assert.match(code, /executeLocalDirectImageTransfer/)
  assert.doesNotMatch(code, /sendLocalClipboardTextDirect|sendLocalImageDirect|Relay|relay|WebSocket|RTCDataChannel|RTCPeerConnection/)
})
