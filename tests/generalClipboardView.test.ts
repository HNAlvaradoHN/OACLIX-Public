import assert from 'node:assert/strict'
import test from 'node:test'
import { selectRecentGeneralTexts } from '../src/data/generalClipboardView.ts'

function item(id: string, expiresAt: number, sequence: number) {
  return {
    sequence,
    id,
    authorPersonId: 'per_abcdefghijklmnop',
    authorDeviceId: 'dev_abcdefghijklmnop',
    text: id,
    createdAt: 1_000,
    expiresAt,
  }
}

test('un elemento fijado no aparece en Reciente', () => {
  const now = 10_000
  const current = item('itm_abcdefghijklmnop', now + 5_000, 1)

  assert.deepEqual(
    selectRecentGeneralTexts([current], new Set([current.id]), now),
    [],
  )
})

test('al quitar el pin un elemento vigente vuelve a Reciente', () => {
  const now = 10_000
  const current = item('itm_abcdefghijklmnop', now + 5_000, 1)

  assert.deepEqual(
    selectRecentGeneralTexts([current], new Set(), now),
    [current],
  )
})

test('al quitar el pin un elemento ya vencido no resucita en Reciente', () => {
  const now = 10_000
  const expired = item('itm_abcdefghijklmnop', now - 1, 1)

  assert.deepEqual(
    selectRecentGeneralTexts([expired], new Set(), now),
    [],
  )
})

test('el instante exacto de expiración ya no cuenta como vigente', () => {
  const now = 10_000
  const expired = item('itm_abcdefghijklmnop', now, 1)

  assert.deepEqual(
    selectRecentGeneralTexts([expired], new Set(), now),
    [],
  )
})
