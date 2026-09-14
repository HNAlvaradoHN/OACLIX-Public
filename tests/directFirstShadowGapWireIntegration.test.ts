import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('transporte conecta solicitud, replay y reintento de gap sobre el DataChannel existente', () => {
  const transportSource = readFileSync(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')
  const busSource = readFileSync(new URL('../src/realtime/lanClipboardBus.ts', import.meta.url), 'utf8')
  const managerSource = readFileSync(new URL('../src/realtime/lanPeerManager.ts', import.meta.url), 'utf8')

  assert.match(transportSource, /subscribeLanDirectFirstGapRequests\(roomId/)
  assert.match(transportSource, /directFirstShadowOutbound\.replay/)
  assert.match(transportSource, /type: 'direct-first-replay'/)
  assert.match(transportSource, /subscribeLanDirectFirstReplays\(roomId/)
  assert.match(transportSource, /directFirstShadowInbound\.receiveReplay/)
  assert.match(transportSource, /subscribeDirectLanStatus/)
  assert.match(transportSource, /directFirstShadowInbound\.pendingRepairRequest/)
  assert.match(transportSource, /type: 'direct-first-gap-request'/)

  assert.match(busSource, /type LanClipboardContentChange/)
  assert.match(busSource, /LanDirectFirstGapRequestMessage/)
  assert.match(busSource, /LanDirectFirstReplayMessage/)
  assert.match(busSource, /gapRequestListenersByRoom/)
  assert.match(busSource, /replayListenersByRoom/)
  assert.match(busSource, /if \(change\.type === 'direct-first-gap-request'\)/)
  assert.match(busSource, /if \(change\.type === 'direct-first-replay'\)/)

  // El manager sigue usando el único mensaje `clipboard-change` ya validado,
  // así que la reparación no abre otro canal ni altera negociación WebRTC.
  assert.match(managerSource, /type: 'clipboard-change'/)
  assert.match(managerSource, /broadcastClipboardChange\(change: LanClipboardChange\)/)
  assert.match(managerSource, /publishLanClipboardChange\(this\.roomId, message\.change, remoteDeviceId\)/)
})
