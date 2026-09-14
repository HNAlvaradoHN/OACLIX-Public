import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearDirectFirstState,
  readDirectFirstState,
  writeDirectFirstState,
} from '../src/data/directFirstStateStore.ts'
import type { DirectFirstPersistentState } from '../src/transport/directFirstPersistentState.ts'

const databaseName = 'oaclix-direct-first-prep'
const storeName = 'state'
const local = 'dev_abcdefghijklmnop'
const otherLocal = 'dev_ghijklmnopqrstuv'
const peer = 'dev_qrstuvwxyzabcdef'
const itemId = 'itm_0123456789abcdef0123456789abcdef'
const retentionMs = 21_600_000

function state({
  roomId = 'room_general_1234',
  localDeviceId = local,
  logicalClock = 7,
}: {
  roomId?: string
  localDeviceId?: string
  logicalClock?: number
} = {}): DirectFirstPersistentState {
  const changeId = `chg_${localDeviceId === local ? 'b'.repeat(20) : 'c'.repeat(20)}`
  const now = Date.now()
  const createdAt = now - 1_000
  return {
    version: 1,
    roomId,
    localDeviceId,
    logicalClock,
    ledger: {
      version: 1,
      appliedChangeIds: [],
      lastSequenceByAuthor: [],
    },
    deliveries: [{
      version: 1,
      change: {
        version: 1,
        changeId,
        authorDeviceId: localDeviceId,
        authorSequence: 1,
        itemId,
        operation: 'upsert',
        text: 'hola',
        createdAt,
      },
      pendingDeviceIds: [peer],
      deliveredDeviceIds: [],
    }],
    replayLogs: [{
      version: 1,
      authorDeviceId: localDeviceId,
      maxEntries: 256,
      changes: [{
        version: 1,
        changeId,
        authorDeviceId: localDeviceId,
        authorSequence: 1,
        itemId,
        operation: 'upsert',
        text: 'hola',
        createdAt,
      }],
    }],
    gapBuffer: {
      version: 1,
      maxBufferedPerAuthor: 64,
      changes: [],
    },
    cloudFallbackSeeds: [],
    savedAt: now,
  }
}

type RequestHandlers = {
  onsuccess: null | (() => void)
  onerror: null | (() => void)
}

class FakeRequest<T = unknown> implements RequestHandlers {
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

  complete() {
    queueMicrotask(() => this.oncomplete?.())
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

  get(key: string) {
    const request = new FakeRequest<unknown>()
    queueMicrotask(() => {
      request.result = this.values.has(key) ? structuredClone(this.values.get(key)) : undefined
      request.onsuccess?.()
    })
    return request
  }

  put(value: unknown, key: string) {
    const request = new FakeRequest<void>()
    setTimeout(() => {
      this.values.set(key, structuredClone(value))
      request.onsuccess?.()
      this.transaction.complete()
    }, this.writeDelayMs)
    return request
  }

  delete(key: string) {
    const request = new FakeRequest<void>()
    queueMicrotask(() => {
      this.values.delete(key)
      request.onsuccess?.()
      this.transaction.complete()
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

  database(name = databaseName) {
    return this.databases.get(name)
  }

  setWriteDelay(ms: number) {
    const database = this.databases.get(databaseName)
    if (database) database.writeDelayMs = ms
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

test('IndexedDB preparatorio guarda y restaura un snapshot válido', async () => {
  await withFakeIndexedDb(async () => {
    const expected = state()
    await writeDirectFirstState(expected)
    assert.deepEqual(await readDirectFirstState(expected.roomId, expected.localDeviceId), expected)
  })
})

test('aisla checkpoints por sala/dispositivo y limpia solo la clave pedida', async () => {
  await withFakeIndexedDb(async () => {
    const first = state()
    const second = state({ roomId: 'room_general_5678', localDeviceId: otherLocal, logicalClock: 11 })

    await writeDirectFirstState(first)
    await writeDirectFirstState(second)
    await clearDirectFirstState(first.roomId, first.localDeviceId)

    assert.equal(await readDirectFirstState(first.roomId, first.localDeviceId), null)
    assert.deepEqual(await readDirectFirstState(second.roomId, second.localDeviceId), second)
  })
})

test('descarta y elimina un checkpoint corrupto al leerlo', async () => {
  await withFakeIndexedDb(async (fake) => {
    const key = 'room_general_1234:dev_abcdefghijklmnop'
    fake.seed(key, { version: 99, roomId: 'room_general_1234' })

    assert.equal(await readDirectFirstState('room_general_1234', local), null)
    assert.equal(fake.peek(key), undefined)
  })
})

test('serializa escrituras y conserva el último snapshot solicitado', async () => {
  await withFakeIndexedDb(async (fake) => {
    await writeDirectFirstState(state({ logicalClock: 1 }))
    fake.setWriteDelay(15)

    const first = writeDirectFirstState(state({ logicalClock: 2 }))
    const second = writeDirectFirstState(state({ logicalClock: 3 }))
    await Promise.all([first, second])

    assert.equal((await readDirectFirstState('room_general_1234', local))?.logicalClock, 3)
  })
})

test('una limpieza pedida tras una escritura pendiente gana y no resucita estado', async () => {
  await withFakeIndexedDb(async (fake) => {
    await writeDirectFirstState(state({ logicalClock: 1 }))
    fake.setWriteDelay(20)

    const pendingWrite = writeDirectFirstState(state({ logicalClock: 2 }))
    const pendingClear = clearDirectFirstState('room_general_1234', local)
    await Promise.all([pendingWrite, pendingClear])

    assert.equal(await readDirectFirstState('room_general_1234', local), null)
  })
})

test('rechaza un snapshot inválido antes de tocar IndexedDB', async () => {
  await withFakeIndexedDb(async (fake) => {
    const invalid = { ...state(), version: 2 }
    await assert.rejects(writeDirectFirstState(invalid as never), /Estado direct-first inválido/)
    assert.equal(fake.database(), undefined)
  })
})

test('al leer depura físicamente texto Direct-first vencido y conserva el marcador de secuencia', async () => {
  await withFakeIndexedDb(async (fake) => {
    const key = 'room_general_1234:dev_abcdefghijklmnop'
    const expired = state()
    const createdAt = 1_700_000_000_000
    expired.deliveries[0].change.createdAt = createdAt
    expired.replayLogs[0].changes[0].createdAt = createdAt
    expired.savedAt = createdAt + 500
    fake.seed(key, expired)

    const now = createdAt + retentionMs + 1
    const restored = await readDirectFirstState(expired.roomId, expired.localDeviceId, now)
    assert.equal(restored?.deliveries[0].change.text, '')
    assert.equal(restored?.replayLogs[0].changes[0].text, '')
    assert.equal(restored?.replayLogs[0].changes[0].authorSequence, 1)
    assert.equal(restored?.savedAt, now)

    const persisted = fake.peek(key) as DirectFirstPersistentState
    assert.equal(persisted.deliveries[0].change.text, '')
    assert.equal(persisted.replayLogs[0].changes[0].text, '')
  })
})
