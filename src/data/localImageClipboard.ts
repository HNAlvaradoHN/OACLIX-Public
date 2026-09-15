import {
  LOCAL_IMAGE_RETENTION_MS,
  type LocalImageTransferItem,
} from '../shared/localImageTransferCore'
import { decodeImageTransferBytes } from '../realtime/localImageTransfer'

const DATABASE_NAME = 'oaclix-local-images'
const STORE_NAME = 'image-items'
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const NATIVE_IMAGE_ID_PATTERN = /^[0-9a-fA-F-]{36}$/
const CLOCK_SKEW_MS = 300_000
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const encoder = new TextEncoder()

export type LocalImageClipboardSnapshot = {
  id: string
  mimeType: string
  byteSize: number
  blob: Blob
  createdAt: number
  expiresAt: number
  receivedFromDeviceId?: string
  receivedVia?: 'direct' | 'cloud'
}

export type ReceivedLocalImageMetadata = Pick<
  LocalImageClipboardSnapshot,
  'id' | 'mimeType' | 'byteSize' | 'createdAt' | 'expiresAt'
>

type NativeLocalImageSnapshot = {
  id: string
  mimeType: string
  byteSize: number
  createdAt: number
  expiresAt: number
}

let mutationQueue: Promise<void> = Promise.resolve()
let nativeImportPromise: Promise<void> | null = null

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('El almacenamiento local de imágenes no está disponible'))
      return
    }
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir Mi portapapeles de imágenes'))
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

function createLocalImageId() {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return `itm_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

async function nativeLocalImageId(nativeId: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`oaclix-android-image|${nativeId}`))
  return `itm_${Array.from(new Uint8Array(digest).slice(0, 16), (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function validNativeImage(value: unknown): value is NativeLocalImageSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<NativeLocalImageSnapshot>
  return typeof item.id === 'string'
    && NATIVE_IMAGE_ID_PATTERN.test(item.id)
    && typeof item.mimeType === 'string'
    && SUPPORTED_MIME_TYPES.has(item.mimeType)
    && Number.isSafeInteger(item.byteSize)
    && Number(item.byteSize) > 0
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) === LOCAL_IMAGE_RETENTION_MS
}

function parseNativeImages(raw: string) {
  const value = JSON.parse(raw) as unknown
  if (!Array.isArray(value)) throw new Error('Android devolvió una lista de imágenes inválida')
  if (!value.every(validNativeImage)) throw new Error('Android devolvió metadatos de imagen inválidos')
  return value
}

export function isLocalImageClipboardSnapshot(value: unknown): value is LocalImageClipboardSnapshot {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LocalImageClipboardSnapshot>
  return typeof item.id === 'string'
    && ITEM_ID_PATTERN.test(item.id)
    && typeof item.mimeType === 'string'
    && SUPPORTED_MIME_TYPES.has(item.mimeType)
    && Number.isSafeInteger(item.byteSize)
    && Number(item.byteSize) > 0
    && item.blob instanceof Blob
    && item.blob.size === item.byteSize
    && item.blob.type === item.mimeType
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) <= LOCAL_IMAGE_RETENTION_MS
    && (item.receivedFromDeviceId === undefined
      || (typeof item.receivedFromDeviceId === 'string' && DEVICE_ID_PATTERN.test(item.receivedFromDeviceId)))
    && (item.receivedVia === undefined || item.receivedVia === 'direct' || item.receivedVia === 'cloud')
}

function sameImage(left: LocalImageClipboardSnapshot, right: LocalImageClipboardSnapshot) {
  return left.id === right.id
    && left.mimeType === right.mimeType
    && left.byteSize === right.byteSize
    && left.createdAt === right.createdAt
    && left.expiresAt === right.expiresAt
    && left.receivedFromDeviceId === right.receivedFromDeviceId
    && left.receivedVia === right.receivedVia
}

export function prepareLocalImageBlob(
  blob: Blob,
  now = Date.now(),
  itemId = createLocalImageId(),
): LocalImageClipboardSnapshot {
  if (!ITEM_ID_PATTERN.test(itemId)) throw new Error('Identificador de imagen inválido')
  if (!SUPPORTED_MIME_TYPES.has(blob.type)) throw new Error('Formato de imagen no compatible')
  if (blob.size <= 0) throw new Error('La imagen está vacía')
  return {
    id: itemId,
    mimeType: blob.type,
    byteSize: blob.size,
    blob,
    createdAt: now,
    expiresAt: now + LOCAL_IMAGE_RETENTION_MS,
  }
}

export function prepareReceivedLocalImageBlob(
  item: ReceivedLocalImageMetadata,
  blob: Blob,
  receivedFromDeviceId: string,
  receivedVia: 'direct' | 'cloud',
  now = Date.now(),
): LocalImageClipboardSnapshot | null {
  if (!DEVICE_ID_PATTERN.test(receivedFromDeviceId)) throw new Error('Dispositivo de origen inválido')
  if (!ITEM_ID_PATTERN.test(item.id)) throw new Error('Identificador de imagen inválido')
  if (!SUPPORTED_MIME_TYPES.has(item.mimeType)) throw new Error('Formato de imagen no compatible')
  if (!Number.isSafeInteger(item.byteSize) || item.byteSize <= 0) throw new Error('Tamaño de imagen inválido')
  if (blob.size !== item.byteSize || blob.type !== item.mimeType) throw new Error('Los bytes de imagen no coinciden')
  if (!Number.isSafeInteger(item.createdAt) || !Number.isSafeInteger(item.expiresAt)) {
    throw new Error('Fechas de imagen inválidas')
  }
  if (item.expiresAt <= now) return null
  if (item.createdAt > now + CLOCK_SKEW_MS) throw new Error('El reloj del dispositivo de origen no es válido')
  if (item.expiresAt <= item.createdAt || item.expiresAt - item.createdAt > LOCAL_IMAGE_RETENTION_MS) {
    throw new Error('La expiración de imagen supera el límite local')
  }
  if (item.expiresAt > now + LOCAL_IMAGE_RETENTION_MS + CLOCK_SKEW_MS) {
    throw new Error('La expiración de imagen supera el límite local')
  }
  return {
    id: item.id,
    mimeType: item.mimeType,
    byteSize: item.byteSize,
    blob,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    receivedFromDeviceId,
    receivedVia,
  }
}

export function prepareReceivedLocalImage(
  item: LocalImageTransferItem,
  receivedFromDeviceId: string,
  now = Date.now(),
): LocalImageClipboardSnapshot | null {
  const bytes = decodeImageTransferBytes(item)
  const blob = new Blob([bytes], { type: item.mimeType })
  return prepareReceivedLocalImageBlob(item, blob, receivedFromDeviceId, 'cloud', now)
}

async function writeItem(item: LocalImageClipboardSnapshot) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const existingRequest = store.get(item.id)
      let conflict: Error | null = null
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar la imagen'))
      transaction.onabort = () => reject(conflict ?? transaction.error ?? new Error('No se pudo guardar la imagen'))
      transaction.oncomplete = () => resolve()
      existingRequest.onsuccess = () => {
        const existing = existingRequest.result as unknown
        if (existing === undefined) {
          store.put(item, item.id)
          return
        }
        if (!isLocalImageClipboardSnapshot(existing) || !sameImage(existing, item)) {
          conflict = new Error('Conflicto de identificador de imagen')
          transaction.abort()
        }
      }
    })
  } finally {
    database.close()
  }
}

async function importNativeLocalImages(now: number) {
  const bridge = window.OaclixNative
  if (!bridge) return
  if (nativeImportPromise) return nativeImportPromise

  nativeImportPromise = (async () => {
    const nativeItems = parseNativeImages(bridge.listLocalImages())
    for (const item of nativeItems) {
      if (item.expiresAt <= now) {
        bridge.deleteLocalImage(item.id)
        continue
      }
      if (item.createdAt > now + CLOCK_SKEW_MS) continue

      try {
        const response = await fetch(`/app-native/image/${encodeURIComponent(item.id)}`, { cache: 'no-store' })
        if (!response.ok) continue
        const blob = await response.blob()
        if (blob.type !== item.mimeType || blob.size !== item.byteSize) continue

        const webItem = prepareLocalImageBlob(blob, item.createdAt, await nativeLocalImageId(item.id))
        await enqueueMutation(() => writeItem(webItem))
        bridge.deleteLocalImage(item.id)
      } catch {
        // Conservamos el original nativo para reintentar en la siguiente apertura.
      }
    }
  })().finally(() => {
    nativeImportPromise = null
  })

  return nativeImportPromise
}

async function deleteKeys(keys: IDBValidKey[]) {
  if (keys.length === 0) return
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo limpiar imágenes locales'))
      transaction.oncomplete = () => resolve()
      for (const key of keys) store.delete(key)
    })
  } finally {
    database.close()
  }
}

export async function readLocalImages(now = Date.now()) {
  await importNativeLocalImages(now)
  const database = await openDatabase()
  try {
    const { values, keys } = await new Promise<{ values: unknown[]; keys: IDBValidKey[] }>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const valuesRequest = store.getAll()
      const keysRequest = store.getAllKeys()
      let values: unknown[] = []
      let keys: IDBValidKey[] = []
      transaction.onerror = () => reject(transaction.error ?? new Error('No se pudieron leer imágenes locales'))
      transaction.oncomplete = () => resolve({ values, keys })
      valuesRequest.onsuccess = () => { values = valuesRequest.result as unknown[] }
      keysRequest.onsuccess = () => { keys = keysRequest.result }
    })
    const valid = values
      .filter(isLocalImageClipboardSnapshot)
      .filter((item) => item.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    const validIds = new Set(valid.map((item) => item.id))
    const staleKeys = keys.filter((key) => typeof key !== 'string' || !validIds.has(key))
    if (staleKeys.length > 0) void enqueueMutation(() => deleteKeys(staleKeys)).catch(() => undefined)
    return valid
  } finally {
    database.close()
  }
}

export function storeLocalImageBlob(blob: Blob, now = Date.now()) {
  const local = prepareLocalImageBlob(blob, now)
  return enqueueMutation(async () => {
    await writeItem(local)
    return local
  })
}

export function storeReceivedLocalImage(
  item: LocalImageTransferItem,
  receivedFromDeviceId: string,
  now = Date.now(),
) {
  const received = prepareReceivedLocalImage(item, receivedFromDeviceId, now)
  if (!received) return Promise.resolve(null)
  return enqueueMutation(async () => {
    await writeItem(received)
    return received
  })
}

export function storeReceivedLocalImageBlob(
  item: ReceivedLocalImageMetadata,
  blob: Blob,
  receivedFromDeviceId: string,
  receivedVia: 'direct' | 'cloud',
  now = Date.now(),
) {
  const received = prepareReceivedLocalImageBlob(item, blob, receivedFromDeviceId, receivedVia, now)
  if (!received) return Promise.resolve(null)
  return enqueueMutation(async () => {
    await writeItem(received)
    return received
  })
}

export function deleteLocalImage(itemId: string) {
  if (!ITEM_ID_PATTERN.test(itemId)) return Promise.reject(new Error('Identificador de imagen inválido'))
  return enqueueMutation(() => deleteKeys([itemId]))
}
