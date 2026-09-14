import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Mi portapapeles distingue conectividad de contenido y de control', async () => {
  const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(
    appSource,
    /const connectedSurfaceMode: ConnectedSurfaceMode = isGeneralView[\s\S]*?\? 'content'[\s\S]*?linkedOpen \|\| Boolean\(localShareItemId\) \|\| Boolean\(localImageShareItemId\) \? 'control' : null/,
  )
  assert.match(
    appSource,
    /if \(!connectedSurfaceMode \|\| !roomId \|\| !identity\.persisted\) return[\s\S]*?if \(connectedSurfaceMode === 'content'\) ensureClipboardRoomConnectivity\(roomId\)[\s\S]*?else ensureClipboardRoomControlConnectivity\(roomId\)[\s\S]*?return \(\) => suspendClipboardRoomConnectivity\(roomId\)/,
  )
})

test('la pausa deliberada y el modo control no materializan contenido cloud', async () => {
  const transportSource = await readFile(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')

  assert.match(transportSource, /const suspendedConnectivityRooms = new Set<string>\(\)/)
  assert.match(transportSource, /const controlOnlyConnectivityRooms = new Set<string>\(\)/)
  assert.match(
    transportSource,
    /const contentTransportSuppressed = \(\) => \([\s\S]*?suspendedConnectivityRooms\.has\(roomId\) \|\| controlOnlyConnectivityRooms\.has\(roomId\)[\s\S]*?\)/,
  )
  assert.match(
    transportSource,
    /const reconcileCloudTransition = \(\) => \{\s*if \(contentTransportSuppressed\(\)\) return/,
  )
  assert.match(
    transportSource,
    /subscribeDirectLanStatus\(\(\) => \{[\s\S]*?if \(contentTransportSuppressed\(\)\) \{\s*knownValidatedPeerIds\.clear\(\)\s*return/,
  )
  assert.match(
    transportSource,
    /function suspendClipboardRoomConnectivity\(roomId: string\) \{[\s\S]*?suspendedConnectivityRooms\.add\(roomId\)[\s\S]*?controlOnlyConnectivityRooms\.delete\(roomId\)[\s\S]*?cloudAvailabilityByRoom\.set\(roomId, false\)[\s\S]*?lanManagers\.get\(roomId\)\?\.stop\(\)/,
  )
})

test('reanudar contenido limpia la pausa, el modo control y el estacionamiento antes de activar peers', async () => {
  const [transportSource, managerSource] = await Promise.all([
    readFile(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/realtime/lanPeerManager.ts', import.meta.url), 'utf8'),
  ])

  assert.match(
    transportSource,
    /function ensureClipboardRoomConnectivity\(roomId: string\) \{\s*suspendedConnectivityRooms\.delete\(roomId\)\s*controlOnlyConnectivityRooms\.delete\(roomId\)[\s\S]*?manager\.start\(\)[\s\S]*?manager\.poke\(\)/,
  )
  assert.match(
    transportSource,
    /function ensureClipboardRoomControlConnectivity\(roomId: string\) \{\s*suspendedConnectivityRooms\.delete\(roomId\)\s*controlOnlyConnectivityRooms\.add\(roomId\)[\s\S]*?manager\.start\(\)[\s\S]*?manager\.poke\(\)/,
  )
  assert.match(
    managerSource,
    /start\(\) \{\s*if \(this\.started\) return\s*this\.started = true\s*this\.parked = false\s*this\.lastConnectAttemptAt = 0[\s\S]*?this\.poke\(\)/,
  )
})

test('operaciones de contenido de General fallan cerradas durante pausa o modo control', async () => {
  const transportSource = await readFile(new URL('../src/transport/clipboardTransport.ts', import.meta.url), 'utf8')

  assert.match(
    transportSource,
    /function assertClipboardRoomConnectivityActive\(roomId: string\) \{\s*if \(suspendedConnectivityRooms\.has\(roomId\) \|\| controlOnlyConnectivityRooms\.has\(roomId\)\)/,
  )
  assert.match(transportSource, /async createText\(roomId, text\) \{\s*const manager = ensureLan\(roomId\)\s*assertClipboardRoomConnectivityActive\(roomId\)/)
  assert.match(transportSource, /async deleteText\(roomId, itemId, options = \{\}\) \{\s*const manager = ensureLan\(roomId\)\s*assertClipboardRoomConnectivityActive\(roomId\)/)
  assert.match(transportSource, /async listChanges\(roomId, after\) \{\s*ensureLan\(roomId\)\s*assertClipboardRoomConnectivityActive\(roomId\)/)
})