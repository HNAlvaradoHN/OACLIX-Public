import type { ClipboardTextSnapshot } from './clipboardApi'

const DATABASE_NAME = 'oaclix-preserved'
const STORE_NAME = 'text-items'

let mutationQueue: Promise<void> = Promise.resolve()

type StoredPreservedText = {
  version: 1
  roomId: string
  item: ClipboardTextSnapshot
  savedAt: number
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('El almacenamiento local no está disponible'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento local'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function recordKey(roomId: string, itemId: string) {
  return `${roomId}:${itemId}`
}

function isClipboardTextSnapshot(value: unknown): value is ClipboardTextSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ClipboardTextSnapshot>
  return typeof item.sequence === 'number'
    && Number.isSafeInteger(item.sequence)
    && typeof item.id === 'string'
    && /^itm_[A-Za-z0-9_-]{16,80}$/.test(item.id)
    && typeof item.authorPersonId === 'string'
    && typeof item.authorDeviceId === 'string'
    && typeof item.text === 'string'
    && typeof item.createdAt === 'number'
    && Number.isFinite(item.createdAt)
    && typeof item.expiresAt === 'number'
    && Number.isFinite(item.expiresAt)
}

function isStoredRecord(value: unknown): value is StoredPreservedText {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredPreservedText>
  return record.version === 1
    && typeof record.roomId === 'string'
    && record.roomId.length > 0
    && typeof record.savedAt === 'number'
    && Number.isFinite(record.savedAt)
    && isClipboardTextSnapshot(record.item)
}

function enqueueMutation(operation: () => Promise<void>) {
  const queued = mutationQueue.then(operation, operation)
  mutationQueue = queued.catch(() => undefined)
  return queued
}

async function readStoredRecords(database: IDBDatabase) {
  return new Promise<{ records: unknown[]; keys: IDBValidKey[] }>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    const recordsRequest = store.getAll()
    const keysRequest = store.getAllKeys()
    let records: unknown[] = []
    let keys: IDBValidKey[] = []

    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo leer lo conservado'))
    transaction.oncomplete = () => resolve({ records, keys })
    recordsRequest.onsuccess = () => { records = recordsRequest.result as unknown[] }
    keysRequest.onsuccess = () => { keys = keysRequest.result }
  })
}

async function deleteStoredKeys(database: IDBDatabase, keys: IDBValidKey[]) {
  if (keys.length === 0) return
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo limpiar lo conservado'))
    transaction.oncomplete = () => resolve()
    for (const key of keys) store.delete(key)
  })
}

async function writePreservedText(roomId: string, item: ClipboardTextSnapshot) {
  const database = await openDatabase()
  try {
    const record: StoredPreservedText = {
      version: 1,
      roomId,
      item,
      savedAt: Date.now(),
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo conservar en este dispositivo'))
      transaction.oncomplete = () => resolve()
      transaction.objectStore(STORE_NAME).put(record, recordKey(roomId, item.id))
    })
  } finally {
    database.close()
  }
}

async function deletePreservedText(roomId: string, itemId: string) {
  const database = await openDatabase()
  try {
    await deleteStoredKeys(database, [recordKey(roomId, itemId)])
  } finally {
    database.close()
  }
}

export async function readLocalPreservedTexts(roomId: string) {
  const database = await openDatabase()
  try {
    const { records, keys } = await readStoredRecords(database)
    const invalidKeys: IDBValidKey[] = []
    const validRecords: StoredPreservedText[] = []

    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      const key = keys[index]
      if (!isStoredRecord(record) || key !== recordKey(record.roomId, record.item.id)) {
        if (key !== undefined) invalidKeys.push(key)
        continue
      }
      validRecords.push(record)
    }

    await deleteStoredKeys(database, invalidKeys)

    return validRecords
      .filter((record) => record.roomId === roomId)
      .map((record) => record.item)
      .sort((a, b) => b.sequence - a.sequence)
  } finally {
    database.close()
  }
}

export function preserveTextOnThisDevice(roomId: string, item: ClipboardTextSnapshot) {
  if (!roomId || !isClipboardTextSnapshot(item)) return Promise.reject(new Error('Contenido inválido para conservar'))
  return enqueueMutation(() => writePreservedText(roomId, item))
}

export function releaseTextFromThisDevice(roomId: string, itemId: string) {
  return enqueueMutation(() => deletePreservedText(roomId, itemId))
}
