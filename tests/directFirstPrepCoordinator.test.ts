import assert from 'node:assert/strict'
import test from 'node:test'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import { createDirectAck, type DirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const seedCreatedAt = 1_700_000_000_000
const seedExpiresAt = seedCreatedAt + 21_600_000

function change(sequence: number, authorDeviceId = local): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: `chg_${String(sequence).padStart(20, 'a')}`,
    authorDeviceId,
    authorSequence: sequence,
    itemId,
    operation: 'upsert',
    text: `texto-${sequence}`,
    createdAt: 1_700_000_000_000 + sequence,
  }
}

function directChange(sequence: number): DirectChangeEnvelope {
  const createdAt = seedCreatedAt + sequence
  return {
    ...change(sequence),
    createdAt,
    directOnly: true,
    authorPersonId: 'per_abcdefghijklmnop',
    expiresAt: createdAt + 21_600_000,
  }
}

function deleteChange(sequence: number): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: `chg_${String(sequence).padStart(20, 'd')}`,
    authorDeviceId: local,
    authorSequence: sequence,
    itemId,
    operation: 'delete',
    createdAt: 1_700_000_000_000 + sequence,
  }
}

function seed(text: string) {
  return { text, createdAt: seedCreatedAt, expiresAt: seedExpiresAt }
}

function memoryStore(initial: DirectFirstPersistentState | null = null) {
  let value = initial
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    current() { return value ? structuredClone(value) : null },
  }
}

test('restaura reloj, entrega pendiente y ACK desde checkpoint', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.equal(coordinator.advanceLogicalClock(), 1)

  const outbound = change(1)
  assert.equal(coordinator.rememberOutbound(outbound, [peer]), true)
  await coordinator.persist(1_700_000_000_500)

  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.equal(restored.currentLogicalClock(), 1)
  assert.deepEqual(restored.pendingChangeIds(), [outbound.changeId])
  assert.equal(restored.acknowledge(outbound.changeId, peer, createDirectAck(outbound)), true)
  assert.deepEqual(restored.pendingChangeIds(), [])
})

test('conserva semilla local completa de delete para fallback cloud después de reinicio', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const deletion = deleteChange(2)
  const fallbackSeed = seed('contenido antes de borrar')

  assert.equal(coordinator.rememberOutbound(
    deletion,
    [peer],
    { deleteFallbackSeed: fallbackSeed },
  ), true)
  assert.deepEqual(coordinator.cloudFallbackSeed(deletion.changeId, itemId), fallbackSeed)
  await coordinator.persist(1_700_000_000_550)

  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.deepEqual(restored.cloudFallbackSeed(deletion.changeId, itemId), fallbackSeed)
  assert.equal(restored.cloudFallbackSeed(deletion.changeId, 'itm_ffffffffffffffffffffffffffffffff'), undefined)
})

test('rehidrata semilla legacy desde el replay exacto si todavía existe', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const upsert = directChange(1)
  coordinator.rememberOutbound(upsert, [peer])
  const deletion = deleteChange(2)
  coordinator.rememberOutbound(deletion, [peer], {
    deleteFallbackSeed: {
      text: upsert.text!,
      createdAt: upsert.createdAt,
      expiresAt: upsert.expiresAt!,
    },
  })
  await coordinator.persist(1_700_000_000_550)

  const snapshot = store.current()!
  snapshot.cloudFallbackSeeds = snapshot.cloudFallbackSeeds?.map((entry) => ({
    changeId: entry.changeId,
    itemId: entry.itemId,
    text: entry.text,
  }))
  const legacyStore = memoryStore(snapshot)
  const restored = await DirectFirstPrepCoordinator.load(roomId, local, legacyStore)
  assert.deepEqual(restored.cloudFallbackSeed(deletion.changeId, itemId), {
    text: upsert.text,
    createdAt: upsert.createdAt,
    expiresAt: upsert.expiresAt,
  })
})

test('libera semilla de delete cuando todos los destinos confirman entrega', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const deletion = deleteChange(3)

  coordinator.rememberOutbound(
    deletion,
    [peer],
    { deleteFallbackSeed: seed('temporal') },
  )
  assert.deepEqual(coordinator.cloudFallbackSeed(deletion.changeId, itemId), seed('temporal'))
  assert.equal(coordinator.acknowledge(deletion.changeId, peer, createDirectAck(deletion)), true)
  assert.equal(coordinator.cloudFallbackSeed(deletion.changeId, itemId), undefined)
})

test('marca un cambio vencido como terminal sin fingir una copia cloud', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const outbound = directChange(4)
  coordinator.rememberOutbound(outbound, [peer])

  coordinator.markCloudChangeExpired(outbound.changeId)
  assert.equal(coordinator.cloudChangeCommitted(outbound.changeId), true)
  assert.equal(coordinator.cloudItemKnown(outbound.itemId), false)
  assert.deepEqual(coordinator.pendingCloudFallbackChanges([]), [])
})

test('delete vencido vuelve terminales los upserts anteriores del mismo item', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const upsert = directChange(5)
  coordinator.rememberOutbound(upsert, [peer])
  const deletion = deleteChange(6)
  coordinator.rememberOutbound(deletion, [peer], {
    deleteFallbackSeed: {
      text: upsert.text!,
      createdAt: upsert.createdAt,
      expiresAt: upsert.expiresAt!,
    },
  })

  coordinator.markCloudChangeExpired(deletion.changeId)
  assert.equal(coordinator.cloudChangeCommitted(deletion.changeId), true)
  assert.equal(coordinator.cloudChangeCommitted(upsert.changeId), true)
  assert.deepEqual(coordinator.pendingDirectOnlyForDestination(peer), [])
})

test('compacta entrega completa solo después de que su ACK tuvo un checkpoint durable', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const outbound = change(4)

  coordinator.rememberOutbound(outbound, [peer], { cloudCommitted: true })
  assert.equal(coordinator.acknowledge(outbound.changeId, peer, createDirectAck(outbound)), true)
  await coordinator.persist(1_700_000_000_575)

  const durableAck = store.current()
  assert.deepEqual(durableAck?.deliveries[0]?.pendingDeviceIds, [])
  assert.deepEqual(durableAck?.deliveries[0]?.deliveredDeviceIds, [peer])
  assert.deepEqual(durableAck?.cloudCommittedChangeIds, [outbound.changeId])

  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.equal(restored.deliverySnapshot(outbound.changeId), null)
  assert.equal(restored.cloudChangeCommitted(outbound.changeId), false)
  assert.deepEqual(restored.snapshot().replayLogs[0]?.changes.map((entry) => entry.changeId), [outbound.changeId])

  await restored.persist(1_700_000_000_576)
  assert.deepEqual(store.current()?.deliveries, [])
  assert.deepEqual(store.current()?.cloudCommittedChangeIds, [])
})

test('no compacta una entrega que todavía tiene destinos pendientes', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const outbound = change(5)

  coordinator.rememberOutbound(outbound, [peer])
  await coordinator.persist(1_700_000_000_580)
  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.notEqual(restored.deliverySnapshot(outbound.changeId), null)
  assert.deepEqual(restored.deliverySnapshot(outbound.changeId)?.pendingDeviceIds, [peer])
})

test('bufferiza un gap y aplica continuidad al llegar el cambio faltante', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)

  const remoteSecond = change(2, peer)
  const gap = coordinator.receive(remoteSecond)
  assert.equal(gap.decision, 'gap')
  assert.deepEqual(gap.committed, [])

  const remoteFirst = change(1, peer)
  const repaired = coordinator.receive(remoteFirst)
  assert.equal(repaired.decision, 'next')
  assert.deepEqual(repaired.committed.map((entry) => entry.authorSequence), [1, 2])

  await coordinator.persist(1_700_000_000_600)
  const snapshot = store.current()
  assert.equal(snapshot?.ledger.lastSequenceByAuthor[0][1], 2)
  assert.deepEqual(snapshot?.gapBuffer.changes, [])
})

test('no confunde cambios duplicados con cambios nuevos después de restaurar', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const remote = change(1, peer)
  assert.equal(coordinator.receive(remote).decision, 'next')
  await coordinator.persist(1_700_000_000_700)

  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.equal(restored.receive(remote).decision, 'duplicate')
})
