import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { LocalImageClipboardSnapshot } from '../src/data/localImageClipboard.ts'
import { createLocalImageTransferChunkSource } from '../src/data/transferSourceProviders.ts'
import { executeLocalDirectImageTransfer } from '../src/transfer/localDirectImageAdapter.ts'
import { prepareSenderTransferOperation } from '../src/transfer/transferOperationCoordinator.ts'
import { selectPreparedTransferRoute } from '../src/transfer/transferRouteManager.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const now = 1_800_000_000_000

function imageItem(bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])): LocalImageClipboardSnapshot {
  const blob = new Blob([bytes], { type: 'image/png' })
  return {
    id: itemId,
    mimeType: 'image/png',
    byteSize: blob.size,
    blob,
    createdAt: now - 1_000,
    expiresAt: now + 60_000,
  }
}

async function preparedImage(item = imageItem()) {
  const source = createLocalImageTransferChunkSource(item)
  const operation = await prepareSenderTransferOperation({
    version: 1,
    type: 'route-intent',
    requestId: 'req_0123456789abcdef01234567',
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'image',
    byteSize: source.byteSize,
    requestCreatedAt: now - 2_000,
    requestExpiresAt: now + 120_000,
    decisionAt: now - 500,
    acceptedAt: now - 400,
  }, source, now, async () => undefined)
  const selection = await selectPreparedTransferRoute(
    'room_image_adapter',
    operation,
    now,
    async () => ({ localDirect: true }),
  )
  return { operation, selection }
}

test('adapta imagen verificada al Directo existente y completa journal solo después del ACK', async () => {
  const item = imageItem()
  const { operation, selection } = await preparedImage(item)
  const events: string[] = []

  const result = await executeLocalDirectImageTransfer(
    'room_image_adapter',
    operation,
    selection,
    {
      loadImageItem: async (reference) => {
        events.push('load')
        assert.equal(reference.provider, 'local-image')
        assert.equal(reference.itemId, item.id)
        return item
      },
      sendImage: async (roomId, remoteDeviceId, sentItem) => {
        events.push('send')
        assert.equal(roomId, 'room_image_adapter')
        assert.equal(remoteDeviceId, receiverDeviceId)
        assert.equal(sentItem, item)
      },
      deleteState: async (transferId) => {
        events.push('delete')
        assert.equal(transferId, operation.manifest.transferId)
      },
      now: () => now,
    },
  )

  assert.deepEqual(events, ['load', 'send', 'delete'])
  assert.equal(result.journal.status, 'complete')
  assert.deepEqual(result.journal.completedRanges, [{ start: 0, endExclusive: operation.manifest.chunkCount }])
  assert.equal(operation.journal.status, 'prepared')
  assert.deepEqual(operation.journal.completedRanges, [])
})

test('cambio de bytes con mismo itemId falla integridad antes de tocar el transporte', async () => {
  const original = imageItem(new Uint8Array([1, 2, 3, 4]))
  const changed = imageItem(new Uint8Array([1, 2, 3, 5]))
  const { operation, selection } = await preparedImage(original)
  let sendCalls = 0
  let deleteCalls = 0

  await assert.rejects(
    () => executeLocalDirectImageTransfer('room_image_adapter', operation, selection, {
      loadImageItem: async () => changed,
      sendImage: async () => { sendCalls += 1 },
      deleteState: async () => { deleteCalls += 1 },
      now: () => now,
    }),
    /integridad/,
  )

  assert.equal(sendCalls, 0)
  assert.equal(deleteCalls, 0)
  assert.equal(operation.journal.status, 'prepared')
})

test('fallo o ACK no almacenado de Directo conserva estado reanudable y no adelanta el journal', async () => {
  const item = imageItem()
  const { operation, selection } = await preparedImage(item)
  let deleteCalls = 0

  await assert.rejects(
    () => executeLocalDirectImageTransfer('room_image_adapter', operation, selection, {
      loadImageItem: async () => item,
      sendImage: async () => { throw new Error('No se recibió confirmación de la imagen') },
      deleteState: async () => { deleteCalls += 1 },
      now: () => now,
    }),
    /confirmación de la imagen/,
  )

  assert.equal(deleteCalls, 0)
  assert.equal(operation.journal.status, 'prepared')
  assert.deepEqual(operation.journal.completedRanges, [])
})

test('imagen local ausente conserva estado preparado y no toca el transporte', async () => {
  const item = imageItem()
  const { operation, selection } = await preparedImage(item)
  let sendCalls = 0
  let deleteCalls = 0

  await assert.rejects(
    () => executeLocalDirectImageTransfer('room_image_adapter', operation, selection, {
      loadImageItem: async () => null,
      sendImage: async () => { sendCalls += 1 },
      deleteState: async () => { deleteCalls += 1 },
      now: () => now,
    }),
    /imagen local ya no está disponible/,
  )

  assert.equal(sendCalls, 0)
  assert.equal(deleteCalls, 0)
  assert.equal(operation.journal.status, 'prepared')
  assert.deepEqual(operation.journal.completedRanges, [])
})

test('una selección unavailable no puede activar el adaptador de imagen', async () => {
  const item = imageItem()
  const { operation, selection } = await preparedImage(item)
  let loadCalls = 0

  await assert.rejects(
    () => executeLocalDirectImageTransfer(
      'room_image_adapter',
      operation,
      { ...selection, status: 'unavailable', route: null },
      {
        loadImageItem: async () => { loadCalls += 1; return item },
        sendImage: async () => undefined,
        deleteState: async () => undefined,
        now: () => now,
      },
    ),
    /selección de ruta no coincide/,
  )

  assert.equal(loadCalls, 0)
})

test('adaptador local de imagen reutiliza solo el transporte directo existente, sin relay ni websocket', async () => {
  const code = await readFile(new URL('../src/transfer/localDirectImageAdapter.ts', import.meta.url), 'utf8')
  assert.match(code, /sendLocalImageDirect/)
  assert.match(code, /verifyTransferChunk/)
  assert.doesNotMatch(code, /Relay|relay|WebSocket|sendDeviceTransfer|sendLocalClipboardTextDirect/)
})
