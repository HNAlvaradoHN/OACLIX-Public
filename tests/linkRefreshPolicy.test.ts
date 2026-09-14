import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasNewLinkedDevice,
  nextLinkRefreshDelayMs,
  shouldQueryLinkedDevices,
} from '../src/identity/linkRefreshPolicy.ts'

test('backoff conserva la secuencia aprobada y luego queda limitado a 60 segundos', () => {
  const now = 1_000_000
  const expiresAt = now + 10 * 60 * 1_000

  assert.deepEqual(
    Array.from({ length: 8 }, (_, attempt) => nextLinkRefreshDelayMs(attempt, now, expiresAt)),
    [2_000, 4_000, 8_000, 15_000, 30_000, 60_000, 60_000, 60_000],
  )
})

test('última espera se recorta al tiempo restante y al vencer deja de programar', () => {
  assert.equal(nextLinkRefreshDelayMs(5, 10_000, 11_500), 1_500)
  assert.equal(nextLinkRefreshDelayMs(0, 12_000, 12_000), null)
  assert.equal(nextLinkRefreshDelayMs(0, 13_000, 12_000), null)
})

test('no consulta dispositivos en segundo plano ni después de expirar', () => {
  assert.equal(shouldQueryLinkedDevices('visible', 10_000, 20_000), true)
  assert.equal(shouldQueryLinkedDevices('hidden', 10_000, 20_000), false)
  assert.equal(shouldQueryLinkedDevices('visible', 20_000, 20_000), false)
  assert.equal(shouldQueryLinkedDevices('visible', 21_000, 20_000), false)
})

test('solo una cantidad mayor a la línea base cuenta como nuevo vínculo', () => {
  assert.equal(hasNewLinkedDevice(2, 3), true)
  assert.equal(hasNewLinkedDevice(2, 2), false)
  assert.equal(hasNewLinkedDevice(2, 1), false)
  assert.equal(hasNewLinkedDevice(-1, 3), false)
})

test('un código de diez minutos genera como máximo 14 consultas visibles', () => {
  const expiresAt = 10 * 60 * 1_000
  let now = 0
  let attempt = 0
  let queries = 0

  while (true) {
    const delay = nextLinkRefreshDelayMs(attempt, now, expiresAt)
    if (delay == null) break
    now += delay
    if (now >= expiresAt) break
    queries += 1
    attempt += 1
  }

  assert.equal(queries, 14)
})
