import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DirectFirstPrepCoordinator } from '../src/transport/directFirstPrepCoordinator.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'
import { validDirectChangeEnvelope } from '../src/transport/directFirstProtocol.ts'
import { DirectFirstShadowOutbound } from '../src/transport/directFirstShadowOutbound.ts'

const roomId = 'room_general_1234'
const local = 'dev_abcdefghijklmnop'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'

function memoryStore() {
  let value: DirectFirstPersistentState | null = null
  return {
    async read() { return value ? structuredClone(value) : null },
    async write(snapshot: DirectFirstPersistentState) { value = structuredClone(snapshot) },
    snapshot() { return value ? structuredClone(value) : null },
  }
}

test('envelope direct-only upsert exige metadata suficiente para replay de producto', () => {
  const base = {
    version: 1 as const,
    changeId: 'chg_aaaaaaaaaaaaaaaaaaaa',
    authorDeviceId: local,
    authorSequence: 1,
    itemId,
    operation: 'upsert' as const,
    text: 'directo',
    createdAt: 1_700_000_000_000,
    directOnly: true as const,
  }

  assert.equal(validDirectChangeEnvelope(base), false)
  assert.equal(validDirectChangeEnvelope({
    ...base,
    authorPersonId: 'per_abcdefghijklmnop',
    expiresAt: 1_700_000_100_000,
  }), true)
})

test('upsert productivo direct-only conserva metadata y queda reintentable tras reinicio', async () => {
  const store = memoryStore()
  const makeBridge = () => new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => 'chg_bbbbbbbbbbbbbbbbbbbb',
  )
  const createdAt = Date.now()
  const item = {
    sequence: 1,
    id: itemId,
    authorPersonId: 'per_abcdefghijklmnop',
    authorDeviceId: local,
    text: 'texto directo real',
    createdAt,
    expiresAt: createdAt + 21_600_000,
    directOnly: true as const,
  }

  const prep = await makeBridge().prepareUpsert(roomId, item, [peer])
  assert.ok(prep)
  const persisted = store.snapshot()?.deliveries[0].change
  assert.equal(persisted?.directOnly, true)
  assert.equal(persisted?.authorPersonId, item.authorPersonId)
  assert.equal(persisted?.expiresAt, item.expiresAt)

  const restored = makeBridge()
  const pending = await restored.pendingDirectOnlyForDestination(roomId, local, peer)
  assert.equal(pending.length, 1)
  assert.equal(pending[0].changeId, prep.changeId)

  assert.equal(await restored.acknowledge(roomId, local, peer, {
    version: 1,
    type: 'ack',
    changeId: prep.changeId,
    authorDeviceId: local,
    authorSequence: prep.authorSequence,
  }), true)
  assert.deepEqual(await restored.pendingDirectOnlyForDestination(roomId, local, peer), [])
})

test('cambio que ya fue cloud conserva shadow sin marca direct-only pero sí su expiración', async () => {
  const store = memoryStore()
  const bridge = new DirectFirstShadowOutbound(
    (room, device) => DirectFirstPrepCoordinator.load(room, device, store),
    () => 'chg_cccccccccccccccccccc',
  )
  const createdAt = Date.now()
  const expiresAt = createdAt + 21_600_000
  await bridge.prepareUpsert(roomId, {
    sequence: 23,
    id: itemId,
    authorPersonId: 'per_abcdefghijklmnop',
    authorDeviceId: local,
    text: 'texto cloud',
    createdAt,
    expiresAt,
  }, [peer], { cloudCommitted: true })

  const change = store.snapshot()?.deliveries[0].change
  assert.equal(change?.directOnly, undefined)
  assert.equal(change?.authorPersonId, undefined)
  assert.equal(change?.expiresAt, expiresAt)
})

test('transporte exige roster vinculado exacto antes de omitir D1', () => {
  const source = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')
  assert.match(source, /listLinkedDevices\(\)/)
  assert.match(source, /selectAllDirectDestinations/)
  assert.match(source, /resolveAllDirectCoverage/)
  assert.match(source, /cloudAvailabilityByRoom/)
  assert.match(source, /delivery: 'direct'/)
  assert.match(source, /delivery: 'cloud'/)
  assert.match(source, /cloudClipboardBoundary\.createText\(roomId, text\)/)
})

test('UI aplica direct-only sin mover el cursor cloud y delete conserva seed temporal completa', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(source, /if \(change\.directOnly\) \{/)
  assert.match(source, /writeGeneralClipboardCache\(roomId, generalCursorRef\.current, nextItems\)/)
  assert.match(source, /fallbackSeed: \{/)
  assert.match(source, /text: snapshot\.text/)
  assert.match(source, /createdAt: snapshot\.createdAt/)
  assert.match(source, /expiresAt: snapshot\.expiresAt/)
  assert.match(source, /if \(result\.delivery === 'direct'\)/)
})
