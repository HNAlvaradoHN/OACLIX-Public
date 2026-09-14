import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveClipboardCreateExpiry } from '../worker/data/clipboardCreateExpiry.ts'

const now = 1_700_000_000_000
const sixHoursSeconds = 6 * 60 * 60

test('cloud-first conserva el contrato actual calculando expiración en servidor', () => {
  assert.deepEqual(resolveClipboardCreateExpiry(undefined, now, sixHoursSeconds), {
    status: 'accepted',
    expiresAt: now + sixHoursSeconds * 1000,
    source: 'server',
  })
})

test('fallback direct-first conserva exactamente la expiración original firmada', () => {
  const originalExpiresAt = now + 30 * 60 * 1000
  assert.deepEqual(resolveClipboardCreateExpiry(originalExpiresAt, now, sixHoursSeconds), {
    status: 'accepted',
    expiresAt: originalExpiresAt,
    source: 'original',
  })
})

test('fallback vencido o que excede la retención real falla cerrado', () => {
  assert.deepEqual(resolveClipboardCreateExpiry(now, now, sixHoursSeconds), { status: 'invalid' })
  assert.deepEqual(resolveClipboardCreateExpiry(now - 1, now, sixHoursSeconds), { status: 'invalid' })
  assert.deepEqual(
    resolveClipboardCreateExpiry(now + sixHoursSeconds * 1000 + 1, now, sixHoursSeconds),
    { status: 'invalid' },
  )
})

test('una sala con menor retención impide extender el fallback', () => {
  const oneHourSeconds = 60 * 60
  assert.equal(resolveClipboardCreateExpiry(now + oneHourSeconds * 1000, now, oneHourSeconds).status, 'accepted')
  assert.deepEqual(
    resolveClipboardCreateExpiry(now + oneHourSeconds * 1000 + 1, now, oneHourSeconds),
    { status: 'invalid' },
  )
})

test('metadata inválida no se convierte silenciosamente en expiración server', () => {
  assert.deepEqual(resolveClipboardCreateExpiry(null, now, sixHoursSeconds), { status: 'invalid' })
  assert.deepEqual(resolveClipboardCreateExpiry(Number.NaN, now, sixHoursSeconds), { status: 'invalid' })
  assert.deepEqual(resolveClipboardCreateExpiry('1700000000000', now, sixHoursSeconds), { status: 'invalid' })
  assert.deepEqual(resolveClipboardCreateExpiry(undefined, Number.NaN, sixHoursSeconds), { status: 'invalid' })
  assert.deepEqual(resolveClipboardCreateExpiry(undefined, now, 0), { status: 'invalid' })
})
