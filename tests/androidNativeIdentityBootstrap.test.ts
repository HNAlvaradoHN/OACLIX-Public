import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const androidRoot = new URL('../android/', import.meta.url)

async function readAndroid(path: string) {
  return readFile(new URL(path, androidRoot), 'utf8')
}

test('Android bootstrap mantiene el contrato firmado del Worker', async () => {
  const [api, identity, protocol] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/identity/NativeIdentityApi.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/identity/AndroidKeystoreDeviceIdentity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/identity/DeviceIdentityProtocol.kt'),
  ])
  assert.match(api, /\/api\/identity\/bootstrap/)
  assert.match(api, /"version", proof\.version/)
  assert.match(api, /"publicKey"/)
  assert.match(api, /"timestamp", proof\.timestamp/)
  assert.match(api, /"nonce", proof\.nonce/)
  assert.match(api, /"signature", proof\.signature/)
  assert.match(api, /"deviceLabel"/)
  assert.match(api, /require\(authenticated\)/)
  assert.match(identity, /createBootstrapProof/)
  assert.match(protocol, /oaclix-bootstrap\|1\|/)
})

test('Android bootstrap exige HTTPS y no permite redirects ni cleartext', async () => {
  const [api, manifest] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/identity/NativeIdentityApi.kt'),
    readAndroid('app/src/main/AndroidManifest.xml'),
  ])
  assert.match(api, /startsWith\("https:\/\/"\)/)
  assert.match(api, /instanceFollowRedirects = false/)
  assert.match(manifest, /android:usesCleartextTraffic="false"/)
  assert.match(manifest, /android\.permission\.INTERNET/)
})
