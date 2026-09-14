import {
  redactExpiredDirectFirstContent,
  validDirectFirstPersistentState,
  type DirectFirstPersistentState,
} from '../transport/directFirstPersistentState.ts'

const DATABASE_NAME = 'oaclix-direct-first-prep'
const STORE_NAME = 'state'

let mutationQueue: Promise<void> = Promise.resolve()

function stateKey(roomId: string, localDeviceId: string) {
  return `${roomId}:${localDeviceId}`
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el estado direct-first'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function deleteStoredState(database: IDBDatabase, key: string) {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo limpiar el estado direct-first'))
    transaction.oncomplete = () => resolve()
    transaction.objectStore(STORE_NAME).delete(key)
  })
}

async function putStoredState(database: IDBDatabase, snapshot: DirectFirstPersistentState) {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el estado direct-first'))
    transaction.oncomplete = () => resolve()
    transaction.objectStore(STORE_NAME).put(snapshot, stateKey(snapshot.roomId, snapshot.localDeviceId))
  })
}

async function writeSnapshot(snapshot: DirectFirstPersistentState) {
  const database = await openDatabase()
  try {
    await putStoredState(database, snapshot)
  } finally {
    database.close()
  }
}

async function clearSnapshot(roomId: string, localDeviceId: string) {
  const database = await openDatabase()
  try {
    await deleteStoredState(database, stateKey(roomId, localDeviceId))
  } finally {
    database.close()
  }
}

function enqueueMutation(operation: () => Promise<void>) {
  const queued = mutationQueue.then(operation, operation)
  mutationQueue = queued.catch(() => undefined)
  return queued
}

export async function readDirectFirstState(roomId: string, localDeviceId: string, now = Date.now()) {
  const key = stateKey(roomId, localDeviceId)
  const database = await openDatabase()
  try {
    const stored = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onerror = () => reject(request.error ?? new Error('No se pudo leer el estado direct-first'))
      request.onsuccess = () => resolve(request.result)
    })

    if (stored === undefined) return null
    if (!validDirectFirstPersistentState(stored)
      || stored.roomId !== roomId
      || stored.localDeviceId !== localDeviceId) {
      await deleteStoredState(database, key)
      return null
    }

    const redacted = redactExpiredDirectFirstContent(stored, now)
    if (!validDirectFirstPersistentState(redacted.state)) {
      await deleteStoredState(database, key)
      return null
    }
    if (redacted.changed) await putStoredState(database, redacted.state)
    return redacted.state
  } finally {
    database.close()
  }
}

export function writeDirectFirstState(snapshot: DirectFirstPersistentState) {
  if (!validDirectFirstPersistentState(snapshot)) {
    return Promise.reject(new Error('Estado direct-first inválido'))
  }

  const redacted = redactExpiredDirectFirstContent(snapshot, snapshot.savedAt)
  if (!validDirectFirstPersistentState(redacted.state)) {
    return Promise.reject(new Error('Estado direct-first inválido tras depuración'))
  }
  return enqueueMutation(() => writeSnapshot(redacted.state))
}

export function clearDirectFirstState(roomId: string, localDeviceId: string) {
  return enqueueMutation(() => clearSnapshot(roomId, localDeviceId))
}
