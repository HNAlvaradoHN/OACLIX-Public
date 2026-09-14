import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

async function read(path: string) {
  return readFile(new URL(path, root), 'utf8')
}

test('PWA guarda imágenes locales con retención vigente y sin aplicar el límite cloud', async () => {
  const [localStore, sharedPolicy] = await Promise.all([
    read('src/data/localImageClipboard.ts'),
    read('src/shared/localImageTransferCore.ts'),
  ])

  assert.match(localStore, /prepareLocalImageBlob/)
  assert.match(localStore, /storeLocalImageBlob/)
  assert.match(localStore, /byteSize: blob\.size/)
  assert.match(localStore, /expiresAt: now \+ LOCAL_IMAGE_RETENTION_MS/)
  assert.match(localStore, /SUPPORTED_MIME_TYPES\.has\(blob\.type\)/)
  assert.doesNotMatch(localStore, /IMAGE_CLOUD_COPY_MAX_BYTES|10 \* 1024 \* 1024|10_485_760/)
  assert.match(sharedPolicy, /LOCAL_IMAGE_RETENTION_MS = 6 \* 60 \* 60 \* 1000/)
})

test('UI local ofrece pegado explícito y copia de imagen mediante PNG compatible', async () => {
  const [composer, card, clipboardBridge] = await Promise.all([
    read('src/components/ClipboardComposer.tsx'),
    read('src/components/ClipboardCard.tsx'),
    read('src/clipboard/imageSystemClipboard.ts'),
  ])

  assert.match(composer, /Pegar imagen/)
  assert.match(composer, /readImageFromSystemClipboard/)
  assert.match(composer, /onPaste=\{handlePaste\}/)
  assert.match(composer, /storeLocalImageBlob/)
  assert.match(card, /copyImageUrlToSystemClipboard/)
  assert.match(clipboardBridge, /canvas\.toBlob/)
  assert.match(clipboardBridge, /'image\/png'/)
  assert.match(clipboardBridge, /clipboard\.write/)
  assert.doesNotMatch(clipboardBridge, /setInterval|addEventListener\(['"]copy|clipboardchange/)
})
