import assert from 'node:assert/strict'
import test from 'node:test'
import { keepCursorMonotonic, selectChangesAfterCursor } from '../src/transport/syncCursorPolicy.ts'

test('selectChangesAfterCursor ignores cloud changes already covered by a newer direct cursor', () => {
  const changes = [
    { sequence: 11, type: 'upsert' },
    { sequence: 12, type: 'delete' },
    { sequence: 13, type: 'upsert' },
  ]

  assert.deepEqual(selectChangesAfterCursor(changes, 12), [{ sequence: 13, type: 'upsert' }])
})

test('selectChangesAfterCursor rejects invalid sequence values conservatively', () => {
  const changes = [
    { sequence: Number.NaN },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { sequence: 4 },
  ]

  assert.deepEqual(selectChangesAfterCursor(changes, 3), [{ sequence: 4 }])
})

test('keepCursorMonotonic never lets an older cloud response move the cursor backwards', () => {
  assert.equal(keepCursorMonotonic(12, 11), 12)
  assert.equal(keepCursorMonotonic(12, 12), 12)
  assert.equal(keepCursorMonotonic(12, 13), 13)
})

test('cursor helpers fail closed on invalid cursor input', () => {
  assert.throws(() => selectChangesAfterCursor([], -1))
  assert.throws(() => keepCursorMonotonic(2, Number.NaN))
})
