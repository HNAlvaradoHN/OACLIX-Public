import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { TransferableLocalClipboardText } from '../src/data/localClipboard.ts'
import { createLocalTextTransferChunkSource } from '../src/data/transferSourceProviders.ts'
import { executeLocalDirectTextTransfer } from '../src/transfer/localDirectTextAdapter.ts'
import { prepareSenderTransferOperation } from '../src/transfer/transferOperationCoordinator.ts'
import { selectPreparedTransferRoute } from '../src/transfer/transferRouteManager.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const now = 1_800_000_000_000

function textItem(text = 'hello'): TransferableLocalClipboardText {
  return {
    id: itemId,
    text,
    createdAt: now - 1_000,
    expiresAt: now + 60_000,
  }
}

async function preparedText(item = textItem()) {
  const source = createLocalTextTransferChunkSource(item)
  const operation = await prepareSenderTransferOperation({
    version: 1,
    type: 'route-intent',
    requestId: 'req_0123456789abcdef01234567',
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'text',
    byteSize: source.byteSize,
    requestCreatedAt: now - 2_000,
    requestExpiresAt: now + 120_000,
    decisionAt: now - 500,
    acceptedAt: now - 400,
  }, source, now, async () => undefined)
  const selection = await selectPreparedTransferRoute(
    'room_text_adapter',
    operation,
    now,
    async () => ({ localDirect: true }),
  )
  return { operation, selection }
}

test('adapta texto verificado al Directo existente y completa journal solo después del ACK', async () => {
  const item = textItem()
  const { operation, selection } = await preparedText(item)
  const events: string[] = []

  const result = await executeLocalDirectTextTransfer(
    'room_text_adapter',
    operation,
    selection,
    {
      loadTextItem: async (reference) => {
        events.push('load')
        assert.equal(reference.provider, 'local-text')
        assert.equal(reference.itemId, item.id)
        return item
      },
      sendText: async (roomId, remoteDeviceId, sentItem) => {
        events.push('send')
        assert.equal(roomId, 'room_text_adapter')
        assert.equal(remoteDeviceId, receiverDeviceId)
        assert.deepEqual(sentItem, item)
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

test('cambio de contenido con mismo itemId falla integridad antes de tocar el transporte', async () => {
  const { operation, selection } = await preparedText(textItem('hello'))
  let sendCalls = 0
  let deleteCalls = 0

  await assert.rejects(
    () => executeLocalDirectTextTransfer('room_text_adapter', operation, selection, {
      loadTextItem: async () => textItem('jello'),
      sendText: async () => { sendCalls += 1 },
      deleteState: async () => { deleteCalls += 1 },
      now: () => now,
    }),
    /integridad/,
  )

  assert.equal(sendCalls, 0)
  assert.equal(deleteCalls, 0)
  assert.equal(operation.journal.status, 'prepared')
})

test('fallo de Directo conserva estado reanudable y no adelanta el journal', async () => {
  const item = textItem()
  const { operation, selection } = await preparedText(item)
  let deleteCalls = 0

  await assert.rejects(
    () => executeLocalDirectTextTransfer('room_text_adapter', operation, selection, {
      loadTextItem: async () => item,
      sendText: async () => { throw new Error('La ruta Directo local cambió antes del envío') },
      deleteState: async () => { deleteCalls += 1 },
      now: () => now,
    }),
    /ruta Directo local cambió/,
  )

  assert.equal(deleteCalls, 0)
  assert.equal(operation.journal.status, 'prepared')
  assert.deepEqual(operation.journal.completedRanges, [])
})

test('una selección unavailable no puede activar el adaptador', async () => {
  const item = textItem()
  const { operation, selection } = await preparedText(item)
  let loadCalls = 0

  await assert.rejects(
    () => executeLocalDirectTextTransfer(
      'room_text_adapter',
      operation,
      { ...selection, status: 'unavailable', route: null },
      {
        loadTextItem: async () => { loadCalls += 1; return item },
        sendText: async () => undefined,
        deleteState: async () => undefined,
        now: () => now,
      },
    ),
    /selección de ruta no coincide/,
  )

  assert.equal(loadCalls, 0)
})

test('adaptador local de texto reutiliza solo el transporte directo existente, sin relay ni websocket', async () => {
  const code = await readFile(new URL('../src/transfer/localDirectTextAdapter.ts', import.meta.url), 'utf8')
  assert.match(code, /sendLocalClipboardTextDirect/)
  assert.match(code, /verifyTransferChunk/)
  assert.doesNotMatch(code, /Relay|relay|WebSocket|sendDeviceTransfer|sendLocalImageDirect/)
})
