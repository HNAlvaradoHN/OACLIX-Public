import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('al salir de una superficie conectada se corta señalización pero se conserva un directo validado', async () => {
  const source = await readFile(new URL('../src/realtime/lanPeerManager.ts', import.meta.url), 'utf8')

  assert.match(source, /private parked = false/)
  assert.match(
    source,
    /const preserveValidatedDirect = this\.started && this\.getValidatedPeerIds\(\)\.length > 0/,
  )
  assert.match(
    source,
    /if \(preserveValidatedDirect\) \{[\s\S]*?this\.parked = true[\s\S]*?this\.signalClient\?\.disconnect\(\)[\s\S]*?this\.signalClient = null[\s\S]*?clearRealtimePresence\(this\.roomId\)[\s\S]*?if \(!peer\.validated \|\| peer\.channel\?\.readyState !== 'open'\) this\.dropPeer\(remoteDeviceId, peer\)[\s\S]*?this\.refreshPublishedStatus\(\)[\s\S]*?return/,
  )
})

test('un directo estacionado se cierra por completo si la aplicación deja de estar visible', async () => {
  const source = await readFile(new URL('../src/realtime/lanPeerManager.ts', import.meta.url), 'utf8')

  assert.match(
    source,
    /private readonly handleVisibility = \(\) => \{[\s\S]*?else if \(this\.parked\) \{\s*this\.stop\(\)[\s\S]*?\} else \{\s*this\.suspend\(\)/,
  )
  assert.match(
    source,
    /if \(!this\.started && !this\.parked\) return[\s\S]*?this\.parked = false[\s\S]*?document\.removeEventListener\('visibilitychange', this\.handleVisibility\)[\s\S]*?this\.suspend\(\)/,
  )
})
