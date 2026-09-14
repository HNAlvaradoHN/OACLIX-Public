import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('delete direct-only que cae a cloud persiste tombstone antes de devolver éxito', () => {
  const transport = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')
  const outbound = readFileSync(new URL('../src/transport/directFirstShadowOutbound.ts', import.meta.url), 'utf8')

  assert.match(transport, /await directFirstShadowOutbound\.observeCloudDeletedItems\(/)
  assert.match(transport, /fallback\.status === 'expired'/)
  assert.match(outbound, /coordinator\.observeCloudDeletedItems\(ids, observedAt\)/)
  assert.match(outbound, /await coordinator\.persist\(\)/)
})

test('listChanges aprende deletes cloud en direct-first antes de entregarlos a la UI', () => {
  const transport = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')

  assert.match(transport, /const result = await cloudClipboardBoundary\.listChanges\(roomId, after\)/)
  assert.match(transport, /result\.changes\s*\.filter\(\(change\) => change\.type === 'delete'\)/)
  assert.match(transport, /await directFirstShadowOutbound\.observeCloudDeletedItems\(/)
  assert.match(transport, /return result/)
})
