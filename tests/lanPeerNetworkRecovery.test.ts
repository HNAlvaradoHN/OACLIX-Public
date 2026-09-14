import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/realtime/lanPeerManager.ts', import.meta.url),
  'utf8',
)

function methodBody(startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing ${startMarker}`)
  assert.notEqual(end, -1, `missing ${endMarker}`)
  return source.slice(start, end)
}

test('network change restarts signaling instead of suspending the direct LAN peer', () => {
  const body = methodBody(
    'private readonly handleNetworkChange',
    'private restartSignalClientPreservingDirect',
  )

  assert.match(body, /this\.restartSignalClientPreservingDirect\(\)/)
  assert.doesNotMatch(body, /this\.suspend\(\)/)
})

test('network signaling restart preserves peer and remote-session state', () => {
  const body = methodBody(
    'private restartSignalClientPreservingDirect',
    'private scheduleSignalReconnect',
  )

  assert.match(body, /client\?\.disconnect\(\)/)
  assert.match(body, /clearRealtimePresence\(this\.roomId\)/)
  assert.match(body, /this\.clearAllDirectRetries\(\)/)
  assert.match(body, /network-signal-restart/)
  assert.match(body, /this\.poke\(\)/)

  assert.doesNotMatch(body, /dropPeer\(/)
  assert.doesNotMatch(body, /this\.peers\.clear\(/)
  assert.doesNotMatch(body, /this\.remoteSessions\.clear\(/)
  assert.doesNotMatch(body, /connection\.close\(/)
})
