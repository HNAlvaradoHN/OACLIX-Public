import assert from 'node:assert/strict'
import test from 'node:test'
import {
  preserveTextOnThisDevice,
  readLocalPreservedTexts,
  releaseTextFromThisDevice,
} from '../src/data/preservedClipboard.ts'
import type { ClipboardTextSnapshot } from '../src/data/clipboardApi.ts'

const databaseName = 'oaclix-preserved'
const storeName = 'text-items'
const roomA = 'room_general_1234'
const roomB = 'room_general_5678'

function item(id = 'itm_0123456789abcdef', sequence = 1, text = 'hola'): ClipboardTextSnapshot {
  return {
    sequence,
    id,
    authorPersonId: 'per_abcdefghijklmnop',
    authorDeviceId: 'dev_abcdefghijklmnop',
    text,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_021_600_000,
  }
}

class FakeRequest<T = unknown> {
  result!: T
  error: Error | null = null
  onsuccess: null | (() => void) = null
  onerror: null | (() => void) = null
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: null | (() => void) = null
}

class FakeTransaction {
  error: Error | null = null
  onerror: null | (() => void) = null
  oncomplete: null | (() => void) = null
  private pending = 0
  private completionScheduled = false
  private readonly database: FakeDatabase
  private readonly targetStore: string

  constructor(database: FakeDatabase, targetStore: string) {
    this.database = database
    this.targetStore = targetStore
  }

  objectStore(name: string) {
    if (name !== this.targetStore) throw new Error(`Store inesperado: ${name}`)
    return new FakeObjectStore(this.database.store(name), this, this.database.writeDelayMs)
  }

  begin() {
    this.pending += 1
    this.completionScheduled = false
  }

  finish() {
    this.pending -= 1
    if (this.pending !== 0 || this.completionScheduled) return
    this.completionScheduled = true
    queueMicrotask(() => {
      this.completionScheduled = false
      if (this.pending === 0) this.oncomplete?.()
    })
  }
}

class FakeObjectStore {
  private readonly values: Map<string, unknown>
  private readonly transaction: FakeTransaction
  private readonly writeDelayMs: number

  constructor(values: Map<string, unknown>, transaction: FakeTransaction, writeDelayMs: number) {
    this.values = values
    this.transaction = transaction
    this.writeDelayMs = writeDelayMs
  }

  private sortedEntries() {
    return Array.from(this.values.entries()).sort(([left], [right]) => left.localeCompare(right))
  }

  getAll() {
    const request = new FakeRequest<unknown[]>()
    this.transaction.begin()
    queueMicrotask(() => {
      request.result = this.sortedEntries().map(([, value]) => structuredClone(value))
      request.onsuccess?.()
      this.transaction.finish()
    })
    return request
  }

  getAllKeys() {
    const request = new FakeRequest<string[]>()
    this.transaction.begin()
    queueMicrotask(() => {
      request.result = this.sortedEntries().map(([key]) => key)
      request.onsuccess?.()
      this.transaction.finish()
    })
    return request
  }

  put(value: unknown, key: string) {
    const request = new FakeRequest<void>()
    this.transaction.begin()
    setTimeout(() => {
      this.values.set(key, structuredClone(value))
      request.onsuccess?.()
      this.transaction.finish()
    }, this.writeDelayMs)
    return request
  }

  delete(key: string) {
    const request = new FakeRequest<void>()
    this.transaction.begin()
    queueMicrotask(() => {
      this.values.delete(key)
      request.onsuccess?.()
      this.transaction.finish()
    })
    return request
  }
}

class FakeDatabase {
  readonly stores = new Map<string, Map<string, unknown>>()
  writeDelayMs = 0

  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  }

  createObjectStore(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map())
  }

  store(name: string) {
    const store = this.stores.get(name)
    if (!store) throw new Error(`Store inexistente: ${name}`)
    return store
  }

  transaction(name: string) {
    return new FakeTransaction(this, name)
  }

  close() {}
}

class FakeIndexedDb {
  private readonly databases = new Map<string, FakeDatabase>()

  open(name: string) {
    const request = new FakeOpenRequest()
    queueMicrotask(() => {
      let database = this.databases.get(name)
      const isNew = !database
      if (!database) {
        database = new FakeDatabase()
        this.databases.set(name, database)
      }
      request.result = database
      if (isNew) request.onupgradeneeded?.()
      request.onsuccess?.()
    })
    return request
  }

  database() {
    return this.databases.get(databaseName)
  }

  setWriteDelay(ms: number) {
    const database = this.databases.get(databaseName)
    if (!database) throw new Error('La base todavía no existe')
    database.writeDelayMs = ms
  }

  seed(key: string, value: unknown) {
    let database = this.databases.get(databaseName)
    if (!database) {
      database = new FakeDatabase()
      database.createObjectStore(storeName)
      this.databases.set(databaseName, database)
    }
    database.store(storeName).set(key, structuredClone(value))
  }

  peek(key: string) {
    return this.databases.get(databaseName)?.store(storeName).get(key)
  }
}

function installFakeIndexedDb(fake: FakeIndexedDb) {
  const globalRecord = globalThis as unknown as Record<string, unknown>
  const hadWindow = Object.hasOwn(globalRecord, 'window')
  const hadIndexedDb = Object.hasOwn(globalRecord, 'indexedDB')
  const previousWindow = globalRecord.window
  const previousIndexedDb = globalRecord.indexedDB

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: globalThis,
  })
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    writable: true,
    value: fake,
  })

  return () => {
    if (hadWindow) globalRecord.window = previousWindow
    else delete globalRecord.window
    if (hadIndexedDb) globalRecord.indexedDB = previousIndexedDb
    else delete globalRecord.indexedDB
  }
}

async function withFakeIndexedDb(run: (fake: FakeIndexedDb) => Promise<void>) {
  const fake = new FakeIndexedDb()
  const restore = installFakeIndexedDb(fake)
  try {
    await run(fake)
  } finally {
    restore()
  }
}

test('conservado local persiste entre aperturas y queda aislado por sala', async () => {
  await withFakeIndexedDb(async () => {
    const first = item('itm_0123456789abcdef', 2, 'primero')
    const second = item('itm_fedcba9876543210', 5, 'segundo')

    await preserveTextOnThisDevice(roomA, first)
    await preserveTextOnThisDevice(roomB, second)

    assert.deepEqual(await readLocalPreservedTexts(roomA), [first])
    assert.deepEqual(await readLocalPreservedTexts(roomB), [second])
  })
})

test('quitar pin elimina solo el elemento indicado', async () => {
  await withFakeIndexedDb(async () => {
    const first = item('itm_0123456789abcdef', 2, 'primero')
    const second = item('itm_fedcba9876543210', 5, 'segundo')

    await preserveTextOnThisDevice(roomA, first)
    await preserveTextOnThisDevice(roomA, second)
    await releaseTextFromThisDevice(roomA, second.id)

    assert.deepEqual(await readLocalPreservedTexts(roomA), [first])
  })
})

test('lectura elimina registros corruptos o guardados bajo una clave inconsistente', async () => {
  await withFakeIndexedDb(async (fake) => {
    const validItem = item()
    const validRecord = { version: 1, roomId: roomA, item: validItem, savedAt: 1_700_000_000_500 }
    const wrongKey = `${roomA}:itm_wrongkey12345678`
    const corruptKey = `${roomA}:itm_corrupt12345678`

    fake.seed(wrongKey, validRecord)
    fake.seed(corruptKey, { version: 99, roomId: roomA })

    assert.deepEqual(await readLocalPreservedTexts(roomA), [])
    assert.equal(fake.peek(wrongKey), undefined)
    assert.equal(fake.peek(corruptKey), undefined)
  })
})

test('quitar pin solicitado después de una escritura pendiente gana y no resucita el elemento', async () => {
  await withFakeIndexedDb(async (fake) => {
    const preserved = item()
    await preserveTextOnThisDevice(roomA, preserved)
    fake.setWriteDelay(20)

    const pendingPreserve = preserveTextOnThisDevice(roomA, { ...preserved, text: 'actualizado' })
    const pendingRelease = releaseTextFromThisDevice(roomA, preserved.id)
    await Promise.all([pendingPreserve, pendingRelease])

    assert.deepEqual(await readLocalPreservedTexts(roomA), [])
  })
})

test('rechaza contenido inválido antes de abrir IndexedDB', async () => {
  await withFakeIndexedDb(async (fake) => {
    await assert.rejects(
      preserveTextOnThisDevice(roomA, { ...item(), id: 'itm_corto' }),
      /Contenido inválido para conservar/,
    )
    assert.equal(fake.database(), undefined)
  })
})
