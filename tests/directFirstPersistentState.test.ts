import assert from 'node:assert/strict'
import test from 'node:test'
import {
  redactExpiredDirectFirstContent,
  validDirectFirstPersistentState,
} from '../src/transport/directFirstPersistentState.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'

const author = 'dev_abcdefghijklmnop'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const seedCreatedAt = 1_700_000_000_000
const seedExpiresAt = seedCreatedAt + 21_600_000

function state(): DirectFirstPersistentState {
  return {
    version: 1,
    roomId: 'room_general_1234',
    localDeviceId: author,
    logicalClock: 7,
    ledger: {
      version: 1,
      appliedChangeIds: ['chg_aaaaaaaaaaaaaaaaaaaa'],
      lastSequenceByAuthor: [[peer, 3]],
    },
    deliveries: [{
      version: 1,
      change: {
        version: 1,
        changeId: 'chg_bbbbbbbbbbbbbbbbbbbb',
        authorDeviceId: author,
        authorSequence: 4,
        itemId,
        operation: 'upsert',
        text: 'hola',
        createdAt: seedCreatedAt,
      },
      pendingDeviceIds: [peer],
      deliveredDeviceIds: [],
    }],
    replayLogs: [{
      version: 1,
      authorDeviceId: author,
      maxEntries: 256,
      changes: [{
        version: 1,
        changeId: 'chg_bbbbbbbbbbbbbbbbbbbb',
        authorDeviceId: author,
        authorSequence: 4,
        itemId,
        operation: 'upsert',
        text: 'hola',
        createdAt: seedCreatedAt,
      }],
    }],
    gapBuffer: {
      version: 1,
      maxBufferedPerAuthor: 64,
      changes: [],
    },
    savedAt: seedCreatedAt + 500,
  }
}

function turnDeliveryIntoDelete(input: DirectFirstPersistentState) {
  input.deliveries[0].change.operation = 'delete'
  delete input.deliveries[0].change.text
  input.replayLogs[0].changes[0].operation = 'delete'
  delete input.replayLogs[0].changes[0].text
}

test('acepta snapshot direct-first completo y consistente', () => {
  assert.equal(validDirectFirstPersistentState(state()), true)
})

test('acepta progreso cloud durable solo con identificadores válidos y cambios salientes conocidos', () => {
  const input = state()
  input.cloudKnownItemIds = [itemId]
  input.cloudCommittedChangeIds = [input.deliveries[0].change.changeId]
  assert.equal(validDirectFirstPersistentState(input), true)

  input.cloudCommittedChangeIds = ['chg_cccccccccccccccccccc']
  assert.equal(validDirectFirstPersistentState(input), false)

  input.cloudCommittedChangeIds = [input.deliveries[0].change.changeId]
  input.cloudKnownItemIds = ['itm_no_valido']
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('rechaza progreso cloud duplicado', () => {
  const input = state()
  input.cloudKnownItemIds = [itemId, itemId]
  assert.equal(validDirectFirstPersistentState(input), false)

  input.cloudKnownItemIds = [itemId]
  input.cloudCommittedChangeIds = [
    input.deliveries[0].change.changeId,
    input.deliveries[0].change.changeId,
  ]
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('acepta semilla legacy de fallback para delete pendiente correspondiente', () => {
  const input = state()
  turnDeliveryIntoDelete(input)
  input.cloudFallbackSeeds = [{
    changeId: input.deliveries[0].change.changeId,
    itemId,
    text: 'contenido previo',
  }]
  assert.equal(validDirectFirstPersistentState(input), true)
})

test('acepta semilla nueva solo cuando conserva metadata temporal válida y completa', () => {
  const input = state()
  turnDeliveryIntoDelete(input)
  input.cloudFallbackSeeds = [{
    changeId: input.deliveries[0].change.changeId,
    itemId,
    text: 'contenido previo',
    createdAt: seedCreatedAt,
    expiresAt: seedExpiresAt,
  }]
  assert.equal(validDirectFirstPersistentState(input), true)

  delete input.cloudFallbackSeeds[0].expiresAt
  assert.equal(validDirectFirstPersistentState(input), false)

  input.cloudFallbackSeeds[0].expiresAt = seedExpiresAt + 1
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('rechaza semilla de fallback huérfana o asociada a upsert', () => {
  const input = state()
  input.cloudFallbackSeeds = [{
    changeId: input.deliveries[0].change.changeId,
    itemId,
    text: 'contenido previo',
  }]
  assert.equal(validDirectFirstPersistentState(input), false)

  turnDeliveryIntoDelete(input)
  input.cloudFallbackSeeds[0].changeId = 'chg_cccccccccccccccccccc'
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('rechaza entregas duplicadas por changeId', () => {
  const input = state()
  input.deliveries.push(structuredClone(input.deliveries[0]))
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('rechaza replay duplicado por autor', () => {
  const input = state()
  input.replayLogs.push(structuredClone(input.replayLogs[0]))
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('rechaza delete que transporta contenido', () => {
  const input = state()
  input.deliveries[0].change.operation = 'delete'
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('rechaza buffer que excede capacidad por autor', () => {
  const input = state()
  input.gapBuffer.maxBufferedPerAuthor = 1
  const buffered = structuredClone(input.deliveries[0].change)
  buffered.authorDeviceId = peer
  buffered.authorSequence = 8
  buffered.changeId = 'chg_cccccccccccccccccccc'
  input.gapBuffer.changes = [buffered, {
    ...buffered,
    authorSequence: 9,
    changeId: 'chg_dddddddddddddddddddd',
  }]
  assert.equal(validDirectFirstPersistentState(input), false)
})

test('depura texto vencido sin perder secuencias de delivery, replay ni gap', () => {
  const input = state()
  input.deliveries.push({
    version: 1,
    change: {
      version: 1,
      changeId: 'chg_cccccccccccccccccccc',
      authorDeviceId: author,
      authorSequence: 5,
      itemId,
      operation: 'delete',
      createdAt: seedCreatedAt + 1_000,
      directOnly: true,
    },
    pendingDeviceIds: [peer],
    deliveredDeviceIds: [],
  })
  input.replayLogs[0].changes.push(structuredClone(input.deliveries[1].change))
  input.gapBuffer.changes = [{
    version: 1,
    changeId: 'chg_dddddddddddddddddddd',
    authorDeviceId: peer,
    authorSequence: 8,
    itemId: 'itm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    operation: 'upsert',
    text: 'buffer privado',
    createdAt: seedCreatedAt,
  }]
  input.cloudFallbackSeeds = [{
    changeId: input.deliveries[1].change.changeId,
    itemId,
    text: 'hola',
    createdAt: seedCreatedAt,
    expiresAt: seedExpiresAt,
  }]

  const result = redactExpiredDirectFirstContent(input, seedExpiresAt + 1)
  assert.equal(result.changed, true)
  assert.equal(result.state.deliveries[0].change.text, '')
  assert.equal(result.state.replayLogs[0].changes[0].text, '')
  assert.equal(result.state.gapBuffer.changes[0].text, '')
  assert.equal(result.state.cloudFallbackSeeds?.[0].text, '')
  assert.equal(result.state.savedAt, seedExpiresAt + 1)
  assert.equal(validDirectFirstPersistentState(result.state), true)
})

test('conserva contenido que todavía no venció', () => {
  const input = state()
  const result = redactExpiredDirectFirstContent(input, seedCreatedAt + 1_000)
  assert.equal(result.changed, false)
  assert.equal(result.state, input)
  assert.equal(result.state.replayLogs[0].changes[0].text, 'hola')
})

test('elimina una semilla legacy si ya no puede demostrar su expiración original', () => {
  const input = state()
  turnDeliveryIntoDelete(input)
  input.cloudFallbackSeeds = [{
    changeId: input.deliveries[0].change.changeId,
    itemId,
    text: 'contenido sin metadata recuperable',
  }]

  const result = redactExpiredDirectFirstContent(input, seedCreatedAt + 1_000)
  assert.deepEqual(result.state.cloudFallbackSeeds, [])
  assert.equal(validDirectFirstPersistentState(result.state), true)
})
