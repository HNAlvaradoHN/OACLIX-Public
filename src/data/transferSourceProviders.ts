import {
  readLocalClipboardTexts,
  type TransferableLocalClipboardText,
} from './localClipboard.ts'
import {
  readLocalImages,
  type LocalImageClipboardSnapshot,
} from './localImageClipboard.ts'
import {
  createBlobTransferChunkSource,
  validTransferSourceReference,
  type TransferChunkSource,
  type TransferSourceReference,
} from '../transfer/transferChunkSource.ts'

export function createLocalTextTransferChunkSource(item: TransferableLocalClipboardText) {
  const reference: TransferSourceReference = {
    version: 1,
    provider: 'local-text',
    itemId: item.id,
  }
  const blob = new Blob([new TextEncoder().encode(item.text)], { type: 'text/plain;charset=utf-8' })
  return createBlobTransferChunkSource(blob, 'text', reference)
}

export function createLocalImageTransferChunkSource(item: LocalImageClipboardSnapshot) {
  const reference: TransferSourceReference = {
    version: 1,
    provider: 'local-image',
    itemId: item.id,
  }
  return createBlobTransferChunkSource(item.blob, 'image', reference)
}

export async function reopenLocalTransferChunkSource(
  reference: TransferSourceReference,
  now = Date.now(),
): Promise<TransferChunkSource | null> {
  if (!validTransferSourceReference(reference)) return null

  if (reference.provider === 'local-text') {
    const item = (await readLocalClipboardTexts(now)).find((candidate) => candidate.id === reference.itemId)
    return item ? createLocalTextTransferChunkSource(item) : null
  }

  const image = (await readLocalImages(now)).find((candidate) => candidate.id === reference.itemId)
  return image ? createLocalImageTransferChunkSource(image) : null
}
