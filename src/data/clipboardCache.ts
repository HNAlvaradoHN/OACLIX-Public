import type { ClipboardTextSnapshot } from './clipboardApi'

const DATABASE_NAME = 'oaclix-cache'
const STORE_NAME = 'general'
const RECORD_KEY = 'current'
const MAX_CACHED_ITEMS = 200
const MAX_TEXT_LENGTH = 8_000

type StoredGeneralCache = {
  version: 1
  roomId: string
  cursor: number
  items: ClipboardTextSnapshot[]
  savedAt: number
}

export type GeneralClipboardCache = {
  cursor: number
  items: ClipboardTextSnapshot[]
}

let cacheWriteQueue: Promise<void> = Promise.resolve()

function openCacheDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la caché local'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function isClipboardItem(value: unknown): value is ClipboardTextSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ClipboardTextSnapshot>
  return typeof item.sequence === 'number'
    && Number.isSafeInteger(item.sequence)
    && typeof item.id === 'string'
    && /^itm_[A-Za-z0-9_-]{16,80}$/.test(item.id)
    && typeof item.authorPersonId === 'string'
    && /^per_[A-Za-z0-9_-]{16,64}$/.test(item.authorPersonId)
    && typeof item.authorDeviceId === 'string'
    && /^dev_[A-Za-z0-9_-]{16,64}$/.test(item.authorDeviceId)
    && typeof item.text === 'string'
    && item.text.length > 0
    && item.text.length <= MAX_TEXT_LENGTH
    && item.text.trim().length > 0
    && typeof item.createdAt === 'number'
    && Number.isSafeInteger(item.createdAt)
    && typeof item.expiresAt === 'number'
    && Number.isSafeInteger(item.expiresAt)
    && item.expiresAt > item.createdAt
}

function normalizeItems(items: ClipboardTextSnapshot[], now = Date.now()) {
  const unique = new Map<string, ClipboardTextSnapshot>()
  for (const item of items) {
    if (!isClipboardItem(item) || item.expiresAt <= now) continue
    unique.set(item.id, item)
  }

  return Array.from(unique.values())
    .sort((a, b) => b.sequence - a.sequence)
    .slice(0, MAX_CACHED_ITEMS)
}

async function deleteStoredCache(database: IDBDatabase) {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo limpiar la caché local'))
    transaction.oncomplete = () => resolve()
    transaction.objectStore(STORE_NAME).delete(RECORD_KEY)
  })
}

async function replaceStoredCache(database: IDBDatabase, snapshot: StoredGeneralCache) {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo depurar la caché local'))
    transaction.oncomplete = () => resolve()
    transaction.objectStore(STORE_NAME).put(snapshot, RECORD_KEY)
  })
}

async function writeSnapshot(snapshot: StoredGeneralCache) {
  const database = await openCacheDatabase()
  try {
    await replaceStoredCache(database, snapshot)
  } finally {
    database.close()
  }
}

export async function readGeneralClipboardCache(roomId: string): Promise<GeneralClipboardCache | null> {
  const database = await openCacheDatabase()
  try {
    const stored = await new Promise<StoredGeneralCache | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY)
      request.onerror = () => reject(request.error ?? new Error('No se pudo leer la caché local'))
      request.onsuccess = () => resolve(request.result as StoredGeneralCache | undefined)
    })

    if (!stored) return null
    if (stored.version !== 1 || stored.roomId !== roomId) {
      await deleteStoredCache(database)
      return null
    }
    if (!Number.isSafeInteger(stored.cursor) || stored.cursor < 0 || !Array.isArray(stored.items)) {
      await deleteStoredCache(database)
      return null
    }

    const items = normalizeItems(stored.items)
    if (items.length !== stored.items.length) {
      await replaceStoredCache(database, {
        ...stored,
        items,
        savedAt: Date.now(),
      })
    }

    return {
      cursor: stored.cursor,
      items,
    }
  } finally {
    database.close()
  }
}

export function writeGeneralClipboardCache(roomId: string, cursor: number, items: ClipboardTextSnapshot[]) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) return Promise.reject(new Error('Cursor local inválido'))

  const snapshot: StoredGeneralCache = {
    version: 1,
    roomId,
    cursor,
    items: normalizeItems(items),
    savedAt: Date.now(),
  }

  const operation = cacheWriteQueue.then(
    () => writeSnapshot(snapshot),
    () => writeSnapshot(snapshot),
  )
  cacheWriteQueue = operation.catch(() => undefined)
  return operation
}
