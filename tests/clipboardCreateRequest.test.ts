import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeClipboardCreateSignedPayload } from '../worker/data/clipboardCreateRequest.ts'

const base = {
  roomId: 'gen_testroom',
  itemId: 'itm_1234567890abcdef',
  text: 'hola',
}

test('cloud-first conserva exactamente el payload anterior sin expiresAt', () => {
  const normalized = normalizeClipboardCreateSignedPayload(base)
  assert.deepEqual(normalized, base)
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'expiresAt'), false)
})

test('fallback direct-first conserva expiresAt dentro del payload firmado', () => {
  const expiresAt = 1_700_000_123_456
  const normalized = normalizeClipboardCreateSignedPayload({ ...base, expiresAt })
  assert.deepEqual(normalized, { ...base, expiresAt })
})

test('rechaza expiresAt no entero, inseguro, no positivo o de tipo incorrecto', () => {
  for (const expiresAt of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1700000123456', null, NaN]) {
    assert.equal(normalizeClipboardCreateSignedPayload({ ...base, expiresAt }), null)
  }
})

test('no convierte expiresAt presente pero undefined en cloud-first', () => {
  assert.equal(normalizeClipboardCreateSignedPayload({ ...base, expiresAt: undefined }), null)
})

test('normaliza identificadores/texto con las mismas reglas del store', () => {
  const normalized = normalizeClipboardCreateSignedPayload({
    roomId: '  gen_testroom  ',
    itemId: '  itm_1234567890abcdef  ',
    text: ' hola ',
  })
  assert.deepEqual(normalized, {
    roomId: 'gen_testroom',
    itemId: 'itm_1234567890abcdef',
    text: ' hola ',
  })
})

test('Worker verifica exactamente el payload normalizado y pasa expiresAt al store', () => {
  const source = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8')
  assert.match(source, /normalizeClipboardCreateSignedPayload\(envelope\.payload\)/)
  assert.match(source, /authenticateDeviceAction\([\s\S]*'clipboard\.text\.create',[\s\S]*payload,/)
  assert.match(source, /createClipboardTextItem\(env\.DB!, principal, \{ \.\.\.payload, now: Date\.now\(\) \}\)/)
  assert.match(source, /error instanceof ClipboardExpiryError/)
})
