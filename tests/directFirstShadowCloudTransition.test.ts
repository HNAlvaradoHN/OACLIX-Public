import assert from 'node:assert/strict'
import test from 'node:test'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import { DirectFirstShadowOutbound } from '../src/transport/directFirstShadowOutbound.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const transitionNow = 1_700_000_001_000

function item() {
  return {
    sequence: 1,
    id: itemId,
    authorPersonId: 'per_abcdefghijklmnop',
    authorDeviceId: local,
    text: 'texto directo persistente',
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_100_000,
  }
}

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  let writeCount = 0
  let failAtWrite: number | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) {
      writeCount += 1
      if (failAtWrite === writeCount) {
        failAtWrite = null
        throw new Error('fallo checkpoint simulado')
      }
      value = structuredClone(snapshot)
    },
    failNextWrite() { failAtWrite = writeCount + 1 },
    failSecondNextWrite() { failAtWrite = writeCount + 2 },
    snapshot() { return value ? structuredClone(value) : null },
  }
}

function cloudHarness() {
  const live = new Map<string, { text: string; expiresAt: number }>()
  const used = new Set<string>()
  const deleted = new Set<string>()
  const attempts: string[] = []
  const logicalChanges: string[] = []

  return {
    boundary: {
      async createTextWithOriginalExpiry(_room: string, id: string, text: string, expiresAt: number) {
        attempts.push(`create:${id}`)
        const existing = live.get(id)
        if (existing !== undefined) {
          if (existing.text !== text || existing.expiresAt !== expiresAt) throw new Error('conflicto de item')
          return { created: false }
        }
        if (used.has(id)) throw new Error('itemId ya utilizado')
        live.set(id, { text, expiresAt })
        used.add(id)
        logicalChanges.push(`upsert:${id}`)
        return { created: true }
      },
      async deleteText(_room: string, id: string) {
        attempts.push(`delete:${id}`)
        if (live.has(id)) {
          live.delete(id)
          deleted.add(id)
          logicalChanges.push(`delete:${id}`)
          return { deleted: true }
        }
        if (deleted.has(id)) return { deleted: false }
        throw new Error('item no disponible')
      },
    },
    attempts,
    logicalChanges,
    live,
  }
}

function outbound(store: ReturnType<typeof memoryStore>) {
  let changeNumber = 0
  return new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => `chg_${String(++changeNumber).padStart(20, 'a')}`,
  )
}

async function ackPrepared(
  bridge: DirectFirstShadowOutbound,
  metadata: NonNullable<Awaited<ReturnType<DirectFirstShadowOutbound['prepareUpsert']>>>,
) {
  assert.equal(await bridge.acknowledge(roomId, local, peer, {
    version: 1,
    type: 'ack',
    changeId: metadata.changeId,
    authorDeviceId: local,
    authorSequence: metadata.authorSequence,
  }), true)
}

test('all-direct no escribe cloud y al perder directo crea una sola copia estable con expiración original', async () => {
  const store = memoryStore()
  const cloud = cloudHarness()
  const first = outbound(store)
  const metadata = await first.prepareUpsert(roomId, item(), [peer])
  assert.ok(metadata)

  const allDirect = await first.reconcileCloudTransition(roomId, local, [peer], true, cloud.boundary, transitionNow)
  assert.equal(allDirect.cloudWrites, 0)
  assert.deepEqual(cloud.attempts, [])

  const fallback = await first.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, transitionNow)
  assert.equal(fallback.cloudWrites, 1)
  assert.deepEqual(fallback.committedChangeIds, [metadata.changeId])
  assert.deepEqual(cloud.logicalChanges, [`upsert:${itemId}`])
  assert.equal(cloud.live.get(itemId)?.expiresAt, item().expiresAt)
  assert.deepEqual(store.snapshot()?.cloudKnownItemIds, [itemId])
  assert.deepEqual(store.snapshot()?.cloudCommittedChangeIds, [metadata.changeId])

  const restored = outbound(store)
  const afterRestart = await restored.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, transitionNow)
  assert.equal(afterRestart.cloudWrites, 0)
  assert.deepEqual(cloud.attempts, [`create:${itemId}`])
  assert.deepEqual(cloud.logicalChanges, [`upsert:${itemId}`])
})

test('upsert ya vencido cierra reconciliación sin crear contenido cloud y sigue terminal tras reinicio', async () => {
  const store = memoryStore()
  const cloud = cloudHarness()
  const first = outbound(store)
  const metadata = await first.prepareUpsert(roomId, item(), [peer])
  assert.ok(metadata)

  const expired = await first.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, item().expiresAt)
  assert.equal(expired.cloudWrites, 0)
  assert.deepEqual(expired.expiredChangeIds, [metadata.changeId])
  assert.deepEqual(cloud.attempts, [])
  assert.equal(store.snapshot()?.cloudKnownItemIds?.includes(itemId) ?? false, false)
  assert.deepEqual(store.snapshot()?.cloudCommittedChangeIds, [metadata.changeId])

  const restored = outbound(store)
  const retry = await restored.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, item().expiresAt + 1)
  assert.equal(retry.cloudWrites, 0)
  assert.deepEqual(cloud.attempts, [])
})

test('cloud-first productivo queda marcado como comprometido y el observador no duplica la escritura', async () => {
  const store = memoryStore()
  const cloud = cloudHarness()
  const bridge = outbound(store)
  const metadata = await bridge.prepareUpsert(roomId, item(), [peer], { cloudCommitted: true })
  assert.ok(metadata)

  const result = await bridge.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, transitionNow)
  assert.equal(result.cloudWrites, 0)
  assert.deepEqual(cloud.attempts, [])
  assert.deepEqual(store.snapshot()?.cloudCommittedChangeIds, [metadata.changeId])
})

test('delete direct-only recupera cierre después de crear semilla pero antes de persistirla', async () => {
  const store = memoryStore()
  const cloud = cloudHarness()
  const bridge = outbound(store)
  const upsert = await bridge.prepareUpsert(roomId, item(), [peer])
  assert.ok(upsert)
  await ackPrepared(bridge, upsert)

  const deletion = await bridge.prepareDelete(roomId, local, itemId, [peer])
  assert.ok(deletion)
  assert.deepEqual(store.snapshot()?.cloudFallbackSeeds?.[0], {
    changeId: deletion.changeId,
    itemId,
    text: item().text,
    createdAt: item().createdAt,
    expiresAt: item().expiresAt,
  })

  store.failNextWrite()
  await assert.rejects(
    () => bridge.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, transitionNow),
    /fallo checkpoint/,
  )
  assert.deepEqual(cloud.logicalChanges, [`upsert:${itemId}`])
  assert.equal(cloud.live.get(itemId)?.expiresAt, item().expiresAt)
  assert.equal(store.snapshot()?.cloudKnownItemIds?.includes(itemId) ?? false, false)

  const retry = await bridge.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, transitionNow)
  assert.equal(retry.cloudWrites, 2)
  assert.deepEqual(cloud.attempts, [
    `create:${itemId}`,
    `create:${itemId}`,
    `delete:${itemId}`,
  ])
  assert.deepEqual(cloud.logicalChanges, [
    `upsert:${itemId}`,
    `delete:${itemId}`,
  ])
  assert.deepEqual(store.snapshot()?.cloudCommittedChangeIds, [deletion.changeId])
})

test('delete direct-only recupera cierre después del delete cloud sin crear otra copia lógica', async () => {
  const store = memoryStore()
  const cloud = cloudHarness()
  const bridge = outbound(store)
  const upsert = await bridge.prepareUpsert(roomId, item(), [peer])
  assert.ok(upsert)
  await ackPrepared(bridge, upsert)
  const deletion = await bridge.prepareDelete(roomId, local, itemId, [peer])
  assert.ok(deletion)

  store.failSecondNextWrite()
  await assert.rejects(
    () => bridge.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, transitionNow),
    /fallo checkpoint/,
  )
  assert.deepEqual(store.snapshot()?.cloudKnownItemIds, [itemId])
  assert.deepEqual(cloud.logicalChanges, [
    `upsert:${itemId}`,
    `delete:${itemId}`,
  ])

  const retry = await bridge.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, transitionNow)
  assert.equal(retry.cloudWrites, 1)
  assert.deepEqual(cloud.attempts, [
    `create:${itemId}`,
    `delete:${itemId}`,
    `delete:${itemId}`,
  ])
  assert.deepEqual(cloud.logicalChanges, [
    `upsert:${itemId}`,
    `delete:${itemId}`,
  ])
  assert.deepEqual(store.snapshot()?.cloudCommittedChangeIds, [deletion.changeId])
})

test('delete direct-only ya vencido no crea seed fresca ni deja reintentos vivos', async () => {
  const store = memoryStore()
  const cloud = cloudHarness()
  const bridge = outbound(store)
  const upsert = await bridge.prepareUpsert(roomId, item(), [peer])
  assert.ok(upsert)
  const deletion = await bridge.prepareDelete(roomId, local, itemId, [peer])
  assert.ok(deletion)

  const expired = await bridge.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, item().expiresAt)
  assert.equal(expired.cloudWrites, 0)
  assert.deepEqual(expired.expiredChangeIds, [deletion.changeId])
  assert.deepEqual(cloud.attempts, [])
  assert.deepEqual(store.snapshot()?.cloudKnownItemIds ?? [], [])
  assert.equal(store.snapshot()?.cloudCommittedChangeIds?.includes(deletion.changeId), true)
  assert.equal(store.snapshot()?.cloudCommittedChangeIds?.includes(upsert.changeId), true)

  const restored = outbound(store)
  const retry = await restored.reconcileCloudTransition(roomId, local, [], true, cloud.boundary, item().expiresAt + 1)
  assert.equal(retry.cloudWrites, 0)
  assert.deepEqual(cloud.attempts, [])
})

test('sin nube disponible conserva pendiente y no inventa escrituras', async () => {
  const store = memoryStore()
  const cloud = cloudHarness()
  const bridge = outbound(store)
  await bridge.prepareUpsert(roomId, item(), [peer])

  const offline = await bridge.reconcileCloudTransition(roomId, local, [], false, cloud.boundary, transitionNow)
  assert.equal(offline.cloudWrites, 0)
  assert.deepEqual(cloud.attempts, [])
  assert.equal(store.snapshot()?.cloudCommittedChangeIds?.length ?? 0, 0)
})
