import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decideDirectFirstCloudExpiry,
  serverAllowsRequestedExpiry,
} from '../src/transport/directFirstCloudExpiryPolicy.ts'
import { DIRECT_TEXT_RETENTION_MS } from '../src/transport/directFirstTombstonePolicy.ts'
import {
  decideDirectFirstCloudExpiry as decideWorkerCloudExpiry,
  serverAllowsRequestedExpiry as workerAllowsRequestedExpiry,
} from '../worker/data/clipboardExpiryPolicy.ts'

const createdAt = 1_700_000_000_000
const expiresAt = createdAt + DIRECT_TEXT_RETENTION_MS

test('fallback vigente conserva exactamente la expiración original', () => {
  const now = createdAt + 60_000
  assert.deepEqual(decideDirectFirstCloudExpiry(createdAt, expiresAt, now), {
    status: 'materialize',
    expiresAt,
  })
  assert.notEqual(expiresAt, now + DIRECT_TEXT_RETENTION_MS)
})

test('fallback en o después de la expiración no resucita contenido', () => {
  assert.deepEqual(decideDirectFirstCloudExpiry(createdAt, expiresAt, expiresAt), { status: 'expired' })
  assert.deepEqual(decideDirectFirstCloudExpiry(createdAt, expiresAt, expiresAt + 1), { status: 'expired' })
})

test('metadata direct-only ambigua o con vida mayor a seis horas falla cerrado', () => {
  assert.deepEqual(decideDirectFirstCloudExpiry(createdAt, createdAt, createdAt + 1), { status: 'invalid' })
  assert.deepEqual(
    decideDirectFirstCloudExpiry(createdAt, createdAt + DIRECT_TEXT_RETENTION_MS + 1, createdAt + 1),
    { status: 'invalid' },
  )
  assert.deepEqual(decideDirectFirstCloudExpiry(createdAt, expiresAt, Number.NaN), { status: 'invalid' })
})

test('servidor acepta solo una expiración futura dentro de su retención máxima', () => {
  const now = createdAt + 5 * 60 * 60 * 1000
  assert.equal(serverAllowsRequestedExpiry(expiresAt, now), true)
  assert.equal(serverAllowsRequestedExpiry(now, now), false)
  assert.equal(serverAllowsRequestedExpiry(now - 1, now), false)
  assert.equal(serverAllowsRequestedExpiry(now + DIRECT_TEXT_RETENTION_MS + 1, now), false)
})

test('límite servidor respeta la retención concreta de la sala', () => {
  const now = createdAt + 1_000
  const oneHour = 60 * 60 * 1000
  assert.equal(serverAllowsRequestedExpiry(now + oneHour, now, oneHour), true)
  assert.equal(serverAllowsRequestedExpiry(now + oneHour + 1, now, oneHour), false)
  assert.equal(serverAllowsRequestedExpiry(now + 1, now, 0), false)
})

test('frontend y Worker consumen exactamente la misma política compartida', () => {
  const now = createdAt + 2 * 60 * 60 * 1000
  assert.deepEqual(decideWorkerCloudExpiry(createdAt, expiresAt, now), decideDirectFirstCloudExpiry(createdAt, expiresAt, now))
  assert.equal(workerAllowsRequestedExpiry(expiresAt, now), serverAllowsRequestedExpiry(expiresAt, now))
})
