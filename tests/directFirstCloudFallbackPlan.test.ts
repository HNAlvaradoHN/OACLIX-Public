import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudClipboardBoundary, type CloudContentWriteEvent } from '../src/transport/cloudClipboardBoundary.ts'
import {
  executeDirectFirstCloudFallback,
  planDirectFirstCloudFallback,
} from '../src/transport/directFirstCloudFallbackPlan.ts'
import type { DirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'

const roomId = 'room_general_1234'
const deviceId = 'dev_abcdefghijklmnop'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const createdAt = 1_700_000_000_000
const expiresAt = createdAt + 21_600_000
const now = createdAt + 10_000

function upsert(): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: deviceId,
    authorSequence: 1,
    itemId,
    operation: 'upsert',
    text: 'contenido original',
    createdAt,
    directOnly: true,
    authorPersonId: 'per_abcdefghijklmnop',
    expiresAt,
  }
}

function deletion(): DirectChangeEnvelope {
  return {
    version: 1,
    changeId: 'chg_bbbbbbbbbbbbbbbbbbbb',
    authorDeviceId: deviceId,
    authorSequence: 2,
    itemId,
    operation: 'delete',
    createdAt: createdAt + 100,
    directOnly: true,
  }
}

function boundaryHarness() {
  const operations: string[] = []
  const delegate = {
    async createText(_room: string, text: string) {
      operations.push(`auto:${text}`)
      return { ok: true }
    },
    async createTextWithItemId(_room: string, id: string, text: string) {
      operations.push(`create-default:${id}:${text}`)
      return { ok: true }
    },
    async createTextWithOriginalExpiry(_room: string, id: string, text: string, expiry: number) {
      operations.push(`create-original:${id}:${text}:${expiry}`)
      return { ok: true }
    },
    async deleteText(_room: string, id: string) {
      operations.push(`delete:${id}`)
      return { ok: true }
    },
    async listChanges() {
      return { changes: [] }
    },
  }
  const boundary = createCloudClipboardBoundary(delegate)
  const events: CloudContentWriteEvent[] = []
  boundary.subscribeContentWrites((event) => events.push(event))
  return { boundary, operations, events }
}

test('upsert sin copia cloud conserva una sola copia con expiración original', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({ change: upsert(), cloudCopyKnown: false, now })

  assert.deepEqual(plan, {
    status: 'ready',
    steps: [{ type: 'create-text', itemId, text: 'contenido original', expiresAt }],
  })

  await executeDirectFirstCloudFallback(roomId, plan, harness.boundary)
  assert.deepEqual(harness.operations, [`create-original:${itemId}:contenido original:${expiresAt}`])
  assert.equal(harness.events.filter((event) => event.phase === 'attempt').length, 1)
})

test('upsert vencido no renace en cloud', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({ change: upsert(), cloudCopyKnown: false, now: expiresAt })

  assert.deepEqual(plan, { status: 'expired', steps: [] })
  await executeDirectFirstCloudFallback(roomId, plan, harness.boundary)
  assert.deepEqual(harness.operations, [])
  assert.deepEqual(harness.events, [])
})

test('upsert con metadata de expiración inválida falla cerrado', () => {
  const invalid = { ...upsert(), expiresAt: createdAt + 21_600_001 }
  const plan = planDirectFirstCloudFallback({ change: invalid, cloudCopyKnown: false, now })
  assert.deepEqual(plan, { status: 'blocked', reason: 'invalid-expiry' })
})

test('upsert con copia cloud conocida no vuelve a escribir contenido', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({ change: upsert(), cloudCopyKnown: true, now })

  assert.deepEqual(plan, { status: 'ready', steps: [] })
  await executeDirectFirstCloudFallback(roomId, plan, harness.boundary)
  assert.deepEqual(harness.operations, [])
  assert.deepEqual(harness.events, [])
})

test('delete con copia cloud conocida solo crea tombstone de borrado', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({ change: deletion(), cloudCopyKnown: true, now })

  assert.deepEqual(plan, {
    status: 'ready',
    steps: [{ type: 'delete-text', itemId }],
  })

  await executeDirectFirstCloudFallback(roomId, plan, harness.boundary)
  assert.deepEqual(harness.operations, [`delete:${itemId}`])
})

test('delete direct-only siembra con expiración original y borra el mismo itemId', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({
    change: deletion(),
    cloudCopyKnown: false,
    deleteSeed: { text: 'contenido original', createdAt, expiresAt },
    now,
  })

  assert.deepEqual(plan, {
    status: 'ready',
    steps: [
      { type: 'create-text', itemId, text: 'contenido original', expiresAt },
      { type: 'delete-text', itemId },
    ],
  })

  await executeDirectFirstCloudFallback(roomId, plan, harness.boundary)
  assert.deepEqual(harness.operations, [
    `create-original:${itemId}:contenido original:${expiresAt}`,
    `delete:${itemId}`,
  ])
})

test('delete direct-only vencido no crea semilla fresca ni toca cloud', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({
    change: deletion(),
    cloudCopyKnown: false,
    deleteSeed: { text: 'contenido original', createdAt, expiresAt },
    now: expiresAt,
  })

  assert.deepEqual(plan, { status: 'expired', steps: [] })
  await executeDirectFirstCloudFallback(roomId, plan, harness.boundary)
  assert.deepEqual(harness.operations, [])
})

test('delete vencido sigue resolviéndose aunque el texto ya fue depurado localmente', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({
    change: deletion(),
    cloudCopyKnown: false,
    deleteSeed: { text: '', createdAt, expiresAt },
    now: expiresAt + 1,
  })

  assert.deepEqual(plan, { status: 'expired', steps: [] })
  await executeDirectFirstCloudFallback(roomId, plan, harness.boundary)
  assert.deepEqual(harness.operations, [])
})

test('delete vigente nunca usa una semilla vacía', () => {
  const plan = planDirectFirstCloudFallback({
    change: deletion(),
    cloudCopyKnown: false,
    deleteSeed: { text: '', createdAt, expiresAt },
    now,
  })
  assert.deepEqual(plan, { status: 'blocked', reason: 'missing-delete-seed' })
})

test('delete direct-only sin contenido original falla cerrado', async () => {
  const harness = boundaryHarness()
  const plan = planDirectFirstCloudFallback({ change: deletion(), cloudCopyKnown: false, now })

  assert.deepEqual(plan, { status: 'blocked', reason: 'missing-delete-seed' })
  await assert.rejects(
    executeDirectFirstCloudFallback(roomId, plan, harness.boundary),
    /missing-delete-seed/,
  )
  assert.deepEqual(harness.operations, [])
})

test('delete legacy con texto pero sin metadata temporal falla cerrado', () => {
  const plan = planDirectFirstCloudFallback({
    change: deletion(),
    cloudCopyKnown: false,
    deleteSeed: { text: 'contenido original' },
    now,
  })
  assert.deepEqual(plan, { status: 'blocked', reason: 'invalid-expiry' })
})
