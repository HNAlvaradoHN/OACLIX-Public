import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validLanDirectFirstBaselineMessage,
  validLanDirectFirstGapRequest,
} from '../src/realtime/lanDirectFirstRepair.ts'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import { DirectFirstShadowInbound } from '../src/transport/directFirstShadowInbound.ts'

const roomId = 'room_general_1234'
const local = 'dev_localabcdefghijk'
const remote = 'dev_remoteabcdefghij'
const itemId = 'itm_0123456789abcdef0123456789abcdef'

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    snapshot() { return value ? structuredClone(value) : null },
  }
}

function directUpsert(authorSequence: number) {
  const createdAt = Date.now()
  return {
    sequence: authorSequence,
    type: 'upsert' as const,
    directOnly: true as const,
    item: {
      sequence: authorSequence,
      id: itemId,
      authorPersonId: 'per_abcdefghijklmnop',
      authorDeviceId: remote,
      text: 'primer texto posterior al vínculo',
      createdAt,
      expiresAt: createdAt + 21_600_000,
      directOnly: true as const,
    },
    directFirstPrep: {
      version: 1 as const,
      changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
      authorDeviceId: remote,
      authorSequence,
      createdAt,
    },
  }
}

test('un ledger vacío pide baseline completo aunque la secuencia previa exceda 256', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const envelope = {
    version: 1 as const,
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: remote,
    authorSequence: 700,
    itemId,
    operation: 'upsert' as const,
    text: 'posterior al vínculo',
    createdAt: 1_700_000_000_000,
    directOnly: true as const,
    authorPersonId: 'per_abcdefghijklmnop',
    expiresAt: 1_700_021_600_000,
  }

  assert.equal(coordinator.receive(envelope).decision, 'gap')
  assert.deepEqual(coordinator.pendingGapRequest(remote), {
    version: 1,
    type: 'gap-request',
    authorDeviceId: remote,
    afterSequence: 0,
    throughSequence: 699,
  })
})

test('baseline se persiste antes del ACK y libera el primer cambio futuro bufferizado', async () => {
  const store = memoryStore()
  const inbound = new DirectFirstShadowInbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
  )

  const gap = await inbound.receiveUpsert(roomId, local, directUpsert(700), remote)
  assert.equal(gap?.decision, 'gap')
  assert.deepEqual(gap?.acks, [])
  assert.equal(gap?.repairRequest?.afterSequence, 0)
  assert.equal(gap?.repairRequest?.throughSequence, 699)

  const baseline = await inbound.receiveBaseline(roomId, local, remote, {
    version: 1,
    type: 'baseline',
    authorDeviceId: remote,
    throughSequence: 699,
  })

  assert.equal(baseline?.accepted, true)
  assert.deepEqual(baseline?.productCommitted.map((change) => change.authorSequence), [700])
  assert.deepEqual(baseline?.acks.map((ack) => ack.authorSequence), [700])
  assert.equal(baseline?.repairRequest, null)
  assert.deepEqual(store.snapshot()?.ledger.lastSequenceByAuthor, [[remote, 700]])
  assert.deepEqual(store.snapshot()?.gapBuffer.changes, [])
})

test('baseline no puede saltar un ledger que ya tiene historia durable', async () => {
  const store = memoryStore()
  const coordinator = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const first = directUpsert(1)
  const envelope = {
    version: 1 as const,
    changeId: first.directFirstPrep.changeId,
    authorDeviceId: remote,
    authorSequence: 1,
    itemId,
    operation: 'upsert' as const,
    text: first.item.text,
    createdAt: first.item.createdAt,
    directOnly: true as const,
    authorPersonId: first.item.authorPersonId,
    expiresAt: first.item.expiresAt,
  }
  assert.equal(coordinator.receive(envelope).decision, 'next')

  const later = {
    ...envelope,
    changeId: 'chg_bbbbbbbbbbbbbbbbbbbb',
    authorSequence: 400,
    itemId: 'itm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  }
  assert.equal(coordinator.receive(later).decision, 'gap')
  const request = coordinator.pendingGapRequest(remote)
  assert.equal(request?.afterSequence, 1)
  assert.equal(request?.throughSequence, 257)
  assert.deepEqual(coordinator.receiveBaseline(remote, 399), {
    accepted: false,
    committed: [],
    productCommitted: [],
  })
})

test('wire permite baseline lejano solo para receptor sin historial', () => {
  assert.equal(validLanDirectFirstGapRequest({
    version: 1,
    type: 'gap-request',
    authorDeviceId: remote,
    afterSequence: 0,
    throughSequence: 699,
  }), true)
  assert.equal(validLanDirectFirstGapRequest({
    version: 1,
    type: 'gap-request',
    authorDeviceId: remote,
    afterSequence: 1,
    throughSequence: 699,
  }), false)

  assert.equal(validLanDirectFirstBaselineMessage({
    type: 'direct-first-baseline',
    targetDeviceId: local,
    baseline: {
      version: 1,
      type: 'baseline',
      authorDeviceId: remote,
      throughSequence: 699,
    },
  }), true)
  assert.equal(validLanDirectFirstBaselineMessage({
    type: 'direct-first-baseline',
    targetDeviceId: remote,
    baseline: {
      version: 1,
      type: 'baseline',
      authorDeviceId: remote,
      throughSequence: 699,
    },
  }), false)
})
