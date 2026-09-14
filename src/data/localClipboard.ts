const DATABASE_NAME = 'oaclix-local-clipboard'
const STORE_NAME = 'text-items'
const LOCAL_TEXT_RETENTION_MS = 21_600_000
const LOCAL_CLOCK_SKEW_MS = 300_000
const MAX_TEXT_LENGTH = 8_000
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/

export type LocalClipboardTextSnapshot = {
  id: string
  text: string
  createdAt: number
  expiresAt: number
  receivedFromDeviceId?: string
}

export type TransferableLocalClipboardText = Pick<
  LocalClipboardTextSnapshot,
  'id' | 'text' | 'createdAt' | 'expiresAt'
>

let mutationQueue: Promise<void> = Promise.resolve()

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('El almacenamiento local no está disponible'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir Mi portapapeles'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function createLocalItemId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `itm_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function validTransferableFields(item: Partial<TransferableLocalClipboardText>) {
  return typeof item.id === 'string'
    && ITEM_ID_PATTERN.test(item.id)
    && typeof item.text === 'string'
    && item.text.length > 0
    && item.text.length <= MAX_TEXT_LENGTH
    && item.text.trim().length > 0
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) <= LOCAL_TEXT_RETENTION_MS
}

function sameTransferableText(
  left: LocalClipboardTextSnapshot,
  right: TransferableLocalClipboardText,
) {
  return left.id === right.id
    && left.text === right.text
    && left.createdAt === right.createdAt
    && left.expiresAt === right.expiresAt
}

export function isLocalClipboardText(value: unknown): value is LocalClipboardTextSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LocalClipboardTextSnapshot>
  return validTransferableFields(item)
    && (item.receivedFromDeviceId === undefined
      || (typeof item.receivedFromDeviceId === 'string' && DEVICE_ID_PATTERN.test(item.receivedFromDeviceId)))
}

export function createLocalClipboardTextDraft(
  text: string,
  now = Date.now(),
  itemId = createLocalItemId(),
): LocalClipboardTextSnapshot {
  if (text.trim().length === 0) throw new Error('Escribe o pega un texto primero')
  if (text.length > MAX_TEXT_LENGTH) throw new Error('El texto supera el límite de 8.000 caracteres')
  if (!ITEM_ID_PATTERN.test(itemId)) throw new Error('Identificador local inválido')

  return {
    id: itemId,
    text,
    createdAt: now,
    expiresAt: now + LOCAL_TEXT_RETENTION_MS,
  }
}

export function prepareReceivedLocalClipboardText(
  item: TransferableLocalClipboardText,
  receivedFromDeviceId: string,
  now = Date.now(),
): LocalClipboardTextSnapshot | null {
  if (!validTransferableFields(item)) throw new Error('Texto directo inválido')
  if (!DEVICE_ID_PATTERN.test(receivedFromDeviceId)) throw new Error('Dispositivo de origen inválido')
  if (item.expiresAt <= now) return null
  if (item.createdAt > now + LOCAL_CLOCK_SKEW_MS) throw new Error('El reloj del dispositivo de origen no es válido')
  if (item.expiresAt > now + LOCAL_TEXT_RETENTION_MS + LOCAL_CLOCK_SKEW_MS) {
    throw new Error('La expiración directa supera el límite local')
  }

  return {
    id: item.id,
    text: item.text,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    receivedFromDeviceId,
  }
}

export function normalizeLocalClipboardTexts(items: unknown[], now = Date.now()) {
  const unique = new Map<string, LocalClipboardTextSnapshot>()
  for (const value of items) {
    if (!isLocalClipboardText(value) || value.expiresAt <= now) continue
    unique.set(value.id, value)
  }
  return Array.from(unique.values()).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
}

function enqueueMutation<T>(operation: () => Promise<T>) {
  const queued = mutationQueue.then(operation, operation)
  mutationQueue = queued.then(() => undefined, () => undefined)
  return queued
}

async function writeItem(item: LocalClipboardTextSnapshot) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el texto local'))
      transaction.oncomplete = () => resolve()
      transaction.objectStore(STORE_NAME).put(item, item.id)
    })
  } finally {
    database.close()
  }
}

async function writeReceivedItem(item: LocalClipboardTextSnapshot) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const existingRequest = store.get(item.id)
      let conflict: Error | null = null

      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el texto directo'))
      transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error('No se pudo guardar el texto directo'))
      transaction.oncomplete = () => resolve()
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result as unknown
        if (existing === undefined) {
          store.put(item, item.id)
          return
        }
        if (!isLocalClipboardText(existing) || !sameTransferableText(existing, item)) {
          conflict = new Error('Conflicto de identificador local')
          transaction.abort()
        }
      }
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
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo limpiar Mi portapapeles'))
      transaction.oncomplete = () => resolve()
      for (const key of keys) store.delete(key)
    })
  } finally {
    database.close()
  }
}

export async function readLocalClipboardTexts(now = Date.now()) {
  const database = await openDatabase()
  try {
    const { values, keys } = await new Promise<{ values: unknown[]; keys: IDBValidKey[] }>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const valuesRequest = store.getAll()
      const keysRequest = store.getAllKeys()
      let values: unknown[] = []
      let keys: IDBValidKey[] = []

      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo leer Mi portapapeles'))
      transaction.oncomplete = () => resolve({ values, keys })
      valuesRequest.onsuccess = () => { values = valuesRequest.result as unknown[] }
      keysRequest.onsuccess = () => { keys = keysRequest.result }
    })

    const valid = normalizeLocalClipboardTexts(values, now)
    const validIds = new Set(valid.map((item) => item.id))
    const staleKeys = keys.filter((key) => typeof key !== 'string' || !validIds.has(key))
    if (staleKeys.length > 0) void enqueueMutation(() => deleteKeys(staleKeys)).catch(() => undefined)
    return valid
  } finally {
    database.close()
  }
}

export function createLocalClipboardText(text: string) {
  const item = createLocalClipboardTextDraft(text)
  return enqueueMutation(async () => {
    await writeItem(item)
    return item
  })
}

export function storeReceivedLocalClipboardText(
  item: TransferableLocalClipboardText,
  receivedFromDeviceId: string,
  now = Date.now(),
) {
  const received = prepareReceivedLocalClipboardText(item, receivedFromDeviceId, now)
  if (!received) return Promise.resolve(null)
  return enqueueMutation(async () => {
    await writeReceivedItem(received)
    return received
  })
}

export function deleteLocalClipboardText(itemId: string) {
  if (!ITEM_ID_PATTERN.test(itemId)) return Promise.reject(new Error('Identificador local inválido'))
  return enqueueMutation(() => deleteKeys([itemId]))
}
