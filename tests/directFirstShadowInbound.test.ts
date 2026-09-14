import assert from 'node:assert/strict'
import test from 'node:test'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import { DirectFirstShadowInbound } from '../src/transport/directFirstShadowInbound.ts'

const roomId = 'room_general_1234'
const local = 'dev_localabcdefghijk'
const remote = 'dev_remoteabcdefghij'
const itemId = 'itm_0123456789abcdef0123456789abcdef'

function upsert(authorSequence: number, suffix = 'a') {
  return {
    sequence: 100 + authorSequence,
    type: 'upsert' as const,
    item: {
      sequence: 50 + authorSequence,
      id: authorSequence === 1 ? itemId : `itm_${suffix.repeat(32)}`,
      authorPersonId: 'per_abcdefghijklmnop',
      authorDeviceId: remote,
      text: `texto ${authorSequence}`,
      createdAt: 1_700_000_000_000 + authorSequence,
      expiresAt: 1_700_000_100_000 + authorSequence,
    },
    directFirstPrep: {
      version: 1 as const,
      changeId: `chg_${suffix.repeat(20)}`,
      authorDeviceId: remote,
      authorSequence,
      createdAt: 1_700_000_000_000 + authorSequence,
    },
  }
}

function deletion(authorSequence: number, suffix = 'd') {
  return {
    sequence: 200 + authorSequence,
    type: 'delete' as const,
    itemId,
    directFirstPrep: {
      version: 1 as const,
      changeId: `chg_${suffix.repeat(20)}`,
      authorDeviceId: remote,
      authorSequence,
      createdAt: 1_700_000_000_000 + authorSequence,
    },
  }
}

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    snapshot() { return value ? structuredClone(value) : null },
  }
}

test('upsert LAN con metadata direct-first se persiste antes de producir ACK exacto', async () => {
  const store = memoryStore()
  const inbound = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )

  const result = await inbound.receiveUpsert(roomId, local, upsert(1), remote)

  assert.equal(result?.decision, 'next')
  assert.equal(result?.committed.length, 1)
  assert.equal(result?.authorDeviceId, remote)
  assert.deepEqual(result?.acks, [{
    version: 1,
    type: 'ack',
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: remote,
    authorSequence: 1,
  }])
  const persisted = store.snapshot()
  assert.deepEqual(persisted?.ledger.lastSequenceByAuthor, [[remote, 1]])
  assert.equal(persisted?.replayLogs[0].changes[0].itemId, itemId)
})

test('delete LAN queda durable antes del ACK y comparte continuidad con upsert del mismo autor', async () => {
  const store = memoryStore()
  const inbound = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )
  await inbound.receiveUpsert(roomId, local, upsert(1), remote)

  const result = await inbound.receiveDelete(roomId, local, remote, deletion(2, 'b'))

  assert.equal(result?.decision, 'next')
  assert.deepEqual(result?.acks.map((ack) => ack.authorSequence), [2])
  const persisted = store.snapshot()
  assert.deepEqual(persisted?.ledger.lastSequenceByAuthor, [[remote, 2]])
  const last = persisted?.replayLogs[0].changes.at(-1)
  assert.equal(last?.operation, 'delete')
  assert.equal(last?.itemId, itemId)
  assert.equal(last?.text, undefined)
})

test('delete duplicado después de reinicio reemite ACK sin duplicar aplicación', async () => {
  const store = memoryStore()
  const first = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )
  await first.receiveDelete(roomId, local, remote, deletion(1))

  const restored = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )
  const duplicate = await restored.receiveDelete(roomId, local, remote, deletion(1))

  assert.equal(duplicate?.decision, 'duplicate')
  assert.equal(duplicate?.committed.length, 0)
  assert.equal(duplicate?.acks.length, 1)
  assert.deepEqual(store.snapshot()?.ledger.lastSequenceByAuthor, [[remote, 1]])
})

test('reinicio restaura idempotencia y reemite ACK del mismo cambio duplicado', async () => {
  const store = memoryStore()
  const first = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )
  await first.receiveUpsert(roomId, local, upsert(1), remote)

  const restored = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )
  const duplicate = await restored.receiveUpsert(roomId, local, upsert(1), remote)

  assert.equal(duplicate?.decision, 'duplicate')
  assert.equal(duplicate?.committed.length, 0)
  assert.equal(duplicate?.acks.length, 1)
  assert.equal(duplicate?.acks[0].changeId, 'chg_aaaaaaaaaaaaaaaaaaaa')
  assert.deepEqual(store.snapshot()?.ledger.lastSequenceByAuthor, [[remote, 1]])
})

test('gap no se confirma hasta quedar continuo y luego produce los ACKs pendientes en orden', async () => {
  const store = memoryStore()
  const inbound = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )

  const gap = await inbound.receiveUpsert(roomId, local, upsert(3, 'c'), remote)
  assert.equal(gap?.decision, 'gap')
  assert.deepEqual(gap?.acks, [])
  assert.equal(store.snapshot()?.gapBuffer.changes.length, 1)

  const first = await inbound.receiveUpsert(roomId, local, upsert(1, 'a'), remote)
  assert.deepEqual(first?.acks.map((ack) => ack.authorSequence), [1])

  const second = await inbound.receiveUpsert(roomId, local, upsert(2, 'b'), remote)
  assert.deepEqual(second?.committed.map((change) => change.authorSequence), [2, 3])
  assert.deepEqual(second?.acks.map((ack) => ack.authorSequence), [2, 3])
  assert.equal(store.snapshot()?.gapBuffer.changes.length, 0)
  assert.deepEqual(store.snapshot()?.ledger.lastSequenceByAuthor, [[remote, 3]])
})

test('autor de metadata distinto al autor autenticado del upsert se ignora sin tocar checkpoint', async () => {
  let loads = 0
  const store = memoryStore()
  const inbound = new DirectFirstShadowInbound(async (room, device) => {
    loads += 1
    return DirectFirstPrepCoordinator.load(room, device, store)
  })
  const change = upsert(1)
  change.directFirstPrep.authorDeviceId = 'dev_otherabcdefghijk'

  assert.equal(await inbound.receiveUpsert(roomId, local, change, remote), null)
  assert.equal(loads, 0)
  assert.equal(store.snapshot(), null)
})

test('delete shadow exige que el autor de metadata sea el peer autenticado del DataChannel', async () => {
  let loads = 0
  const store = memoryStore()
  const inbound = new DirectFirstShadowInbound(async (room, device) => {
    loads += 1
    return DirectFirstPrepCoordinator.load(room, device, store)
  })

  assert.equal(await inbound.receiveDelete(
    roomId,
    local,
    'dev_otherabcdefghijk',
    deletion(1),
  ), null)
  assert.equal(loads, 0)
  assert.equal(store.snapshot(), null)
})

test('fallo al persistir no puede producir ACK y permite reintentar el mismo cambio como next', async () => {
  let persisted: DirectFirstPersistentState | null = null
  let failNextWrite = true
  const store = {
    async read() { return persisted ? structuredClone(persisted) : null },
    async write(snapshot: DirectFirstPersistentState) {
      if (failNextWrite) {
        failNextWrite = false
        throw new Error('fallo simulado')
      }
      persisted = structuredClone(snapshot)
    },
  }
  const inbound = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )

  await assert.rejects(() => inbound.receiveUpsert(roomId, local, upsert(1), remote), /fallo simulado/)
  const retry = await inbound.receiveUpsert(roomId, local, upsert(1), remote)

  assert.equal(retry?.decision, 'next')
  assert.equal(retry?.acks.length, 1)
  assert.deepEqual(persisted?.ledger.lastSequenceByAuthor, [[remote, 1]])
})
