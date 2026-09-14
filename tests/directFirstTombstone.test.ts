import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import { validDirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import type { DirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const creator = 'dev_qrstuvwxyzabcdef'
const deleter = 'dev_secondpeerabcdef'
const peer = 'dev_otherpeerabcdefgh'
const itemId = 'itm_0123456789abcdef0123456789abcdef'

function upsert(authorDeviceId: string, authorSequence: number, suffix: string): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: `chg_${suffix.repeat(20)}`,
    authorDeviceId,
    authorSequence,
    itemId,
    operation: 'upsert',
    text: 'texto directo',
    createdAt: 1_700_000_000_000 + authorSequence,
  }
}

function deletion(authorDeviceId: string, authorSequence: number, suffix: string): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: `chg_${suffix.repeat(20)}`,
    authorDeviceId,
    authorSequence,
    itemId,
    operation: 'delete',
    createdAt: 1_700_000_010_000 + authorSequence,
  }
}

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    current() { return value ? structuredClone(value) : null },
  }
}

test('delete de otro autor bloquea upsert tardío del mismo item sin impedir ACK durable', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)

  const removed = coordinator.receive(deletion(deleter, 1, 'd'))
  assert.deepEqual(removed.committed.map((change) => change.operation), ['delete'])
  assert.deepEqual(removed.productCommitted.map((change) => change.operation), ['delete'])

  const delayedCreate = coordinator.receive(upsert(creator, 1, 'a'))
  assert.deepEqual(delayedCreate.committed.map((change) => change.operation), ['upsert'])
  assert.deepEqual(delayedCreate.productCommitted, [])

  await coordinator.persist(1_700_000_020_000)
  const snapshot = store.current()
  assert.ok(snapshot)
  assert.deepEqual(snapshot.deletedItemIds, [itemId])
  assert.equal(validDirectFirstPersistentState(snapshot), true)

  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const laterReplay = restored.receive(upsert(creator, 2, 'b'))
  assert.deepEqual(laterReplay.committed.map((change) => change.authorSequence), [2])
  assert.deepEqual(laterReplay.productCommitted, [])
})

test('delete local evita que un upsert pendiente antiguo vuelva a fallback cloud tras reinicio', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const original = upsert(local, 1, 'c')
  const removed = deletion(local, 2, 'e')

  assert.equal(coordinator.rememberOutbound(original, [peer]), true)
  assert.equal(coordinator.rememberOutbound(removed, [peer], {
    deleteFallbackSeedText: 'texto directo',
  }), true)

  assert.deepEqual(
    coordinator.pendingCloudFallbackChanges([]).map(({ change }) => change.operation),
    ['delete'],
  )

  await coordinator.persist(1_700_000_030_000)
  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  assert.deepEqual(
    restored.pendingCloudFallbackChanges([]).map(({ change }) => change.operation),
    ['delete'],
  )
})

test('transporte publica solo productCommitted y no el committed protocolario', () => {
  const source = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')
  assert.match(source, /for \(const envelope of result\.productCommitted\)/)
  assert.doesNotMatch(source, /for \(const envelope of result\.committed\)/)
})
