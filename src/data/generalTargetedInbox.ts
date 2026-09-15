import {
  clipboardTransferSurface,
  validLocalClipboardTransfer,
  type LocalClipboardTransfer,
} from '../realtime/localClipboardTransfer.ts'

const DATABASE_NAME = 'oaclix-general-targeted'
const STORE_NAME = 'text-items'
const MAX_RETENTION_MS = 21_600_000
const CLOCK_SKEW_MS = 300_000
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/

export type GeneralTargetedInboxItem = {
  id: string
  text: string
  createdAt: number
  expiresAt: number
  senderDeviceId: string
}

type StoredGeneralTargetedItem = {
  version: 1
  roomId: string
  item: GeneralTargetedInboxItem
  savedAt: number
}

let mutationQueue: Promise<void> = Promise.resolve()

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('El almacenamiento local no está disponible'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir General local'))
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

function validStoredItem(value: unknown): value is GeneralTargetedInboxItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<GeneralTargetedInboxItem>
  return typeof item.id === 'string'
    && /^itm_[a-f0-9]{32}$/.test(item.id)
    && typeof item.text === 'string'
    && item.text.length > 0
    && item.text.length <= 8_000
    && item.text.trim().length > 0
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) <= MAX_RETENTION_MS
    && typeof item.senderDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(item.senderDeviceId)
}

function validStoredRecord(value: unknown): value is StoredGeneralTargetedItem {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredGeneralTargetedItem>
  return record.version === 1
    && typeof record.roomId === 'string'
    && ROOM_ID_PATTERN.test(record.roomId)
    && Number.isSafeInteger(record.savedAt)
    && validStoredItem(record.item)
}

export function prepareGeneralTargetedInboxItem(
  roomId: string,
  transfer: LocalClipboardTransfer,
  remoteDeviceId: string,
  now = Date.now(),
): GeneralTargetedInboxItem | null {
  if (!ROOM_ID_PATTERN.test(roomId)) throw new Error('Sala de General inválida')
  if (!validLocalClipboardTransfer(transfer) || clipboardTransferSurface(transfer) !== 'general') {
    throw new Error('Transferencia dirigida de General inválida')
  }
  if (!DEVICE_ID_PATTERN.test(remoteDeviceId) || transfer.senderDeviceId !== remoteDeviceId) {
    throw new Error('Dispositivo de origen inválido')
  }
  if (transfer.item.expiresAt <= now) return null
  if (transfer.item.createdAt > now + CLOCK_SKEW_MS) throw new Error('El reloj del dispositivo de origen no es válido')
  if (transfer.item.expiresAt > now + MAX_RETENTION_MS + CLOCK_SKEW_MS) {
    throw new Error('La expiración supera el límite de General')
  }

  return {
    id: transfer.item.id,
    text: transfer.item.text,
    createdAt: transfer.item.createdAt,
    expiresAt: transfer.item.expiresAt,
    senderDeviceId: remoteDeviceId,
  }
}

function enqueueMutation(operation: () => Promise<void>) {
  const queued = mutationQueue.then(operation, operation)
  mutationQueue = queued.catch(() => undefined)
  return queued
}

async function writeItem(roomId: string, item: GeneralTargetedInboxItem) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el texto de General'))
      transaction.oncomplete = () => resolve()
      transaction.objectStore(STORE_NAME).put({
        version: 1,
        roomId,
        item,
        savedAt: Date.now(),
      } satisfies StoredGeneralTargetedItem, recordKey(roomId, item.id))
    })
  } finally {
    database.close()
  }
}

export async function storeReceivedGeneralTargetedText(
  roomId: string,
  transfer: LocalClipboardTransfer,
  remoteDeviceId: string,
) {
  const item = prepareGeneralTargetedInboxItem(roomId, transfer, remoteDeviceId)
  if (!item) return null
  await enqueueMutation(() => writeItem(roomId, item))
  return item
}

export async function readGeneralTargetedInbox(roomId: string, now = Date.now()) {
  if (!ROOM_ID_PATTERN.test(roomId)) return []
  const database = await openDatabase()
  try {
    const result = await new Promise<{ records: unknown[]; keys: IDBValidKey[] }>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const recordsRequest = store.getAll()
      const keysRequest = store.getAllKeys()
      let records: unknown[] = []
      let keys: IDBValidKey[] = []
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo leer General local'))
      transaction.oncomplete = () => resolve({ records, keys })
      recordsRequest.onsuccess = () => { records = recordsRequest.result as unknown[] }
      keysRequest.onsuccess = () => { keys = keysRequest.result }
    })

    const items: GeneralTargetedInboxItem[] = []
    const staleKeys: IDBValidKey[] = []
    for (let index = 0; index < result.records.length; index += 1) {
      const record = result.records[index]
      const key = result.keys[index]
      if (!validStoredRecord(record) || key !== recordKey(record.roomId, record.item.id) || record.item.expiresAt <= now) {
        if (key !== undefined) staleKeys.push(key)
        continue
      }
      if (record.roomId === roomId) items.push(record.item)
    }

    if (staleKeys.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        const store = transaction.objectStore(STORE_NAME)
        transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo depurar General local'))
        transaction.oncomplete = () => resolve()
        for (const key of staleKeys) store.delete(key)
      })
    }

    return items.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, 200)
  } finally {
    database.close()
  }
}

export function deleteGeneralTargetedInboxItem(roomId: string, itemId: string) {
  if (!ROOM_ID_PATTERN.test(roomId) || !/^itm_[a-f0-9]{32}$/.test(itemId)) {
    return Promise.reject(new Error('Texto de General inválido'))
  }
  return enqueueMutation(async () => {
    const database = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite')
        transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo eliminar de General local'))
        transaction.oncomplete = () => resolve()
        transaction.objectStore(STORE_NAME).delete(recordKey(roomId, itemId))
      })
    } finally {
      database.close()
    }
  })
}
