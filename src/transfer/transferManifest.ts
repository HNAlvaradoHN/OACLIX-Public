import type { TransferContentKind } from '../shared/transferControlProtocol.ts'

export const TRANSFER_ENGINE_CHUNK_BYTES = 4 * 1024 * 1024
export const TRANSFER_ENGINE_MAX_BYTES = 1024 * 1024 * 1024 * 1024

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const REQUEST_ID_PATTERN = /^req_[a-f0-9]{24}$/
const TRANSFER_ID_PATTERN = /^txf_[a-f0-9]{32}$/
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

export type TransferChunkDescriptor = {
  index: number
  byteLength: number
  sha256: string
}

export type TransferManifest = {
  version: 1
  type: 'transfer-manifest'
  transferId: string
  requestId: string
  senderDeviceId: string
  receiverDeviceId: string
  contentKind: TransferContentKind
  byteSize: number
  chunkSize: number
  chunkCount: number
  chunks: TransferChunkDescriptor[]
  manifestSha256: string
  createdAt: number
}

type UnsignedTransferManifest = Omit<TransferManifest, 'manifestSha256'>

export type BuildTransferManifestInput = {
  requestId: string
  senderDeviceId: string
  receiverDeviceId: string
  contentKind: TransferContentKind
  transferId?: string
  createdAt?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  const allowed = [...expected].sort()
  return keys.length === allowed.length && keys.every((key, index) => key === allowed[index])
}

function validDeviceId(value: unknown) {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value)
}

function validRequestId(value: unknown) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

function validTransferId(value: unknown) {
  return typeof value === 'string' && TRANSFER_ID_PATTERN.test(value)
}

function validContentKind(value: unknown): value is TransferContentKind {
  return value === 'text' || value === 'image' || value === 'file'
}

function validTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function validByteSize(value: unknown) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= TRANSFER_ENGINE_MAX_BYTES
}

function bytesForDigest(value: ArrayBuffer | Uint8Array) {
  if (value instanceof Uint8Array) return Uint8Array.from(value).buffer
  return value
}

export async function sha256Hex(value: ArrayBuffer | Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytesForDigest(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomTransferId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `txf_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function validChunkDescriptor(value: unknown, expectedIndex: number, expectedBytes: number) {
  if (!isRecord(value) || !hasOnlyKeys(value, ['index', 'byteLength', 'sha256'])) return false
  return value.index === expectedIndex
    && value.byteLength === expectedBytes
    && typeof value.sha256 === 'string'
    && SHA256_HEX_PATTERN.test(value.sha256)
}

export function expectedTransferChunkBytes(byteSize: number, chunkIndex: number) {
  if (!validByteSize(byteSize) || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) return 0
  const chunkCount = Math.ceil(byteSize / TRANSFER_ENGINE_CHUNK_BYTES)
  if (chunkIndex >= chunkCount) return 0
  if (chunkIndex < chunkCount - 1) return TRANSFER_ENGINE_CHUNK_BYTES
  return byteSize - TRANSFER_ENGINE_CHUNK_BYTES * (chunkCount - 1)
}

export function validTransferManifestShape(value: unknown): value is TransferManifest {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'version',
    'type',
    'transferId',
    'requestId',
    'senderDeviceId',
    'receiverDeviceId',
    'contentKind',
    'byteSize',
    'chunkSize',
    'chunkCount',
    'chunks',
    'manifestSha256',
    'createdAt',
  ])) return false

  if (
    value.version !== 1
    || value.type !== 'transfer-manifest'
    || !validTransferId(value.transferId)
    || !validRequestId(value.requestId)
    || !validDeviceId(value.senderDeviceId)
    || !validDeviceId(value.receiverDeviceId)
    || value.senderDeviceId === value.receiverDeviceId
    || !validContentKind(value.contentKind)
    || !validByteSize(value.byteSize)
    || value.chunkSize !== TRANSFER_ENGINE_CHUNK_BYTES
    || !Number.isSafeInteger(value.chunkCount)
    || !Array.isArray(value.chunks)
    || typeof value.manifestSha256 !== 'string'
    || !SHA256_HEX_PATTERN.test(value.manifestSha256)
    || !validTimestamp(value.createdAt)
  ) return false

  const byteSize = Number(value.byteSize)
  const chunkCount = Math.ceil(byteSize / TRANSFER_ENGINE_CHUNK_BYTES)
  if (value.chunkCount !== chunkCount || value.chunks.length !== chunkCount) return false

  return value.chunks.every((chunk, index) => (
    validChunkDescriptor(chunk, index, expectedTransferChunkBytes(byteSize, index))
  ))
}

function unsignedManifest(value: TransferManifest): UnsignedTransferManifest {
  return {
    version: value.version,
    type: value.type,
    transferId: value.transferId,
    requestId: value.requestId,
    senderDeviceId: value.senderDeviceId,
    receiverDeviceId: value.receiverDeviceId,
    contentKind: value.contentKind,
    byteSize: value.byteSize,
    chunkSize: value.chunkSize,
    chunkCount: value.chunkCount,
    chunks: value.chunks.map((chunk) => ({ ...chunk })),
    createdAt: value.createdAt,
  }
}

function canonicalManifest(value: UnsignedTransferManifest) {
  const chunks = value.chunks
    .map((chunk) => `${chunk.index}:${chunk.byteLength}:${chunk.sha256}`)
    .join('\n')
  return [
    'oaclix-transfer-manifest-v1',
    value.transferId,
    value.requestId,
    value.senderDeviceId,
    value.receiverDeviceId,
    value.contentKind,
    String(value.byteSize),
    String(value.chunkSize),
    String(value.chunkCount),
    String(value.createdAt),
    chunks,
  ].join('\n')
}

export async function computeTransferManifestSha256(value: UnsignedTransferManifest) {
  return sha256Hex(new TextEncoder().encode(canonicalManifest(value)))
}

export async function verifyTransferManifest(value: unknown): Promise<boolean> {
  if (!validTransferManifestShape(value)) return false
  return (await computeTransferManifestSha256(unsignedManifest(value))) === value.manifestSha256
}

export async function verifyTransferChunk(
  manifest: TransferManifest,
  chunkIndex: number,
  bytes: ArrayBuffer | Uint8Array,
) {
  if (!validTransferManifestShape(manifest)) return false
  const descriptor = manifest.chunks[chunkIndex]
  if (!descriptor) return false
  const buffer = bytesForDigest(bytes)
  if (buffer.byteLength !== descriptor.byteLength) return false
  return (await sha256Hex(buffer)) === descriptor.sha256
}

export async function buildTransferManifestFromBlob(
  blob: Blob,
  input: BuildTransferManifestInput,
): Promise<TransferManifest> {
  if (!validByteSize(blob.size)) throw new Error('Tamaño de transferencia inválido')
  const transferId = input.transferId ?? randomTransferId()
  const createdAt = input.createdAt ?? Date.now()
  const chunkCount = Math.ceil(blob.size / TRANSFER_ENGINE_CHUNK_BYTES)
  const chunks: TransferChunkDescriptor[] = []

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * TRANSFER_ENGINE_CHUNK_BYTES
    const end = Math.min(start + TRANSFER_ENGINE_CHUNK_BYTES, blob.size)
    const buffer = await blob.slice(start, end).arrayBuffer()
    chunks.push({
      index,
      byteLength: buffer.byteLength,
      sha256: await sha256Hex(buffer),
    })
  }

  const unsigned: UnsignedTransferManifest = {
    version: 1,
    type: 'transfer-manifest',
    transferId,
    requestId: input.requestId,
    senderDeviceId: input.senderDeviceId,
    receiverDeviceId: input.receiverDeviceId,
    contentKind: input.contentKind,
    byteSize: blob.size,
    chunkSize: TRANSFER_ENGINE_CHUNK_BYTES,
    chunkCount,
    chunks,
    createdAt,
  }
  const manifest: TransferManifest = {
    ...unsigned,
    manifestSha256: await computeTransferManifestSha256(unsigned),
  }
  if (!validTransferManifestShape(manifest)) throw new Error('Manifest de transferencia inválido')
  return manifest
}
