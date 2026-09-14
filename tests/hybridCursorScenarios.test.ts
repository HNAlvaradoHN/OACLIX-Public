import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyDirectSequence } from '../src/transport/directCursorPolicy.ts'
import { keepCursorMonotonic, selectChangesAfterCursor } from '../src/transport/syncCursorPolicy.ts'

type ModelChange = {
  sequence: number
  type: 'upsert' | 'delete'
  itemId: string
}

function applyChange(items: Set<string>, change: ModelChange) {
  if (change.type === 'delete') items.delete(change.itemId)
  else items.add(change.itemId)
}

test('contiguous direct delivery wins over an older cloud response without duplicate application', () => {
  const items = new Set<string>()
  let cursor = 10
  const direct: ModelChange = { sequence: 11, type: 'upsert', itemId: 'itm_a' }

  assert.equal(classifyDirectSequence(cursor, direct.sequence), 'contiguous')
  applyChange(items, direct)
  cursor = direct.sequence

  const staleCloudPage = [direct]
  const applicable = selectChangesAfterCursor(staleCloudPage, cursor)
  assert.deepEqual(applicable, [])
  cursor = keepCursorMonotonic(cursor, 11)

  assert.equal(cursor, 11)
  assert.deepEqual([...items], ['itm_a'])
})

test('a direct gap is not applied and cloud repair can fill the missing sequence safely', () => {
  const items = new Set<string>()
  let cursor = 20
  const directGap: ModelChange = { sequence: 22, type: 'upsert', itemId: 'itm_b' }

  assert.equal(classifyDirectSequence(cursor, directGap.sequence), 'gap')
  assert.deepEqual([...items], [])

  const cloudRepair: ModelChange[] = [
    { sequence: 21, type: 'upsert', itemId: 'itm_a' },
    directGap,
  ]
  for (const change of selectChangesAfterCursor(cloudRepair, cursor)) applyChange(items, change)
  cursor = keepCursorMonotonic(cursor, 22)

  assert.equal(cursor, 22)
  assert.deepEqual([...items].sort(), ['itm_a', 'itm_b'])
})

test('an old upsert cannot resurrect an item after a newer delete advanced the cursor', () => {
  const items = new Set<string>(['itm_a'])
  let cursor = 30
  const deletion: ModelChange = { sequence: 31, type: 'delete', itemId: 'itm_a' }

  assert.equal(classifyDirectSequence(cursor, deletion.sequence), 'contiguous')
  applyChange(items, deletion)
  cursor = deletion.sequence

  const delayedUpsert: ModelChange = { sequence: 30, type: 'upsert', itemId: 'itm_a' }
  assert.equal(classifyDirectSequence(cursor, delayedUpsert.sequence), 'stale')
  assert.deepEqual(selectChangesAfterCursor([delayedUpsert], cursor), [])

  assert.equal(cursor, 31)
  assert.deepEqual([...items], [])
})

test('cloud pagination that started from an older cursor stays monotonic after direct delivery', () => {
  let cursor = 40
  const firstCloudPage: ModelChange[] = [
    { sequence: 41, type: 'upsert', itemId: 'itm_a' },
  ]

  const direct: ModelChange = { sequence: 41, type: 'upsert', itemId: 'itm_a' }
  assert.equal(classifyDirectSequence(cursor, direct.sequence), 'contiguous')
  cursor = direct.sequence

  assert.deepEqual(selectChangesAfterCursor(firstCloudPage, cursor), [])
  cursor = keepCursorMonotonic(cursor, 41)

  const secondCloudPage: ModelChange[] = [
    { sequence: 42, type: 'delete', itemId: 'itm_a' },
  ]
  assert.deepEqual(selectChangesAfterCursor(secondCloudPage, cursor), secondCloudPage)
  cursor = keepCursorMonotonic(cursor, 42)

  assert.equal(cursor, 42)
})
