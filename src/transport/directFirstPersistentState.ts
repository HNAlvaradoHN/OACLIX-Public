import type { DirectGapBufferSnapshot, DirectReplayLogSnapshot } from './directFirstGapRepair'
import {
  validDirectChangeEnvelope,
  type DirectApplyLedgerSnapshot,
  type DirectChangeEnvelope,
  type DirectDeliveryTrackerSnapshot,
} from './directFirstProtocol.ts'
import {
  DIRECT_TEXT_RETENTION_MS,
  validDirectOnlyExpiration,
} from './directFirstTombstonePolicy.ts'

export type DirectFirstCloudFallbackSeed = {
  changeId: string
  itemId: string
  text: string
  /** Ausentes únicamente en checkpoints legacy previos a la política de expiración original. */
  createdAt?: number
  expiresAt?: number
}

export type DirectFirstTombstone = {
  itemId: string
  retainUntil: number
}

export type DirectFirstPersistentState = {
  version: 1
  roomId: string
  localDeviceId: string
  logicalClock: number
  ledger: DirectApplyLedgerSnapshot
  deliveries: DirectDeliveryTrackerSnapshot[]
  replayLogs: DirectReplayLogSnapshot[]
  gapBuffer: DirectGapBufferSnapshot
  cloudFallbackSeeds?: DirectFirstCloudFallbackSeed[]
  cloudKnownItemIds?: string[]
  cloudCommittedChangeIds?: string[]
  /** Todos los itemIds borrados activos. Sin metadata en tombstones se consideran legacy y no se podan. */
  deletedItemIds?: string[]
  /** Metadata temporal disponible solo para tombstones nuevos que sí pueden compactarse con seguridad. */
  tombstones?: DirectFirstTombstone[]
  savedAt: number
}

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const CHANGE_ID_PATTERN = /^chg_[A-Za-z0-9_-]{20,96}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/

export function directFirstContentExpiresAt(change: DirectChangeEnvelope) {
  if (change.operation !== 'upsert') return null
  if (change.expiresAt !== undefined) return change.expiresAt
  const derived = change.createdAt + DIRECT_TEXT_RETENTION_MS
  return Number.isSafeInteger(derived) ? derived : null
}

export function redactExpiredDirectFirstChange(
  change: DirectChangeEnvelope,
  now: number,
): DirectChangeEnvelope {
  if (change.operation !== 'upsert' || typeof change.text !== 'string' || change.text.length === 0) return change
  const expiresAt = directFirstContentExpiresAt(change)
  if (expiresAt === null || now < expiresAt) return change
  return { ...change, text: '' }
}

function recoverLegacySeed(
  seed: DirectFirstCloudFallbackSeed,
  replayLogs: DirectReplayLogSnapshot[],
) {
  let recovered: DirectChangeEnvelope | null = null
  for (const replay of replayLogs) {
    for (const change of replay.changes) {
      if (
        change.operation !== 'upsert'
        || change.itemId !== seed.itemId
        || typeof change.text !== 'string'
        || change.text !== seed.text
      ) continue
      if (!recovered || change.createdAt > recovered.createdAt) recovered = change
    }
  }
  if (!recovered) return null
  const expiresAt = directFirstContentExpiresAt(recovered)
  if (expiresAt === null || !validDirectOnlyExpiration(recovered.createdAt, expiresAt)) return null
  return {
    ...seed,
    createdAt: recovered.createdAt,
    expiresAt,
  }
}

/**
 * El checkpoint necesita conservar secuencias/ACK/replay, pero no el contenido
 * del portapapeles después de su ventana de vida. Los upserts vencidos se
 * convierten en marcadores de secuencia con texto vacío. Así un gap todavía se
 * puede cerrar sin conservar ni reinyectar el texto original.
 */
export function redactExpiredDirectFirstContent(
  input: DirectFirstPersistentState,
  now: number,
): { state: DirectFirstPersistentState; changed: boolean } {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Timestamp de depuración direct-first inválido')
  let changed = false

  const redactChange = (change: DirectChangeEnvelope) => {
    const redacted = redactExpiredDirectFirstChange(change, now)
    if (redacted !== change) changed = true
    return redacted
  }

  const deliveries = input.deliveries.map((delivery) => {
    const change = redactChange(delivery.change)
    return change === delivery.change ? delivery : { ...delivery, change }
  })
  const replayLogs = input.replayLogs.map((replay) => {
    const changes = replay.changes.map(redactChange)
    return changes.some((change, index) => change !== replay.changes[index])
      ? { ...replay, changes }
      : replay
  })
  const gapChanges = input.gapBuffer.changes.map(redactChange)
  const gapBuffer = gapChanges.some((change, index) => change !== input.gapBuffer.changes[index])
    ? { ...input.gapBuffer, changes: gapChanges }
    : input.gapBuffer

  const originalSeeds = input.cloudFallbackSeeds
  const cloudFallbackSeeds = originalSeeds?.flatMap((seed) => {
    let normalized = seed
    if (seed.createdAt === undefined || seed.expiresAt === undefined) {
      const recovered = recoverLegacySeed(seed, input.replayLogs)
      if (!recovered) {
        changed = true
        return []
      }
      normalized = recovered
      changed = true
    }

    if (normalized.expiresAt !== undefined && now >= normalized.expiresAt && normalized.text.length > 0) {
      changed = true
      return [{ ...normalized, text: '' }]
    }
    return [normalized]
  })

  if (!changed) return { state: input, changed: false }
  return {
    changed: true,
    state: {
      ...input,
      deliveries,
      replayLogs,
      gapBuffer,
      ...(originalSeeds !== undefined ? { cloudFallbackSeeds } : {}),
      savedAt: now,
    },
  }
}

function uniqueStrings(values: unknown, pattern: RegExp) {
  if (!Array.isArray(values)) return false
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || !pattern.test(value) || seen.has(value)) return false
    seen.add(value)
  }
  return true
}

function validOptionalUniqueStrings(values: unknown, pattern: RegExp): values is string[] | undefined {
  return values === undefined || uniqueStrings(values, pattern)
}

function validTombstones(value: unknown) {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return false
    const input = entry as Partial<DirectFirstTombstone>
    if (typeof input.itemId !== 'string' || !ITEM_ID_PATTERN.test(input.itemId) || seen.has(input.itemId)) return false
    if (!Number.isSafeInteger(input.retainUntil) || (input.retainUntil ?? 0) <= 0) return false
    seen.add(input.itemId)
  }
  return true
}

function validLedger(value: unknown): value is DirectApplyLedgerSnapshot {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectApplyLedgerSnapshot>
  if (input.version !== 1 || !uniqueStrings(input.appliedChangeIds, CHANGE_ID_PATTERN)) return false
  if (!Array.isArray(input.lastSequenceByAuthor)) return false
  const authors = new Set<string>()
  for (const entry of input.lastSequenceByAuthor) {
    if (!Array.isArray(entry) || entry.length !== 2) return false
    const [authorDeviceId, sequence] = entry
    if (typeof authorDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(authorDeviceId) || authors.has(authorDeviceId)) return false
    if (!Number.isSafeInteger(sequence) || sequence < 0) return false
    authors.add(authorDeviceId)
  }
  return true
}

function validDelivery(value: unknown): value is DirectDeliveryTrackerSnapshot {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectDeliveryTrackerSnapshot>
  if (input.version !== 1 || !validDirectChangeEnvelope(input.change)) return false
  if (!uniqueStrings(input.pendingDeviceIds, DEVICE_ID_PATTERN) || !uniqueStrings(input.deliveredDeviceIds, DEVICE_ID_PATTERN)) return false
  const pending = input.pendingDeviceIds ?? []
  const delivered = input.deliveredDeviceIds ?? []
  if (pending.length + delivered.length === 0) return false
  const destinations = new Set([...pending, ...delivered])
  if (destinations.size !== pending.length + delivered.length) return false
  if (destinations.has(input.change.authorDeviceId)) return false
  return true
}

function validReplayLog(value: unknown): value is DirectReplayLogSnapshot {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectReplayLogSnapshot>
  if (input.version !== 1) return false
  if (typeof input.authorDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.authorDeviceId)) return false
  if (!Number.isSafeInteger(input.maxEntries) || (input.maxEntries ?? 0) <= 0) return false
  if (!Array.isArray(input.changes) || input.changes.length > (input.maxEntries ?? 0)) return false
  const sequences = new Set<number>()
  for (const change of input.changes) {
    if (!validDirectChangeEnvelope(change) || change.authorDeviceId !== input.authorDeviceId || sequences.has(change.authorSequence)) return false
    sequences.add(change.authorSequence)
  }
  return true
}

function validGapBuffer(value: unknown): value is DirectGapBufferSnapshot {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectGapBufferSnapshot>
  if (input.version !== 1) return false
  if (!Number.isSafeInteger(input.maxBufferedPerAuthor) || (input.maxBufferedPerAuthor ?? 0) <= 0) return false
  if (!Array.isArray(input.changes)) return false
  const counts = new Map<string, number>()
  const authorSequences = new Set<string>()
  for (const change of input.changes) {
    if (!validDirectChangeEnvelope(change)) return false
    const key = `${change.authorDeviceId}:${change.authorSequence}`
    if (authorSequences.has(key)) return false
    authorSequences.add(key)
    const count = (counts.get(change.authorDeviceId) ?? 0) + 1
    if (count > (input.maxBufferedPerAuthor ?? 0)) return false
    counts.set(change.authorDeviceId, count)
  }
  return true
}

function validCloudFallbackSeeds(
  value: unknown,
  deliveries: DirectDeliveryTrackerSnapshot[],
  savedAt: number,
): value is DirectFirstCloudFallbackSeed[] {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false

  const deliveriesByChangeId = new Map(deliveries.map((delivery) => [delivery.change.changeId, delivery]))
  const seen = new Set<string>()
  for (const seed of value) {
    if (!seed || typeof seed !== 'object') return false
    const input = seed as Partial<DirectFirstCloudFallbackSeed>
    if (typeof input.changeId !== 'string' || !CHANGE_ID_PATTERN.test(input.changeId) || seen.has(input.changeId)) return false
    if (typeof input.itemId !== 'string' || !ITEM_ID_PATTERN.test(input.itemId)) return false
    if (typeof input.text !== 'string') return false

    const hasCreatedAt = input.createdAt !== undefined
    const hasExpiresAt = input.expiresAt !== undefined
    if (hasCreatedAt !== hasExpiresAt) return false
    if (hasCreatedAt && !validDirectOnlyExpiration(input.createdAt!, input.expiresAt!)) return false
    if (input.text.length === 0 && (!hasExpiresAt || input.expiresAt! > savedAt)) return false

    const delivery = deliveriesByChangeId.get(input.changeId)
    if (!delivery || delivery.change.operation !== 'delete' || delivery.change.itemId !== input.itemId) return false
    if (delivery.pendingDeviceIds.length === 0) return false
    seen.add(input.changeId)
  }
  return true
}

function validCloudProgress(
  cloudKnownItemIds: unknown,
  cloudCommittedChangeIds: unknown,
  deliveries: DirectDeliveryTrackerSnapshot[],
) {
  if (!validOptionalUniqueStrings(cloudKnownItemIds, ITEM_ID_PATTERN)) return false
  if (!validOptionalUniqueStrings(cloudCommittedChangeIds, CHANGE_ID_PATTERN)) return false
  if (cloudCommittedChangeIds === undefined) return true

  const deliveryChangeIds = new Set(deliveries.map((delivery) => delivery.change.changeId))
  return cloudCommittedChangeIds.every((changeId) => deliveryChangeIds.has(changeId))
}

export function validDirectFirstPersistentState(value: unknown): value is DirectFirstPersistentState {
  if (!value || typeof value !== 'object') return false
  const input = value as Partial<DirectFirstPersistentState>
  if (input.version !== 1) return false
  if (typeof input.roomId !== 'string' || !ROOM_ID_PATTERN.test(input.roomId)) return false
  if (typeof input.localDeviceId !== 'string' || !DEVICE_ID_PATTERN.test(input.localDeviceId)) return false
  if (!Number.isSafeInteger(input.logicalClock) || (input.logicalClock ?? -1) < 0) return false
  if (typeof input.savedAt !== 'number' || !Number.isSafeInteger(input.savedAt) || input.savedAt <= 0) return false
  if (!validLedger(input.ledger) || !Array.isArray(input.deliveries) || !input.deliveries.every(validDelivery)) return false
  if (!Array.isArray(input.replayLogs) || !input.replayLogs.every(validReplayLog)) return false
  if (!validGapBuffer(input.gapBuffer)) return false
  if (!validCloudFallbackSeeds(input.cloudFallbackSeeds, input.deliveries, input.savedAt)) return false
  if (!validCloudProgress(input.cloudKnownItemIds, input.cloudCommittedChangeIds, input.deliveries)) return false
  if (!validOptionalUniqueStrings(input.deletedItemIds, ITEM_ID_PATTERN)) return false
  if (!validTombstones(input.tombstones)) return false

  const replayAuthors = new Set<string>()
  for (const log of input.replayLogs) {
    if (replayAuthors.has(log.authorDeviceId)) return false
    replayAuthors.add(log.authorDeviceId)
  }
  const deliveryChanges = new Set<string>()
  for (const delivery of input.deliveries) {
    if (deliveryChanges.has(delivery.change.changeId)) return false
    deliveryChanges.add(delivery.change.changeId)
  }
  return true
}
