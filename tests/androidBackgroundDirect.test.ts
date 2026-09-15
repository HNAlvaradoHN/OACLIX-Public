import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('background Direct does not initialize native WebRTC until a linked remote peer is present', async () => {
  const receiver = await read('android/app/src/main/java/app/oaclix/android/share/NativeImageDeviceRelayReceiver.kt')

  assert.doesNotMatch(receiver, /val directManager = createDirectManagerOnMainThread\(deviceId\)/)
  assert.match(receiver, /NativeDirectSignalProtocol\.parsePresence\(message\)/)
  assert.match(receiver, /peers\.none \{ it\.deviceId != deviceId \}/)
  assert.match(receiver, /ensureDirectManagerOnMainThread\(deviceId\)/)
})

test('background Direct pins the maintained M144 native WebRTC runtime', async () => {
  const build = await read('android/app/build.gradle.kts')

  assert.match(build, /android-prefixed-stripped:144\.7559\.15/)
  assert.doesNotMatch(build, /android-prefixed-stripped:150\.7871\.01/)
})
