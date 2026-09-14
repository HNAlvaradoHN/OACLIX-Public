import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const androidRoot = new URL('../android/', import.meta.url)

async function readAndroid(path: string) {
  return readFile(new URL(path, androidRoot), 'utf8')
}

test('la identidad Android mantiene P-256 en Android Keystore sin contaminar la persistencia local', async () => {
  const [identity, protocol, shareReceiver, localRepository, localHistory] = await Promise.all([
    readAndroid('app/src/main/java/app/oaclix/android/identity/AndroidKeystoreDeviceIdentity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/identity/DeviceIdentityProtocol.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/ShareReceiverActivity.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/localclipboard/SqliteLocalClipboardRepository.kt'),
    readAndroid('app/src/main/java/app/oaclix/android/localclipboard/LocalClipboardHistory.kt'),
  ])
  assert.match(identity, /AndroidKeyStore/)
  assert.match(identity, /secp256r1/)
  assert.match(identity, /KeyProperties\.PURPOSE_SIGN/)
  assert.match(identity, /KeyProperties\.DIGEST_SHA256/)
  assert.match(identity, /SHA256withECDSA/)
  assert.doesNotMatch(identity, /privateKey\.encoded|getEncoded\(\)/)
  assert.match(protocol, /oaclix-bootstrap\|1\|/)
  assert.match(protocol, /oaclix-action\|1\|/)
  assert.match(protocol, /derToP1363/)
  assert.doesNotMatch(identity, /HttpURLConnection|URLConnection|OkHttp|https?:\/\//)
  assert.doesNotMatch(protocol, /HttpURLConnection|URLConnection|OkHttp|https?:\/\//)
  assert.doesNotMatch(shareReceiver, /AndroidKeystoreDeviceIdentity/)
  assert.match(shareReceiver, /history\.save\(text\)/)
  assert.doesNotMatch(localRepository, /AndroidKeystoreDeviceIdentity|NativeIdentityLinkingApi|HttpURLConnection|URLConnection|OkHttp/)
  assert.doesNotMatch(localHistory, /AndroidKeystoreDeviceIdentity|NativeIdentityLinkingApi|HttpURLConnection|URLConnection|OkHttp/)
})
