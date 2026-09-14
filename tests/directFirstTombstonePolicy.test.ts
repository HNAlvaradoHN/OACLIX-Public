import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canCompactDirectTombstone,
  DIRECT_TEXT_RETENTION_MS,
  directTombstoneRetainUntil,
  replayCannotOutliveTombstone,
  validDirectOnlyExpiration,
} from '../src/transport/directFirstTombstonePolicy.ts'

const base = 1_800_000_000_000

test('retención direct-only válida queda acotada a seis horas', () => {
  assert.equal(validDirectOnlyExpiration(base, base + DIRECT_TEXT_RETENTION_MS), true)
  assert.equal(validDirectOnlyExpiration(base, base + DIRECT_TEXT_RETENTION_MS + 1), false)
  assert.equal(validDirectOnlyExpiration(base, base), false)
})

test('frontera de tombstone conserva seis horas completas después del delete', () => {
  const retainUntil = directTombstoneRetainUntil(base)
  assert.equal(retainUntil, base + DIRECT_TEXT_RETENTION_MS)
  assert.equal(canCompactDirectTombstone(retainUntil, retainUntil - 1), false)
  assert.equal(canCompactDirectTombstone(retainUntil, retainUntil), true)
})

test('replay creado antes del delete no puede sobrevivir la frontera si respeta retención', () => {
  const upsertCreatedAt = base - 30_000
  const upsertExpiresAt = upsertCreatedAt + DIRECT_TEXT_RETENTION_MS
  assert.equal(replayCannotOutliveTombstone(upsertCreatedAt, upsertExpiresAt, base), true)
})

test('no permite justificar poda con expiración arbitrariamente larga', () => {
  const upsertCreatedAt = base - 30_000
  const oversizedExpiry = upsertCreatedAt + DIRECT_TEXT_RETENTION_MS + 1
  assert.equal(replayCannotOutliveTombstone(upsertCreatedAt, oversizedExpiry, base), false)
})

test('un upsert posterior al delete no pertenece a la prueba de replay antiguo', () => {
  const upsertCreatedAt = base + 1
  const upsertExpiresAt = upsertCreatedAt + DIRECT_TEXT_RETENTION_MS
  assert.equal(replayCannotOutliveTombstone(upsertCreatedAt, upsertExpiresAt, base), false)
})
