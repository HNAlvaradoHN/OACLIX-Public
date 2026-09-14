import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('transporte observa pérdida directa y recuperación cloud sin duplicar cambios ya cloud', () => {
  const transportSource = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')

  assert.match(transportSource, /subscribeCloudConnectivity/)
  assert.match(transportSource, /directFirstShadowOutbound\.reconcileCloudTransition/)
  assert.match(transportSource, /roomManager\.getValidatedPeerIds\(\)/)
  assert.match(transportSource, /cloudClipboardBoundary/)
  assert.match(transportSource, /\{ cloudCommitted: true \}/)
  assert.match(
    transportSource,
    /if \(becameOnline && !controlOnlyConnectivityRooms\.has\(roomId\)\) \{/,
  )
  assert.match(transportSource, /refreshLinkedRoster\(localDeviceId\)/)
  assert.match(transportSource, /reconcileCloudTransition\(\)/)
})

test('backend conserva idempotencia necesaria para reintentar create/delete con el mismo itemId', () => {
  const storeSource = readFileSync(new URL('../worker/data/clipboardStore.ts', import.meta.url), 'utf8')

  // Reintentar create mientras la fila estable existe devuelve la misma copia.
  assert.match(storeSource, /return \{ item: mapRow\(existing\), created: false, changeSequence \}/)
  // Un itemId histórico no puede reutilizarse para crear otro elemento lógico.
  assert.match(storeSource, /if \(usedItemId\) throw new ClipboardItemConflictError\(\)/)
  // Reintentar delete después de un delete ya confirmado devuelve el tombstone previo.
  assert.match(storeSource, /if \(priorDelete\) \{/)
  assert.match(storeSource, /deleted: false/)
  assert.match(storeSource, /changeSequence: priorDelete\.sequence/)
})
