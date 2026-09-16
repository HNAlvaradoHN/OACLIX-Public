import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  createBlobTransferChunkSource,
  openTransferChunkSource,
  validTransferSourceReference,
} from '../src/transfer/transferChunkSource.ts'

const itemId = 'itm_0123456789abcdef0123456789abcdef'

test('fuente Blob conserva tamaño/tipo y una referencia local no contiene contenido', async () => {
  const reference = { version: 1 as const, provider: 'local-image' as const, itemId }
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })
  const source = createBlobTransferChunkSource(blob, 'image', reference)

  assert.equal(source.byteSize, 4)
  assert.equal(source.contentKind, 'image')
  assert.deepEqual(source.reference, reference)
  assert.equal((await openTransferChunkSource(source)).size, 4)
  assert.doesNotMatch(JSON.stringify(source.reference), /payload|base64|fileName|content/)
})

test('referencia de fuente usa esquema cerrado y rechaza campos privados extra', () => {
  assert.equal(validTransferSourceReference({ version: 1, provider: 'local-text', itemId }), true)
  assert.equal(validTransferSourceReference({ version: 1, provider: 'local-image', itemId }), true)
  assert.equal(validTransferSourceReference({ version: 1, provider: 'local-text', itemId, fileName: 'x.txt' }), false)
  assert.equal(validTransferSourceReference({ version: 1, provider: 'native-file', itemId }), false)
})

test('adaptadores locales reabren texto e imagen por itemId técnico sin persistir payload en sourceRef', async () => {
  const source = await readFile(new URL('../src/data/transferSourceProviders.ts', import.meta.url), 'utf8')
  assert.match(source, /new TextEncoder\(\)\.encode\(item\.text\)/)
  assert.match(source, /provider: 'local-text'[\s\S]*itemId: item\.id/)
  assert.match(source, /provider: 'local-image'[\s\S]*itemId: item\.id/)
  assert.match(source, /readLocalClipboardTexts\(now\)[\s\S]*candidate\.id === reference\.itemId/)
  assert.match(source, /readLocalImages\(now\)[\s\S]*candidate\.id === reference\.itemId/)
  assert.doesNotMatch(source, /fileName|base64Data|contentUri|absolutePath/)
})
