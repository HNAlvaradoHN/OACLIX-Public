import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudClipboardBoundary, type CloudContentWriteEvent } from '../src/transport/cloudClipboardBoundary.ts'
import { DirectFirstCloudCopyGate } from '../src/transport/directFirstCloudCopyGate.ts'
import { decideDirectFirstCoverage } from '../src/transport/directFirstCoverage.ts'

const roomId = 'room_general_1234'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const deviceA = 'dev_abcdefghijklmnop'
const deviceB = 'dev_qrstuvwxyzabcdef'

function createResult(id: string, text: string) {
  return {
    version: 1 as const,
    item: {
      sequence: 1,
      id,
      authorPersonId: 'per_test',
      authorDeviceId: deviceA,
      text,
      createdAt: 100,
      expiresAt: 200,
    },
    created: true,
    changeSequence: 1,
  }
}

function fakeDelegate() {
  let createCalls = 0
  let stableCreateCalls = 0
  let expiryCreateCalls = 0
  let deleteCalls = 0
  let listCalls = 0
  const stableItemIds: string[] = []
  const expiryRequests: Array<{ id: string; expiresAt: number }> = []

  return {
    delegate: {
      async createText(_room: string, text: string) {
        createCalls += 1
        return createResult(itemId, text)
      },
      async createTextWithItemId(_room: string, id: string, text: string) {
        stableCreateCalls += 1
        stableItemIds.push(id)
        return createResult(id, text)
      },
      async createTextWithOriginalExpiry(_room: string, id: string, text: string, expiresAt: number) {
        expiryCreateCalls += 1
        expiryRequests.push({ id, expiresAt })
        return createResult(id, text)
      },
      async deleteText(_room: string, id: string) {
        deleteCalls += 1
        return {
          version: 1 as const,
          itemId: id,
          deleted: true,
          deletedAt: 300,
          changeSequence: 2,
        }
      },
      async listChanges() {
        listCalls += 1
        return {
          version: 1 as const,
          changes: [],
          nextCursor: 0,
          hasMore: false,
        }
      },
    },
    counts() {
      return { createCalls, stableCreateCalls, expiryCreateCalls, deleteCalls, listCalls }
    },
    stableItemIds() {
      return [...stableItemIds]
    },
    expiryRequests() {
      return [...expiryRequests]
    },
  }
}

test('frontera productiva observa solo escrituras de contenido cloud', async () => {
  const fake = fakeDelegate()
  const boundary = createCloudClipboardBoundary(fake.delegate)
  const events: CloudContentWriteEvent[] = []
  const unsubscribe = boundary.subscribeContentWrites((event) => events.push(event))

  await boundary.listChanges(roomId, 0)
  assert.deepEqual(events, [])

  await boundary.createText(roomId, 'hola')
  await boundary.deleteText(roomId, itemId)
  unsubscribe()

  assert.deepEqual(fake.counts(), { createCalls: 1, stableCreateCalls: 0, expiryCreateCalls: 0, deleteCalls: 1, listCalls: 1 })
  assert.deepEqual(events.map((event) => [event.operation, event.phase]), [
    ['create-text', 'attempt'],
    ['create-text', 'success'],
    ['delete-text', 'attempt'],
    ['delete-text', 'success'],
  ])
})

test('create estable conserva exactamente el itemId del cambio directo', async () => {
  const fake = fakeDelegate()
  const boundary = createCloudClipboardBoundary(fake.delegate)
  const events: CloudContentWriteEvent[] = []
  boundary.subscribeContentWrites((event) => events.push(event))

  const result = await boundary.createTextWithItemId(roomId, itemId, 'fallback')

  assert.equal(result.item.id, itemId)
  assert.deepEqual(fake.stableItemIds(), [itemId])
  assert.deepEqual(events.map((event) => [event.phase, event.itemId]), [
    ['attempt', itemId],
    ['success', itemId],
  ])
})

test('variante de fallback transporta la expiración original sin alterar create estable', async () => {
  const fake = fakeDelegate()
  const boundary = createCloudClipboardBoundary(fake.delegate)
  const expiresAt = 1_700_000_021_600

  await boundary.createTextWithOriginalExpiry(roomId, itemId, 'fallback', expiresAt)

  assert.deepEqual(fake.expiryRequests(), [{ id: itemId, expiresAt }])
  assert.equal(fake.counts().stableCreateCalls, 0)
  assert.equal(fake.counts().expiryCreateCalls, 1)
})

test('fallo cloud queda observable sin convertirlo en éxito', async () => {
  const fake = fakeDelegate()
  fake.delegate.createText = async () => {
    throw new Error('cloud caída')
  }
  const boundary = createCloudClipboardBoundary(fake.delegate)
  const phases: string[] = []
  boundary.subscribeContentWrites((event) => phases.push(event.phase))

  await assert.rejects(boundary.createText(roomId, 'x'), /cloud caída/)
  assert.deepEqual(phases, ['attempt', 'failure'])
})

test('gate all-direct no cruza la misma frontera cloud usada por producción', async () => {
  const fake = fakeDelegate()
  const boundary = createCloudClipboardBoundary(fake.delegate)
  const events: CloudContentWriteEvent[] = []
  boundary.subscribeContentWrites((event) => events.push(event))
  const gate = new DirectFirstCloudCopyGate()

  const allDirect = decideDirectFirstCoverage({
    requiredDeviceIds: [deviceA, deviceB],
    directDeviceIds: [deviceA, deviceB],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })

  const persisted = await gate.ensureRequiredCloudCopy(
    allDirect,
    async () => { await boundary.createTextWithItemId(roomId, itemId, 'no debe llegar a cloud') },
  )

  assert.equal(persisted, false)
  assert.equal(fake.counts().stableCreateCalls, 0)
  assert.deepEqual(events, [])
})

test('gate mixed cruza la frontera cloud una sola vez con itemId estable', async () => {
  const fake = fakeDelegate()
  const boundary = createCloudClipboardBoundary(fake.delegate)
  const gate = new DirectFirstCloudCopyGate()
  const attempts: CloudContentWriteEvent[] = []
  boundary.subscribeContentWrites((event) => {
    if (event.phase === 'attempt') attempts.push(event)
  })

  const mixed = decideDirectFirstCoverage({
    requiredDeviceIds: [deviceA, deviceB],
    directDeviceIds: [deviceA],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })
  const cloudOnly = decideDirectFirstCoverage({
    requiredDeviceIds: [deviceA, deviceB],
    directDeviceIds: [],
    cloudAvailable: true,
    cloudFallbackAllowed: true,
  })
  const persist = async () => { await boundary.createTextWithItemId(roomId, itemId, 'una copia') }

  await gate.ensureRequiredCloudCopy(mixed, persist)
  await gate.ensureRequiredCloudCopy(cloudOnly, persist)

  assert.equal(fake.counts().stableCreateCalls, 1)
  assert.deepEqual(fake.stableItemIds(), [itemId])
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0]?.itemId, itemId)
})
