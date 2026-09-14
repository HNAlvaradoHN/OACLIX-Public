import assert from 'node:assert/strict'
import test from 'node:test'
import { validLanDirectFirstPrepMeta } from '../src/realtime/lanDirectFirstPrep.ts'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import { DirectFirstShadowOutbound } from '../src/transport/directFirstShadowOutbound.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'

function item(sequence = 1) {
  return {
    sequence,
    id: itemId,
    authorPersonId: 'per_abcdefghijklmnop',
    authorDeviceId: local,
    text: 'texto sombra directo',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_100_000,
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

test('upsert directo prepara y persiste checkpoint antes de adjuntar metadata al mensaje LAN existente', async () => {
  const store = memoryStore()
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => 'chg_aaaaaaaaaaaaaaaaaaaa',
  )

  const metadata = await bridge.prepareUpsert(roomId, item(), [peer])
  assert.ok(metadata)
  assert.equal(metadata.authorDeviceId, local)
  assert.equal(metadata.authorSequence, 1)
  assert.equal(validLanDirectFirstPrepMeta(metadata), true)

  const persisted = store.snapshot()
  assert.ok(persisted)
  assert.equal(persisted.deliveries.length, 1)
  assert.deepEqual(persisted.deliveries[0].pendingDeviceIds, [peer])
  assert.equal(persisted.deliveries[0].change.text, 'texto sombra directo')
})

test('delete shadow comparte secuencia de autor, queda durable sin contenido y espera ACK del peer', async () => {
  const store = memoryStore()
  let changeNumber = 0
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => `chg_${String(++changeNumber).padStart(20, 'e')}`,
  )

  await bridge.prepareUpsert(roomId, item(), [peer])
  const metadata = await bridge.prepareDelete(roomId, local, itemId, [peer])

  assert.ok(metadata)
  assert.equal(metadata.authorDeviceId, local)
  assert.equal(metadata.authorSequence, 2)
  assert.equal(validLanDirectFirstPrepMeta(metadata), true)

  const persisted = store.snapshot()
  const deletion = persisted?.deliveries.find((entry) => entry.change.changeId === metadata.changeId)
  assert.equal(deletion?.change.operation, 'delete')
  assert.equal(deletion?.change.itemId, itemId)
  assert.equal(deletion?.change.text, undefined)
  assert.deepEqual(deletion?.pendingDeviceIds, [peer])
  assert.equal(persisted?.replayLogs[0].changes.at(-1)?.operation, 'delete')
})

test('ACK exacto del destino mueve entrega a delivered y queda persistido', async () => {
  const store = memoryStore()
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => 'chg_aaaaaaaaaaaaaaaaaaaa',
  )
  await bridge.prepareUpsert(roomId, item(), [peer])

  const accepted = await bridge.acknowledge(roomId, local, peer, {
    version: 1,
    type: 'ack',
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: local,
    authorSequence: 1,
  })

  assert.equal(accepted, true)
  assert.deepEqual(store.snapshot()?.deliveries[0].pendingDeviceIds, [])
  assert.deepEqual(store.snapshot()?.deliveries[0].deliveredDeviceIds, [peer])
})

test('ACK de otro autor o destino desconocido no cambia el checkpoint', async () => {
  const store = memoryStore()
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => 'chg_aaaaaaaaaaaaaaaaaaaa',
  )
  await bridge.prepareUpsert(roomId, item(), [peer])

  assert.equal(await bridge.acknowledge(roomId, local, peer, {
    version: 1,
    type: 'ack',
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: 'dev_otherabcdefghijk',
    authorSequence: 1,
  }), false)
  assert.equal(await bridge.acknowledge(roomId, local, 'dev_unknownabcdefgh', {
    version: 1,
    type: 'ack',
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: local,
    authorSequence: 1,
  }), false)

  assert.deepEqual(store.snapshot()?.deliveries[0].pendingDeviceIds, [peer])
})

test('fallo al persistir ACK restaura pendiente para aceptar un ACK posterior', async () => {
  let persisted: DirectFirstPersistentState | null = null
  let failAckWrite = false
  const store = {
    async read() { return persisted ? structuredClone(persisted) : null },
    async write(snapshot: DirectFirstPersistentState) {
      if (failAckWrite) {
        failAckWrite = false
        throw new Error('fallo ACK')
      }
      persisted = structuredClone(snapshot)
    },
  }
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => 'chg_aaaaaaaaaaaaaaaaaaaa',
  )
  await bridge.prepareUpsert(roomId, item(), [peer])
  failAckWrite = true
  const ack = {
    version: 1 as const,
    type: 'ack' as const,
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: local,
    authorSequence: 1,
  }

  await assert.rejects(() => bridge.acknowledge(roomId, local, peer, ack), /fallo ACK/)
  assert.deepEqual(persisted?.deliveries[0].pendingDeviceIds, [peer])
  assert.equal(await bridge.acknowledge(roomId, local, peer, ack), true)
  assert.deepEqual(persisted?.deliveries[0].deliveredDeviceIds, [peer])
})

test('secuencia de autor sombra avanza desde el replay persistido sin depender del cursor cloud global', async () => {
  const store = memoryStore()
  let changeNumber = 0
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => `chg_${String(++changeNumber).padStart(20, 'b')}`,
  )

  const first = await bridge.prepareUpsert(roomId, item(7), [peer])
  const second = await bridge.prepareUpsert(roomId, { ...item(99), id: 'itm_fedcba9876543210fedcba9876543210' }, [peer])

  assert.equal(first?.authorSequence, 1)
  assert.equal(second?.authorSequence, 2)
  assert.equal(store.snapshot()?.replayLogs[0].changes.at(-1)?.authorSequence, 2)
})

test('fallo de persistencia no reserva una secuencia fantasma para el siguiente intento', async () => {
  let persisted: DirectFirstPersistentState | null = null
  let failNextWrite = true
  let changeNumber = 0
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
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => `chg_${String(++changeNumber).padStart(20, 'd')}`,
  )

  await assert.rejects(() => bridge.prepareUpsert(roomId, item(), [peer]), /fallo simulado/)
  const retry = await bridge.prepareUpsert(roomId, item(), [peer])

  assert.equal(retry?.authorSequence, 1)
  assert.equal(persisted?.replayLogs[0].changes[0].authorSequence, 1)
})

test('sin peers directos no crea checkpoint ni metadata', async () => {
  let loads = 0
  const store = memoryStore()
  const bridge = new DirectFirstShadowOutbound(
    async (room, device) => {
      loads += 1
      return DirectFirstPrepCoordinator.load(room, device, store)
    },
    () => 'chg_cccccccccccccccccccc',
  )

  assert.equal(await bridge.prepareUpsert(roomId, item(), []), null)
  assert.equal(await bridge.prepareDelete(roomId, local, itemId, []), null)
  assert.equal(loads, 0)
  assert.equal(store.snapshot(), null)
})

test('metadata direct-first inválida se rechaza en la frontera LAN preparatoria', () => {
  assert.equal(validLanDirectFirstPrepMeta({
    version: 1,
    changeId: 'mal',
    authorDeviceId: local,
    authorSequence: 1,
    createdAt: Date.now(),
  }), false)
})
