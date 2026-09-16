import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRANSFER_ENGINE_CHUNK_BYTES,
  buildTransferManifestFromBlob,
} from '../src/transfer/transferManifest.ts'
import {
  completeTransferJournal,
  completedTransferBytes,
  createTransferJournal,
  markTransferChunkCompleted,
  missingTransferChunkRanges,
  transferJournalCanResume,
  validTransferJournal,
} from '../src/transfer/transferJournal.ts'

const input = {
  requestId: 'req_0123456789abcdef01234567',
  transferId: 'txf_0123456789abcdef0123456789abcdef',
  senderDeviceId: 'dev_aaaaaaaaaaaaaaaa',
  receiverDeviceId: 'dev_bbbbbbbbbbbbbbbb',
  contentKind: 'file' as const,
  createdAt: 1_800_000_000_000,
}

function bytes(size: number) {
  const value = new Uint8Array(size)
  for (let index = 0; index < value.length; index += 1) value[index] = (index * 7) % 251
  return value
}

test('journal compacta progreso en rangos y produce un plan de reanudación', async () => {
  const manifest = await buildTransferManifestFromBlob(
    new Blob([bytes(TRANSFER_ENGINE_CHUNK_BYTES * 2 + 11)]),
    input,
  )
  let journal = createTransferJournal(manifest, 'receiver', 1_800_000_000_100)

  assert.deepEqual(missingTransferChunkRanges(journal, manifest), [{ start: 0, endExclusive: 3 }])
  journal = markTransferChunkCompleted(journal, manifest, 1, 1_800_000_000_200)
  assert.deepEqual(journal.completedRanges, [{ start: 1, endExclusive: 2 }])
  assert.deepEqual(missingTransferChunkRanges(journal, manifest), [
    { start: 0, endExclusive: 1 },
    { start: 2, endExclusive: 3 },
  ])

  journal = markTransferChunkCompleted(journal, manifest, 0, 1_800_000_000_300)
  assert.deepEqual(journal.completedRanges, [{ start: 0, endExclusive: 2 }])
  assert.equal(completedTransferBytes(journal, manifest), TRANSFER_ENGINE_CHUNK_BYTES * 2)
  assert.equal(transferJournalCanResume(journal, manifest), true)
})

test('marcar el mismo chunk es idempotente y no duplica progreso', async () => {
  const manifest = await buildTransferManifestFromBlob(new Blob([bytes(128)]), input)
  let journal = createTransferJournal(manifest, 'sender', 1_800_000_000_100)
  journal = markTransferChunkCompleted(journal, manifest, 0, 1_800_000_000_200)
  const repeated = markTransferChunkCompleted(journal, manifest, 0, 1_800_000_000_300)
  assert.deepEqual(repeated.completedRanges, [{ start: 0, endExclusive: 1 }])
  assert.equal(completedTransferBytes(repeated, manifest), 128)
})

test('journal no puede declararse completo antes de cubrir todos los chunks', async () => {
  const manifest = await buildTransferManifestFromBlob(
    new Blob([bytes(TRANSFER_ENGINE_CHUNK_BYTES + 1)]),
    input,
  )
  let journal = createTransferJournal(manifest, 'receiver', 1_800_000_000_100)
  journal = markTransferChunkCompleted(journal, manifest, 0, 1_800_000_000_200)
  assert.throws(() => completeTransferJournal(journal, manifest, 1_800_000_000_300), /incompleta/)

  journal = markTransferChunkCompleted(journal, manifest, 1, 1_800_000_000_300)
  const complete = completeTransferJournal(journal, manifest, 1_800_000_000_400)
  assert.equal(complete.status, 'complete')
  assert.equal(transferJournalCanResume(complete, manifest), false)
})

test('journal queda ligado al hash exacto del manifest para evitar reanudar otra transferencia', async () => {
  const manifest = await buildTransferManifestFromBlob(new Blob([bytes(64)]), input)
  const other = await buildTransferManifestFromBlob(new Blob([bytes(65)]), {
    ...input,
    transferId: 'txf_fedcba9876543210fedcba9876543210',
  })
  const journal = createTransferJournal(manifest, 'receiver', 1_800_000_000_100)

  assert.equal(validTransferJournal(journal, manifest), true)
  assert.equal(validTransferJournal(journal, other), false)
  assert.doesNotMatch(JSON.stringify(journal), /payload|base64Data|fileName|contentData/)
})
