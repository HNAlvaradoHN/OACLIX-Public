import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTransferManifestFromBlob, TRANSFER_ENGINE_CHUNK_BYTES } from '../src/transfer/transferManifest.ts'
import {
  completeTransferJournal,
  createTransferJournal,
  markTransferChunkCompleted,
} from '../src/transfer/transferJournal.ts'
import {
  TRANSFER_STATE_CLOCK_SKEW_MS,
  TRANSFER_STATE_MAX_IDLE_MS,
  createTransferOperationStateSnapshot,
  restoreTransferOperationStateSnapshot,
} from '../src/transfer/transferStateStore.ts'

const senderDeviceId = 'dev_aaaaaaaaaaaaaaaa'
const receiverDeviceId = 'dev_bbbbbbbbbbbbbbbb'
const requestId = 'req_0123456789abcdef01234567'
const transferId = 'txf_0123456789abcdef0123456789abcdef'
const createdAt = 1_800_000_000_000
const sourceRef = {
  version: 1 as const,
  provider: 'local-image' as const,
  itemId: 'itm_0123456789abcdef0123456789abcdef',
}

async function resumableState(contentKind: 'file' | 'image' = 'file') {
  const manifest = await buildTransferManifestFromBlob(
    new Blob([new Uint8Array(TRANSFER_ENGINE_CHUNK_BYTES + 7)]),
    {
      requestId,
      transferId,
      senderDeviceId,
      receiverDeviceId,
      contentKind,
      createdAt,
    },
  )
  let journal = createTransferJournal(manifest, 'receiver', createdAt + 1)
  journal = markTransferChunkCompleted(journal, manifest, 0, createdAt + 2)
  const state = await createTransferOperationStateSnapshot(manifest, journal, createdAt + 3)
  return { manifest, journal, state }
}

test('snapshot durable conserva solo metadata técnica, sin payload', async () => {
  const { state } = await resumableState()
  const serialized = JSON.stringify(state)

  assert.deepEqual(Object.keys(state).sort(), ['journal', 'manifest', 'savedAt', 'sourceRef', 'type', 'version'])
  assert.equal(state.sourceRef, null)
  assert.doesNotMatch(serialized, /base64Data|fileName|payload|contentData|clipboardText/)
  assert.equal(await restoreTransferOperationStateSnapshot(state, createdAt + 4) !== null, true)
})

test('referencia local reabrible puede persistirse sin copiar el contenido', async () => {
  const { manifest, journal } = await resumableState('image')
  const state = await createTransferOperationStateSnapshot(manifest, journal, createdAt + 3, sourceRef)
  const restored = await restoreTransferOperationStateSnapshot(state, createdAt + 4)
  assert.deepEqual(restored?.sourceRef, sourceRef)
  assert.doesNotMatch(JSON.stringify(restored), /blob|base64Data|fileName|clipboardText/)
})

test('sourceRef debe corresponder al tipo real del manifest', async () => {
  const { manifest, journal, state } = await resumableState('file')
  await assert.rejects(
    () => createTransferOperationStateSnapshot(manifest, journal, createdAt + 3, sourceRef),
    /no coincide/,
  )
  assert.equal(
    await restoreTransferOperationStateSnapshot({ ...state, sourceRef }, createdAt + 4),
    null,
  )
})

test('estado inactivo expira y no se restaura indefinidamente', async () => {
  const { state } = await resumableState()
  assert.equal(
    await restoreTransferOperationStateSnapshot(state, state.savedAt + TRANSFER_STATE_MAX_IDLE_MS + 1),
    null,
  )
})

test('timestamp demasiado futuro se rechaza durante restauración', async () => {
  const { state } = await resumableState()
  const future = {
    ...state,
    savedAt: createdAt + TRANSFER_STATE_CLOCK_SKEW_MS + 100,
  }
  assert.equal(await restoreTransferOperationStateSnapshot(future, createdAt), null)
})

test('metadata añadida al snapshot se rechaza para evitar persistir contenido accidental', async () => {
  const { state } = await resumableState()
  const polluted = { ...state, payload: 'no debe persistirse' }
  assert.equal(await restoreTransferOperationStateSnapshot(polluted, createdAt + 4), null)
})

test('referencia de fuente con campos extra se rechaza', async () => {
  const { state } = await resumableState('image')
  const polluted = {
    ...state,
    sourceRef: { ...sourceRef, fileName: 'privado.png' },
  }
  assert.equal(await restoreTransferOperationStateSnapshot(polluted, createdAt + 4), null)
})

test('manifest alterado invalida la restauración aunque el journal conserve el mismo transferId', async () => {
  const { state } = await resumableState()
  const tampered = {
    ...state,
    manifest: { ...state.manifest, receiverDeviceId: 'dev_cccccccccccccccc' },
  }
  assert.equal(await restoreTransferOperationStateSnapshot(tampered, createdAt + 4), null)
})

test('estado complete no se persiste como reanudable', async () => {
  const manifest = await buildTransferManifestFromBlob(new Blob([new Uint8Array(9)]), {
    requestId,
    transferId,
    senderDeviceId,
    receiverDeviceId,
    contentKind: 'file',
    createdAt,
  })
  let journal = createTransferJournal(manifest, 'receiver', createdAt + 1)
  journal = markTransferChunkCompleted(journal, manifest, 0, createdAt + 2)
  journal = completeTransferJournal(journal, manifest, createdAt + 3)

  await assert.rejects(
    () => createTransferOperationStateSnapshot(manifest, journal, createdAt + 4),
    /no reanudable/,
  )
})
