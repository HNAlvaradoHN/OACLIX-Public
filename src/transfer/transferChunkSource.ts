import { TRANSFER_ENGINE_MAX_BYTES } from './transferManifest.ts'
import type { TransferContentKind } from '../shared/transferControlProtocol.ts'

export type TransferSourceProvider = 'local-text' | 'local-image'

export type TransferSourceReference = {
  version: 1
  provider: TransferSourceProvider
  itemId: string
}

export type TransferChunkSource = {
  contentKind: TransferContentKind
  byteSize: number
  reference: TransferSourceReference | null
  openBlob(): Promise<Blob>
}

const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/

function validContentKind(value: unknown): value is TransferContentKind {
  return value === 'text' || value === 'image' || value === 'file'
}

function validByteSize(value: unknown) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= TRANSFER_ENGINE_MAX_BYTES
}

export function validTransferSourceReference(value: unknown): value is TransferSourceReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 3 || keys[0] !== 'itemId' || keys[1] !== 'provider' || keys[2] !== 'version') return false
  return record.version === 1
    && (record.provider === 'local-text' || record.provider === 'local-image')
    && typeof record.itemId === 'string'
    && ITEM_ID_PATTERN.test(record.itemId)
}

export function createBlobTransferChunkSource(
  blob: Blob,
  contentKind: TransferContentKind,
  reference: TransferSourceReference | null = null,
): TransferChunkSource {
  if (!(blob instanceof Blob) || !validByteSize(blob.size) || !validContentKind(contentKind)) {
    throw new Error('Fuente de transferencia inválida')
  }
  if (reference !== null && !validTransferSourceReference(reference)) {
    throw new Error('Referencia de fuente inválida')
  }

  return {
    contentKind,
    byteSize: blob.size,
    reference: reference ? { ...reference } : null,
    async openBlob() {
      return blob
    },
  }
}

export async function openTransferChunkSource(source: TransferChunkSource) {
  if (!validContentKind(source.contentKind) || !validByteSize(source.byteSize)) {
    throw new Error('Fuente de transferencia inválida')
  }
  if (source.reference !== null && !validTransferSourceReference(source.reference)) {
    throw new Error('Referencia de fuente inválida')
  }

  const blob = await source.openBlob()
  if (!(blob instanceof Blob) || blob.size !== source.byteSize) {
    throw new Error('La fuente cambió desde que se preparó la transferencia')
  }
  return blob
}
