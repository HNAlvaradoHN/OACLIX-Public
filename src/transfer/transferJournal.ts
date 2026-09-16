import {
  expectedTransferChunkBytes,
  validTransferManifestShape,
  type TransferManifest,
} from './transferManifest.ts'

export type TransferJournalRole = 'sender' | 'receiver'
export type TransferJournalStatus = 'prepared' | 'transferring' | 'complete' | 'cancelled'

export type TransferChunkRange = {
  start: number
  endExclusive: number
}

export type TransferJournal = {
  version: 1
  type: 'transfer-journal'
  transferId: string
  manifestSha256: string
  role: TransferJournalRole
  status: TransferJournalStatus
  completedRanges: TransferChunkRange[]
  createdAt: number
  updatedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  const allowed = [...expected].sort()
  return keys.length === allowed.length && keys.every((key, index) => key === allowed[index])
}

function validTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function normalizeRanges(ranges: TransferChunkRange[]) {
  if (ranges.length === 0) return []
  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((left, right) => left.start - right.start || left.endExclusive - right.endExclusive)
  const normalized: TransferChunkRange[] = []

  for (const range of sorted) {
    const last = normalized.at(-1)
    if (!last || range.start > last.endExclusive) {
      normalized.push(range)
      continue
    }
    if (range.endExclusive > last.endExclusive) last.endExclusive = range.endExclusive
  }
  return normalized
}

function validCanonicalRanges(value: unknown, chunkCount: number): value is TransferChunkRange[] {
  if (!Array.isArray(value)) return false
  let previousEnd = -1
  for (const entry of value) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['start', 'endExclusive'])) return false
    if (
      !Number.isSafeInteger(entry.start)
      || !Number.isSafeInteger(entry.endExclusive)
      || Number(entry.start) < 0
      || Number(entry.endExclusive) <= Number(entry.start)
      || Number(entry.endExclusive) > chunkCount
      || Number(entry.start) <= previousEnd
    ) return false
    previousEnd = Number(entry.endExclusive)
  }
  return true
}

export function validTransferJournal(value: unknown, manifest: TransferManifest): value is TransferJournal {
  if (!validTransferManifestShape(manifest) || !isRecord(value) || !hasOnlyKeys(value, [
    'version',
    'type',
    'transferId',
    'manifestSha256',
    'role',
    'status',
    'completedRanges',
    'createdAt',
    'updatedAt',
  ])) return false

  if (
    value.version !== 1
    || value.type !== 'transfer-journal'
    || value.transferId !== manifest.transferId
    || value.manifestSha256 !== manifest.manifestSha256
    || (value.role !== 'sender' && value.role !== 'receiver')
    || (value.status !== 'prepared'
      && value.status !== 'transferring'
      && value.status !== 'complete'
      && value.status !== 'cancelled')
    || !validCanonicalRanges(value.completedRanges, manifest.chunkCount)
    || !validTimestamp(value.createdAt)
    || !validTimestamp(value.updatedAt)
    || Number(value.updatedAt) < Number(value.createdAt)
  ) return false

  const complete = transferJournalHasAllChunks(value as TransferJournal, manifest)
  if (value.status === 'complete' && !complete) return false
  return true
}

export function createTransferJournal(
  manifest: TransferManifest,
  role: TransferJournalRole,
  now = Date.now(),
): TransferJournal {
  if (!validTransferManifestShape(manifest)) throw new Error('Manifest de transferencia inválido')
  if (role !== 'sender' && role !== 'receiver') throw new Error('Rol de journal inválido')
  if (!validTimestamp(now)) throw new Error('Timestamp de journal inválido')
  return {
    version: 1,
    type: 'transfer-journal',
    transferId: manifest.transferId,
    manifestSha256: manifest.manifestSha256,
    role,
    status: 'prepared',
    completedRanges: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function transferJournalHasChunk(journal: TransferJournal, chunkIndex: number) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) return false
  return journal.completedRanges.some((range) => chunkIndex >= range.start && chunkIndex < range.endExclusive)
}

export function transferJournalHasAllChunks(journal: TransferJournal, manifest: TransferManifest) {
  if (manifest.chunkCount === 0) return journal.completedRanges.length === 0
  return journal.completedRanges.length === 1
    && journal.completedRanges[0]?.start === 0
    && journal.completedRanges[0]?.endExclusive === manifest.chunkCount
}

export function completedTransferBytes(journal: TransferJournal, manifest: TransferManifest) {
  if (!validTransferJournal(journal, manifest)) return 0
  let bytes = 0
  for (const range of journal.completedRanges) {
    for (let index = range.start; index < range.endExclusive; index += 1) {
      bytes += expectedTransferChunkBytes(manifest.byteSize, index)
    }
  }
  return bytes
}

export function missingTransferChunkRanges(journal: TransferJournal, manifest: TransferManifest) {
  if (!validTransferJournal(journal, manifest)) throw new Error('Journal de transferencia inválido')
  const missing: TransferChunkRange[] = []
  let cursor = 0
  for (const range of journal.completedRanges) {
    if (cursor < range.start) missing.push({ start: cursor, endExclusive: range.start })
    cursor = range.endExclusive
  }
  if (cursor < manifest.chunkCount) missing.push({ start: cursor, endExclusive: manifest.chunkCount })
  return missing
}

export function markTransferChunkCompleted(
  journal: TransferJournal,
  manifest: TransferManifest,
  chunkIndex: number,
  now = Date.now(),
): TransferJournal {
  if (!validTransferJournal(journal, manifest)) throw new Error('Journal de transferencia inválido')
  if (journal.status === 'complete' || journal.status === 'cancelled') {
    throw new Error('Transferencia ya cerrada')
  }
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= manifest.chunkCount) {
    throw new Error('Chunk fuera de rango')
  }
  if (!validTimestamp(now) || now < journal.updatedAt) throw new Error('Timestamp de journal inválido')
  if (transferJournalHasChunk(journal, chunkIndex)) return { ...journal }

  const completedRanges = normalizeRanges([
    ...journal.completedRanges,
    { start: chunkIndex, endExclusive: chunkIndex + 1 },
  ])
  return {
    ...journal,
    status: 'transferring',
    completedRanges,
    updatedAt: now,
  }
}

export function completeTransferJournal(
  journal: TransferJournal,
  manifest: TransferManifest,
  now = Date.now(),
): TransferJournal {
  if (!validTransferJournal(journal, manifest)) throw new Error('Journal de transferencia inválido')
  if (journal.status === 'cancelled') throw new Error('Transferencia cancelada')
  if (!transferJournalHasAllChunks(journal, manifest)) throw new Error('Transferencia incompleta')
  if (!validTimestamp(now) || now < journal.updatedAt) throw new Error('Timestamp de journal inválido')
  return {
    ...journal,
    status: 'complete',
    updatedAt: now,
  }
}

export function cancelTransferJournal(
  journal: TransferJournal,
  manifest: TransferManifest,
  now = Date.now(),
): TransferJournal {
  if (!validTransferJournal(journal, manifest)) throw new Error('Journal de transferencia inválido')
  if (journal.status === 'complete') throw new Error('Transferencia ya completada')
  if (!validTimestamp(now) || now < journal.updatedAt) throw new Error('Timestamp de journal inválido')
  return {
    ...journal,
    status: 'cancelled',
    updatedAt: now,
  }
}

export function transferJournalCanResume(journal: TransferJournal, manifest: TransferManifest) {
  return validTransferJournal(journal, manifest)
    && (journal.status === 'prepared' || journal.status === 'transferring')
}
