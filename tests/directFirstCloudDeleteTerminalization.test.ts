import assert from 'node:assert/strict'
import test from 'node:test'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import type { DirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const createdAt = 1_700_000_000_000
const expiresAt = createdAt + 21_600_000
const deletedAt = createdAt + 30_000

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    snapshot() { return value ? structuredClone(value) : null },
  }
}

function pendingUpsert(): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: local,
    authorSequence: 1,
    itemId,
    operation: 'upsert',
    text: 'contenido que ya fue borrado',
    createdAt,
    directOnly: true,
    authorPersonId: 'per_abcdefghijklmnop',
    expiresAt,
  }
}

test('delete cloud sin peer deja tombstone durable y retira upsert directo pendiente', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const upsert = pendingUpsert()

  assert.equal(coordinator.rememberOutbound(upsert, [peer]), true)
  await coordinator.persist(createdAt + 1_000)
  assert.deepEqual(coordinator.pendingDirectOnlyForDestination(peer).map((change) => change.changeId), [upsert.changeId])
  assert.deepEqual(coordinator.pendingCloudFallbackChanges([]).map((entry) => entry.change.changeId), [upsert.changeId])

  assert.equal(coordinator.observeCloudDeletedItems([itemId], deletedAt), 1)
  await coordinator.persist(deletedAt)

  const durable = store.snapshot()
  assert.ok(durable?.deletedItemIds?.includes(itemId))
  assert.equal(durable?.deliveries.some((entry) => entry.change.changeId === upsert.changeId), false)
  assert.equal(durable?.cloudCommittedChangeIds?.includes(upsert.changeId) ?? false, false)

  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.deepEqual(restored.pendingDirectOnlyForDestination(peer), [])
  assert.deepEqual(restored.pendingCloudFallbackChanges([]), [])
  assert.throws(
    () => restored.rememberOutbound({ ...upsert, changeId: 'chg_bbbbbbbbbbbbbbbbbbbb', authorSequence: 2 }, [peer]),
    /item eliminado/,
  )
})

test('delete aprendido por sync cloud bloquea un replay antiguo en producto tras reinicio', async () => {
  const store = memoryStore()
  const receiver = await DirectFirstPrepCoordinator.load(roomId, peer, store)
  receiver.observeCloudDeletedItems([itemId], deletedAt)
  await receiver.persist(deletedAt)

  const restored = await DirectFirstPrepCoordinator.load(roomId, peer, store)
  const replayed = restored.receive(pendingUpsert())

  assert.equal(replayed.decision, 'next')
  assert.deepEqual(replayed.committed.map((change) => change.changeId), ['chg_aaaaaaaaaaaaaaaaaaaa'])
  assert.deepEqual(replayed.productCommitted, [])
})

test('observación cloud es idempotente, no toca otros items y rechaza ids inválidos', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const first = pendingUpsert()
  const other: DirectChangeEnvelope = {
    ...first,
    changeId: 'chg_cccccccccccccccccccc',
    authorSequence: 2,
    itemId: 'itm_fedcba9876543210fedcba9876543210',
    text: 'otro contenido',
  }

  coordinator.rememberOutbound(first, [peer])
  coordinator.rememberOutbound(other, [peer])

  assert.equal(coordinator.observeCloudDeletedItems([itemId, itemId], deletedAt), 1)
  assert.equal(coordinator.observeCloudDeletedItems([itemId], deletedAt), 0)
  assert.deepEqual(coordinator.pendingDirectOnlyForDestination(peer).map((change) => change.changeId), [other.changeId])
  assert.throws(() => coordinator.observeCloudDeletedItems(['itm_invalido'], deletedAt), /itemId cloud inválido/)
})
