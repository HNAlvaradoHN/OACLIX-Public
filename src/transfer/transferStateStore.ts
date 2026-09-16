import {
  validTransferManifestShape,
  verifyTransferManifest,
  type TransferManifest,
} from './transferManifest.ts'
import {
  transferJournalCanResume,
  validTransferJournal,
  type TransferJournal,
} from './transferJournal.ts'
import {
  validTransferSourceReference,
  type TransferSourceReference,
} from './transferChunkSource.ts'

const DATABASE_NAME = 'oaclix-transfer-engine'
const DATABASE_VERSION = 1
const STORE_NAME = 'operations'
const TRANSFER_ID_PATTERN = /^txf_[a-f0-9]{32}$/

export const TRANSFER_STATE_MAX_IDLE_MS = 24 * 60 * 60 * 1000
export const TRANSFER_STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const TRANSFER_STATE_CLOCK_SKEW_MS = 5 * 60 * 1000

export type TransferOperationState = {
  version: 1
  type: 'transfer-operation-state'
  manifest: TransferManifest
  journal: TransferJournal
  sourceRef: TransferSourceReference | null
  savedAt: number
}

let mutationQueue: Promise<void> = Promise.resolve()

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

function validSourceReference(value: unknown) {
  return value === null || validTransferSourceReference(value)
}

function sourceReferenceMatchesManifest(
  sourceRef: TransferSourceReference | null,
  manifest: TransferManifest,
) {
  if (sourceRef === null) return true
  if (sourceRef.provider === 'local-text') return manifest.contentKind === 'text'
  if (sourceRef.provider === 'local-image') return manifest.contentKind === 'image'
  return false
}

function stateWithinRetention(state: TransferOperationState, now: number) {
  if (!validTimestamp(now)) return false
  if (state.manifest.createdAt > now + TRANSFER_STATE_CLOCK_SKEW_MS) return false
  if (state.journal.updatedAt > now + TRANSFER_STATE_CLOCK_SKEW_MS) return false
  if (state.savedAt > now + TRANSFER_STATE_CLOCK_SKEW_MS) return false
  if (state.savedAt < state.journal.updatedAt) return false
  if (now - state.savedAt > TRANSFER_STATE_MAX_IDLE_MS) return false
  if (now - state.manifest.createdAt > TRANSFER_STATE_MAX_AGE_MS) return false
  return true
}

export async function restoreTransferOperationStateSnapshot(
  value: unknown,
  now = Date.now(),
): Promise<TransferOperationState | null> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'type', 'manifest', 'journal', 'sourceRef', 'savedAt'])) return null
  if (
    value.version !== 1
    || value.type !== 'transfer-operation-state'
    || !validTimestamp(value.savedAt)
    || !validSourceReference(value.sourceRef)
  ) return null
  if (!validTransferManifestShape(value.manifest) || !(await verifyTransferManifest(value.manifest))) return null
  if (!validTransferJournal(value.journal, value.manifest) || !transferJournalCanResume(value.journal, value.manifest)) return null
  const sourceRef = value.sourceRef === null ? null : value.sourceRef
  if (!sourceReferenceMatchesManifest(sourceRef, value.manifest)) return null

  const state: TransferOperationState = {
    version: 1,
    type: 'transfer-operation-state',
    manifest: value.manifest,
    journal: value.journal,
    sourceRef: sourceRef ? { ...sourceRef } : null,
    savedAt: Number(value.savedAt),
  }
  return stateWithinRetention(state, now) ? state : null
}

export async function createTransferOperationStateSnapshot(
  manifest: TransferManifest,
  journal: TransferJournal,
  now = Date.now(),
  sourceRef: TransferSourceReference | null = null,
): Promise<TransferOperationState> {
  if (!validTimestamp(now)) throw new Error('Timestamp de estado inválido')
  if (!validSourceReference(sourceRef)) throw new Error('Referencia de fuente inválida')
  if (!validTransferManifestShape(manifest) || !(await verifyTransferManifest(manifest))) {
    throw new Error('Manifest de transferencia inválido')
  }
  if (!sourceReferenceMatchesManifest(sourceRef, manifest)) {
    throw new Error('La referencia de fuente no coincide con el contenido')
  }
  if (!validTransferJournal(journal, manifest) || !transferJournalCanResume(journal, manifest)) {
    throw new Error('Journal no reanudable')
  }
  if (journal.updatedAt > now + TRANSFER_STATE_CLOCK_SKEW_MS) throw new Error('Reloj de journal inválido')
  if (manifest.createdAt > now + TRANSFER_STATE_CLOCK_SKEW_MS) throw new Error('Reloj de manifest inválido')
  if (now - manifest.createdAt > TRANSFER_STATE_MAX_AGE_MS) throw new Error('Transferencia demasiado antigua')

  return {
    version: 1,
    type: 'transfer-operation-state',
    manifest,
    journal,
    sourceRef: sourceRef ? { ...sourceRef } : null,
    savedAt: now,
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('El almacenamiento de transferencias no está disponible'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el estado de transferencias'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function enqueueMutation<T>(operation: () => Promise<T>) {
  const queued = mutationQueue.then(operation, operation)
  mutationQueue = queued.then(() => undefined, () => undefined)
  return queued
}

async function writeState(state: TransferOperationState) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el estado de transferencia'))
      transaction.oncomplete = () => resolve()
      transaction.objectStore(STORE_NAME).put(state, state.manifest.transferId)
    })
  } finally {
    database.close()
  }
}

async function deleteKeys(keys: IDBValidKey[]) {
  if (keys.length === 0) return
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo limpiar el estado de transferencias'))
      transaction.oncomplete = () => resolve()
      for (const key of keys) store.delete(key)
    })
  } finally {
    database.close()
  }
}

export async function saveTransferOperationState(
  manifest: TransferManifest,
  journal: TransferJournal,
  now = Date.now(),
  sourceRef: TransferSourceReference | null = null,
) {
  const state = await createTransferOperationStateSnapshot(manifest, journal, now, sourceRef)
  return enqueueMutation(async () => {
    await writeState(state)
    return state
  })
}

export async function readTransferOperationStates(now = Date.now()) {
  const database = await openDatabase()
  let values: unknown[] = []
  let keys: IDBValidKey[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const valuesRequest = store.getAll()
      const keysRequest = store.getAllKeys()
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo leer el estado de transferencias'))
      transaction.oncomplete = () => resolve()
      valuesRequest.onsuccess = () => { values = valuesRequest.result as unknown[] }
      keysRequest.onsuccess = () => { keys = keysRequest.result }
    })
  } finally {
    database.close()
  }

  const valid: TransferOperationState[] = []
  const staleKeys: IDBValidKey[] = []
  for (let index = 0; index < values.length; index += 1) {
    const restored = await restoreTransferOperationStateSnapshot(values[index], now)
    const key = keys[index]
    if (!restored) {
      if (key !== undefined) staleKeys.push(key)
      continue
    }
    if (key !== restored.manifest.transferId) {
      if (key !== undefined) staleKeys.push(key)
      continue
    }
    valid.push(restored)
  }

  if (staleKeys.length > 0) await enqueueMutation(() => deleteKeys(staleKeys))
  return valid.sort((left, right) => right.savedAt - left.savedAt || left.manifest.transferId.localeCompare(right.manifest.transferId))
}

export function deleteTransferOperationState(transferId: string) {
  if (!TRANSFER_ID_PATTERN.test(transferId)) return Promise.reject(new Error('Identificador de transferencia inválido'))
  return enqueueMutation(() => deleteKeys([transferId]))
}

export async function clearTransferOperationStates() {
  const database = await openDatabase()
  let keys: IDBValidKey[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).getAllKeys()
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo enumerar el estado de transferencias'))
      transaction.oncomplete = () => resolve()
      request.onsuccess = () => { keys = request.result }
    })
  } finally {
    database.close()
  }
  await enqueueMutation(() => deleteKeys(keys))
}
