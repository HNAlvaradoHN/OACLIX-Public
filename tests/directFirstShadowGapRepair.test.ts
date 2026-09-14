import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validLanDirectFirstGapRequest,
  validLanDirectFirstReplay,
} from '../src/realtime/lanDirectFirstRepair.ts'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import { DirectFirstShadowInbound } from '../src/transport/directFirstShadowInbound.ts'
import { DirectFirstShadowOutbound } from '../src/transport/directFirstShadowOutbound.ts'

const roomId = 'room_general_1234'
const senderId = 'dev_senderabcdefghij'
const receiverId = 'dev_receiverabcdefgh'
const personId = 'per_abcdefghijklmnop'
const itemIds = [
  'itm_11111111111111111111111111111111',
  'itm_22222222222222222222222222222222',
  'itm_33333333333333333333333333333333',
]

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    snapshot() { return value ? structuredClone(value) : null },
  }
}

function item(index: number) {
  return {
    sequence: index + 1,
    id: itemIds[index],
    authorPersonId: personId,
    authorDeviceId: senderId,
    text: `texto-${index + 1}`,
    createdAt: 1_700_000_000_000 + index,
    expiresAt: 1_700_000_100_000 + index,
  }
}

test('gap shadow pide solo el rango faltante y lo repara desde replay persistido tras reinicio', async () => {
  const senderStore = memoryStore()
  const receiverStore = memoryStore()
  let changeNumber = 0
  const outbound = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, senderStore),
    () => `chg_${String(++changeNumber).padStart(20, 'a')}`,
  )
  const inbound = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, receiverStore),
  )

  const metadata = []
  for (let index = 0; index < 3; index += 1) {
    const prepared = await outbound.prepareUpsert(roomId, item(index), [receiverId])
    assert.ok(prepared)
    metadata.push(prepared)
  }

  const first = await inbound.receiveUpsert(roomId, receiverId, {
    sequence: 101,
    type: 'upsert',
    item: item(0),
    directFirstPrep: metadata[0],
  }, senderId)
  assert.equal(first?.decision, 'next')
  assert.equal(first?.repairRequest, null)

  const third = await inbound.receiveUpsert(roomId, receiverId, {
    sequence: 103,
    type: 'upsert',
    item: item(2),
    directFirstPrep: metadata[2],
  }, senderId)
  assert.equal(third?.decision, 'gap')
  assert.deepEqual(third?.repairRequest, {
    version: 1,
    type: 'gap-request',
    authorDeviceId: senderId,
    afterSequence: 1,
    throughSequence: 2,
  })
  assert.equal(validLanDirectFirstGapRequest(third?.repairRequest), true)
  assert.equal(receiverStore.snapshot()?.gapBuffer.changes.length, 1)

  const restoredInbound = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, receiverStore),
  )
  const restoredRequest = await restoredInbound.pendingRepairRequest(roomId, receiverId, senderId)
  assert.deepEqual(restoredRequest, third?.repairRequest)

  assert.ok(restoredRequest)
  const replay = await outbound.replay(roomId, senderId, restoredRequest)
  assert.ok(replay)
  assert.deepEqual(replay.map((change) => change.authorSequence), [2])

  const replayMessage = {
    version: 1 as const,
    type: 'replay-change' as const,
    throughSequence: restoredRequest.throughSequence,
    change: replay[0],
  }
  assert.equal(validLanDirectFirstReplay(replayMessage), true)

  const repaired = await restoredInbound.receiveReplay(roomId, receiverId, senderId, replayMessage)
  assert.deepEqual(repaired?.committed.map((change) => change.authorSequence), [2, 3])
  assert.deepEqual(repaired?.acks.map((ack) => ack.authorSequence), [2, 3])
  assert.equal(repaired?.repairRequest, null)
  assert.deepEqual(receiverStore.snapshot()?.ledger.lastSequenceByAuthor, [[senderId, 3]])
  assert.deepEqual(receiverStore.snapshot()?.gapBuffer.changes, [])

  assert.ok(first)
  for (const ack of [...first.acks, ...(repaired?.acks ?? [])]) {
    assert.equal(await outbound.acknowledge(roomId, senderId, receiverId, ack), true)
  }
  assert.equal(senderStore.snapshot()?.deliveries.every((delivery) => delivery.pendingDeviceIds.length === 0), true)
})

test('replay wire rechaza rangos sobredimensionados y autores inconsistentes', () => {
  assert.equal(validLanDirectFirstGapRequest({
    version: 1,
    type: 'gap-request',
    authorDeviceId: senderId,
    afterSequence: 1,
    throughSequence: 258,
  }), false)

  assert.equal(validLanDirectFirstReplay({
    version: 1,
    type: 'replay-change',
    throughSequence: 1,
    change: {
      version: 1,
      changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
      authorDeviceId: senderId,
      authorSequence: 2,
      itemId: itemIds[0],
      operation: 'delete',
      createdAt: 1_700_000_000_000,
    },
  }), false)
})
