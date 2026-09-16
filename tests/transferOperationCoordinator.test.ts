import assert from 'node:assert/strict'
import test from 'node:test'
import {
  connectRouteIntentToTransferEngine,
  prepareSenderTransferOperation,
} from '../src/transfer/transferOperationCoordinator.ts'
import { createBlobTransferChunkSource } from '../src/transfer/transferChunkSource.ts'
import {
  observeReceivedTransferControlForRouteIntent,
  trackSentTransferControl,
} from '../src/realtime/transferRouteIntent.ts'

const roomId = 'room_transfer_engine_route'
const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const requestId = 'req_0123456789abcdef01234567'
const now = 1_800_000_010_000

const intent = {
  version: 1 as const,
  type: 'route-intent' as const,
  requestId,
  senderDeviceId,
  receiverDeviceId,
  contentKind: 'text' as const,
  byteSize: 5,
  requestCreatedAt: now - 2_000,
  requestExpiresAt: now + 120_000,
  decisionAt: now - 500,
  acceptedAt: now - 400,
}

test('Route Intent prepara manifest+journal sender y persiste metadata antes de cualquier transporte', async () => {
  const sourceRef = {
    version: 1 as const,
    provider: 'local-text' as const,
    itemId: 'itm_0123456789abcdef0123456789abcdef',
  }
  const source = createBlobTransferChunkSource(new Blob(['hello']), 'text', sourceRef)
  const persisted: unknown[] = []

  const operation = await prepareSenderTransferOperation(
    intent,
    source,
    now,
    async (manifest, journal, savedAt, reference) => {
      persisted.push({ manifest, journal, savedAt, reference })
    },
  )

  assert.equal(operation.manifest.requestId, requestId)
  assert.equal(operation.manifest.senderDeviceId, senderDeviceId)
  assert.equal(operation.manifest.receiverDeviceId, receiverDeviceId)
  assert.equal(operation.journal.role, 'sender')
  assert.equal(operation.journal.status, 'prepared')
  assert.deepEqual(operation.sourceRef, sourceRef)
  assert.equal(persisted.length, 1)
  assert.doesNotMatch(JSON.stringify(persisted), /hello/)
})

test('Route Intent no acepta una fuente cuyo tipo o tamaño no coincida', async () => {
  await assert.rejects(
    () => prepareSenderTransferOperation(intent, createBlobTransferChunkSource(new Blob(['hola']), 'text'), now, async () => undefined),
    /no coincide/,
  )
  await assert.rejects(
    () => prepareSenderTransferOperation(intent, createBlobTransferChunkSource(new Blob(['hello']), 'file'), now, async () => undefined),
    /no coincide/,
  )
})

test('Route Intent vencido no materializa una operación', async () => {
  const source = createBlobTransferChunkSource(new Blob(['hello']), 'text')
  await assert.rejects(
    () => prepareSenderTransferOperation({ ...intent, requestExpiresAt: now }, source, now, async () => undefined),
    /vencido o inválido/,
  )
})

test('conexión del bus convierte accepted en preparación y no necesita elegir transporte', async () => {
  const liveNow = Date.now()
  const request = {
    version: 1 as const,
    type: 'transfer-request' as const,
    requestId: 'req_111111111111111111111111',
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'text' as const,
    byteSize: 5,
    createdAt: liveNow - 1_000,
    expiresAt: liveNow + 120_000,
  }
  const source = createBlobTransferChunkSource(new Blob(['hello']), 'text')
  const prepared = new Promise<void>((resolve, reject) => {
    const unsubscribe = connectRouteIntentToTransferEngine(
      roomId,
      () => source,
      {
        onPrepared: () => {
          unsubscribe()
          resolve()
        },
        onError: (_routeIntent, error) => {
          unsubscribe()
          reject(error)
        },
      },
      async () => undefined,
    )
  })

  assert.equal(trackSentTransferControl(roomId, receiverDeviceId, request), true)
  observeReceivedTransferControlForRouteIntent(roomId, receiverDeviceId, {
    version: 1,
    type: 'transfer-decision',
    requestId: request.requestId,
    senderDeviceId,
    receiverDeviceId,
    decision: 'accepted',
    decidedAt: liveNow,
  }, liveNow)

  await prepared
})
