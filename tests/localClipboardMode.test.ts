import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  createLocalClipboardTextDraft,
  normalizeLocalClipboardTexts,
} from '../src/data/localClipboard.ts'
import { resolveDefaultRoomId } from '../src/data/roomPreference.ts'

const itemId = 'itm_0123456789abcdef0123456789abcdef'

test('Mi portapapeles es la predeterminada hasta que exista una favorita válida', () => {
  const available = ['local', 'general', 'studio']
  assert.equal(resolveDefaultRoomId(null, available), 'local')
  assert.equal(resolveDefaultRoomId('missing', available), 'local')
  assert.equal(resolveDefaultRoomId('general', available), 'general')
})

test('un texto local conserva seis horas de vida sin depender de identidad cloud', () => {
  const now = 1_800_000_000_000
  const item = createLocalClipboardTextDraft('texto local', now, itemId)
  assert.deepEqual(item, {
    id: itemId,
    text: 'texto local',
    createdAt: now,
    expiresAt: now + 21_600_000,
  })
  assert.throws(() => createLocalClipboardTextDraft('   ', now, itemId))
})

test('la lectura local descarta vencidos, inválidos y duplicados', () => {
  const now = 1_800_000_000_000
  const current = createLocalClipboardTextDraft('actual', now - 1_000, itemId)
  const replacement = { ...current, text: 'actualizado', createdAt: now - 500, expiresAt: now + 10_000 }
  const expired = createLocalClipboardTextDraft(
    'viejo',
    now - 21_600_001,
    'itm_fedcba9876543210fedcba9876543210',
  )
  const result = normalizeLocalClipboardTexts([current, expired, { nope: true }, replacement], now)
  assert.equal(result.length, 1)
  assert.equal(result[0]?.text, 'actualizado')
})

test('la ruta local no llama APIs cloud y la identidad online se solicita solo al abrir funciones conectadas', async () => {
  const [appSource, localSource] = await Promise.all([
    readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/data/localClipboard.ts', import.meta.url), 'utf8'),
  ])

  const saveLocalBlock = appSource.match(/const saveLocalText[\s\S]*?const deleteLocalText/)?.[0] ?? ''
  assert.match(saveLocalBlock, /createLocalClipboardText\(text\)/)
  assert.doesNotMatch(saveLocalBlock, /createClipboardText|listClipboardChanges|fetch\(/)
  assert.doesNotMatch(localSource, /fetch\(|\/api\//)
  assert.match(appSource, /if \(room\.kind === 'general'\) void ensureIdentity\(\)/)
  assert.match(appSource, /routeText="Local · sin nube"/)
})
