import assert from 'node:assert/strict'
import test from 'node:test'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import { validDirectFirstPersistentState, type DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import { createDirectAck, validDirectChangeEnvelope, type DirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'
import { DIRECT_TEXT_RETENTION_MS } from '../src/transport/directFirstTombstonePolicy.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const base = 1_700_000_000_000

function memoryStore(initial: DirectFirstPersistentState | null = null) {
  let value = initial
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    current() { return value ? structuredClone(value) : null },
  }
}

function directUpsert(expiresAt = base + DIRECT_TEXT_RETENTION_MS): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: local,
    authorSequence: 1,
    itemId,
    operation: 'upsert',
    text: 'hola',
    createdAt: base,
    directOnly: true,
    authorPersonId: 'per_abcdefghijklmnop',
    expiresAt,
  }
}

function deletion(createdAt = base + 1_000): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: 'chg_dddddddddddddddddddd',
    authorDeviceId: local,
    authorSequence: 2,
    itemId,
    operation: 'delete',
    createdAt,
    directOnly: true,
  }
}

test('el protocolo rechaza direct-only que exceda seis horas', () => {
  assert.equal(validDirectChangeEnvelope(directUpsert()), true)
  assert.equal(validDirectChangeEnvelope(directUpsert(base + DIRECT_TEXT_RETENTION_MS + 1)), false)
})

test('delete nuevo conserva ID compatible, persiste retainUntil y solo se poda después de la frontera segura', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const deleteChange = deletion()
  coordinator.rememberOutbound(deleteChange, [peer])

  const before = coordinator.snapshot(deleteChange.createdAt + DIRECT_TEXT_RETENTION_MS - 1)
  assert.deepEqual(before.deletedItemIds, [itemId])
  assert.deepEqual(before.tombstones, [{
    itemId,
    retainUntil: deleteChange.createdAt + DIRECT_TEXT_RETENTION_MS,
  }])

  const atBoundary = coordinator.snapshot(deleteChange.createdAt + DIRECT_TEXT_RETENTION_MS)
  assert.deepEqual(atBoundary.deletedItemIds, [])
  assert.deepEqual(atBoundary.tombstones, [])
})

test('tombstone no se poda si un upsert antiguo sigue pendiente de entrega o fallback', async () => {
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, memoryStore())
  const oldUpsert = directUpsert()
  coordinator.rememberOutbound(oldUpsert, [peer])

  const remoteDelete: DirectChangeEnvelope = {
    ...deletion(),
    changeId: 'chg_eeeeeeeeeeeeeeeeeeee',
    authorDeviceId: peer,
    authorSequence: 1,
  }
  coordinator.receive(remoteDelete)
  const boundary = remoteDelete.createdAt + DIRECT_TEXT_RETENTION_MS

  const stillProtected = coordinator.snapshot(boundary)
  assert.deepEqual(stillProtected.deletedItemIds, [itemId])
  assert.deepEqual(stillProtected.tombstones?.map((entry) => entry.itemId), [itemId])
  assert.deepEqual(coordinator.pendingCloudFallbackChanges([]), [])

  assert.equal(coordinator.acknowledge(oldUpsert.changeId, peer, createDirectAck(oldUpsert)), true)
  const afterAck = coordinator.snapshot(boundary)
  assert.deepEqual(afterAck.deletedItemIds, [])
  assert.deepEqual(afterAck.tombstones, [])
})

test('checkpoint legacy conserva tombstone sin inventar fecha de poda', async () => {
  const legacy: DirectFirstPersistentState = {
    version: 1,
    roomId,
    localDeviceId: local,
    logicalClock: 0,
    ledger: { version: 1, appliedChangeIds: [], lastSequenceByAuthor: [] },
    deliveries: [],
    replayLogs: [],
    gapBuffer: { version: 1, maxBufferedPerAuthor: 64, changes: [] },
    deletedItemIds: [itemId],
    savedAt: base,
  }
  assert.equal(validDirectFirstPersistentState(legacy), true)

  const store = memoryStore(legacy)
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const farFuture = coordinator.snapshot(base + 365 * 24 * 60 * 60 * 1000)
  assert.deepEqual(farFuture.deletedItemIds, [itemId])
  assert.deepEqual(farFuture.tombstones, [])
})

test('checkpoint con ID y metadata fechada restaura el tombstone como podable y no como legacy', async () => {
  const retainUntil = base + DIRECT_TEXT_RETENTION_MS
  const state: DirectFirstPersistentState = {
    version: 1,
    roomId,
    localDeviceId: local,
    logicalClock: 0,
    ledger: { version: 1, appliedChangeIds: [], lastSequenceByAuthor: [] },
    deliveries: [],
    replayLogs: [],
    gapBuffer: { version: 1, maxBufferedPerAuthor: 64, changes: [] },
    deletedItemIds: [itemId],
    tombstones: [{ itemId, retainUntil }],
    savedAt: base,
  }
  assert.equal(validDirectFirstPersistentState(state), true)

  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, memoryStore(state))
  const compacted = coordinator.snapshot(retainUntil)
  assert.deepEqual(compacted.deletedItemIds, [])
  assert.deepEqual(compacted.tombstones, [])
})
