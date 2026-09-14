import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudClipboardBoundary, type CloudContentWriteEvent } from '../src/transport/cloudClipboardBoundary.ts'
import { DirectFirstCloudCopyGate } from '../src/transport/directFirstCloudCopyGate.ts'
import {
  executeDirectFirstCloudFallback,
  planDirectFirstCloudFallback,
} from '../src/transport/directFirstCloudFallbackPlan.ts'
import { decideDirectFirstCoverage } from '../src/transport/directFirstCoverage.ts'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const peerDirect = 'dev_qrstuvwxyzabcdef'
const peerCloud = 'dev_ghijklmnopqrstuv'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const createdAt = 1_700_000_000_000
const expiresAt = createdAt + 100_000
const now = createdAt + 10_000

function upsert(): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: local,
    authorSequence: 1,
    itemId,
    operation: 'upsert',
    text: 'texto directo',
    createdAt,
  }
}

function deletion(): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: 'chg_bbbbbbbbbbbbbbbbbbbb',
    authorDeviceId: local,
    authorSequence: 2,
    itemId,
    operation: 'delete',
    createdAt: createdAt + 100,
  }
}

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
  }
}

function cloudHarness() {
  const operations: string[] = []
  const boundary = createCloudClipboardBoundary({
    async createText(_room: string, text: string) {
      operations.push(`auto:${text}`)
      return { ok: true }
    },
    async createTextWithItemId(_room: string, id: string, text: string) {
      operations.push(`create:${id}:${text}`)
      return { ok: true }
    },
    async createTextWithOriginalExpiry(_room: string, id: string, text: string, expiry: number) {
      operations.push(`create:${id}:${text}:${expiry}`)
      return { ok: true }
    },
    async deleteText(_room: string, id: string) {
      operations.push(`delete:${id}`)
      return { ok: true }
    },
    async listChanges() {
      return { changes: [] }
    },
  })
  const events: CloudContentWriteEvent[] = []
  boundary.subscribeContentWrites((event) => events.push(event))
  return { boundary, operations, events }
}

test('all-direct queda en cero escrituras y transición mixed crea una sola copia estable', async () => {
  const cloud = cloudHarness()
  const gate = new DirectFirstCloudCopyGate()
  const change = upsert()

  const allDirect = decideDirectFirstCoverage({
    requiredDeviceIds: [peerDirect],
    directDeviceIds: [peerDirect],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })
  const mixed = decideDirectFirstCoverage({
    requiredDeviceIds: [peerDirect, peerCloud],
    directDeviceIds: [peerDirect],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })

  const persist = async () => {
    await cloud.boundary.createTextWithItemId(roomId, change.itemId, change.text ?? '')
  }

  assert.equal(await gate.ensureRequiredCloudCopy(allDirect, persist), false)
  assert.deepEqual(cloud.operations, [])
  assert.deepEqual(cloud.events, [])

  assert.equal(await gate.ensureRequiredCloudCopy(mixed, persist), true)
  const restoredGate = DirectFirstCloudCopyGate.restore(gate.snapshot())
  assert.equal(await restoredGate.ensureRequiredCloudCopy(mixed, persist), false)

  assert.deepEqual(cloud.operations, [`create:${itemId}:texto directo`])
  assert.equal(cloud.events.filter((event) => event.phase === 'attempt').length, 1)
})

test('delete direct-only conserva semilla completa tras reinicio y resuelve fallback sin inventar otro item', async () => {
  const store = memoryStore()
  const first = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const change = deletion()
  first.rememberOutbound(
    change,
    [peerDirect],
    {
      deleteFallbackSeed: {
        text: 'texto directo',
        createdAt,
        expiresAt,
      },
    },
  )
  await first.persist(createdAt + 500)

  const restored = await DirectFirstPrepCoordinator.load(roomId, local, store)
  const seed = restored.cloudFallbackSeed(change.changeId, change.itemId)
  assert.deepEqual(seed, { text: 'texto directo', createdAt, expiresAt })

  const plan = planDirectFirstCloudFallback({
    change,
    cloudCopyKnown: false,
    deleteSeed: seed,
    now,
  })
  const cloud = cloudHarness()
  await executeDirectFirstCloudFallback(roomId, plan, cloud.boundary)
  restored.releaseCloudFallbackSeed(change.changeId)

  assert.deepEqual(cloud.operations, [
    `create:${itemId}:texto directo:${expiresAt}`,
    `delete:${itemId}`,
  ])
  assert.equal(restored.cloudFallbackSeed(change.changeId, itemId), undefined)
})
