import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseDirectItemRevision,
  compareDirectItemRevisions,
  nextDirectLogicalClock,
  type DirectItemRevision,
} from '../src/transport/directFirstConflict.ts'

const authorA = 'dev_abcdefghijklmnop'
const authorB = 'dev_qrstuvwxyzabcdef'

function revision(overrides: Partial<DirectItemRevision> = {}): DirectItemRevision {
  return {
    logicalClock: 1,
    authorDeviceId: authorA,
    changeId: 'chg_abcdefghijklmnopqrstuvwx',
    operation: 'upsert',
    ...overrides,
  }
}

test('reloj lógico avanza sin depender del reloj de pared', () => {
  assert.equal(nextDirectLogicalClock(0), 1)
  assert.equal(nextDirectLogicalClock(4), 5)
  assert.equal(nextDirectLogicalClock(4, 9), 10)
  assert.throws(() => nextDirectLogicalClock(-1), /local/)
  assert.throws(() => nextDirectLogicalClock(1, -1), /remoto/)
})

test('revisión con reloj lógico mayor gana', () => {
  const current = revision({ logicalClock: 7 })
  const incoming = revision({
    logicalClock: 8,
    authorDeviceId: authorB,
    changeId: 'chg_zzzzzzzzzzzzzzzzzzzzzzzz',
  })

  assert.equal(compareDirectItemRevisions(current, incoming), -1)
  assert.equal(chooseDirectItemRevision(current, incoming), 'incoming')
  assert.equal(chooseDirectItemRevision(incoming, current), 'current')
})

test('delete concurrente gana empate y evita resurrección', () => {
  const deleted = revision({
    logicalClock: 12,
    operation: 'delete',
    changeId: 'chg_deleteabcdefghijklmnopq',
  })
  const concurrentUpsert = revision({
    logicalClock: 12,
    authorDeviceId: authorB,
    changeId: 'chg_upsertabcdefghijklmnopq',
    operation: 'upsert',
  })

  assert.equal(chooseDirectItemRevision(deleted, concurrentUpsert), 'current')
  assert.equal(chooseDirectItemRevision(concurrentUpsert, deleted), 'incoming')
})

test('upsert realmente posterior puede recrear un item borrado', () => {
  const deleted = revision({
    logicalClock: 12,
    operation: 'delete',
    changeId: 'chg_deleteabcdefghijklmnopq',
  })
  const laterUpsert = revision({
    logicalClock: 13,
    authorDeviceId: authorB,
    changeId: 'chg_laterabcdefghijklmnopqr',
    operation: 'upsert',
  })

  assert.equal(chooseDirectItemRevision(deleted, laterUpsert), 'incoming')
})

test('cambios cruzados convergen igual sin importar orden de llegada', () => {
  const fromA = revision({
    logicalClock: 20,
    authorDeviceId: authorA,
    changeId: 'chg_crossaaaaaaaaaaaaaaaaaa',
  })
  const fromB = revision({
    logicalClock: 20,
    authorDeviceId: authorB,
    changeId: 'chg_crossbbbbbbbbbbbbbbbbbb',
  })

  const winnerWhenAFirst = chooseDirectItemRevision(fromA, fromB) === 'incoming' ? fromB : fromA
  const winnerWhenBFirst = chooseDirectItemRevision(fromB, fromA) === 'incoming' ? fromA : fromB

  assert.deepEqual(winnerWhenAFirst, winnerWhenBFirst)
})

test('mismo changeId se reconoce como la misma revisión', () => {
  const current = revision()
  assert.equal(chooseDirectItemRevision(current, { ...current }), 'same')
})

test('rechaza revisiones inválidas', () => {
  assert.throws(() => chooseDirectItemRevision(null, revision({ logicalClock: 0 })), /lógico/)
  assert.throws(() => chooseDirectItemRevision(null, revision({ authorDeviceId: 'dev_mal' })), /Autor/)
})
