import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ClipboardExpiryError,
  ClipboardItemConflictError,
  createClipboardTextItem,
} from '../worker/data/clipboardStore.ts'
import type { D1DatabaseLike, D1PreparedStatementLike, DevicePrincipal } from '../worker/data/coreStore.ts'

const principal: DevicePrincipal = {
  personId: 'per_testperson1234567890',
  deviceId: 'dev_testdevice1234567890',
  label: 'Test',
  revokedAt: null,
}

function createDatabase(options: { retentionSeconds?: number; existingExpiresAt?: number } = {}) {
  const retentionSeconds = options.retentionSeconds ?? 6 * 60 * 60
  let insertedValues: unknown[] | null = null

  const database: D1DatabaseLike = {
    prepare(query: string) {
      let values: unknown[] = []
      const statement: D1PreparedStatementLike = {
        bind(...nextValues: unknown[]) {
          values = nextValues
          return statement
        },
        async first<T>() {
          if (query.includes('SELECT r.retention_seconds')) {
            return { retention_seconds: retentionSeconds } as T
          }
          if (query.includes('FROM clipboard_items') && query.includes('WHERE item_id = ?1') && query.includes('text_content')) {
            if (options.existingExpiresAt !== undefined) {
              return {
                sequence: 1,
                item_id: String(values[0]),
                room_id: 'gen_testroom',
                author_person_id: principal.personId,
                author_device_id: principal.deviceId,
                text_content: 'hola',
                created_at: 1_700_000_000_000,
                expires_at: options.existingExpiresAt,
              } as T
            }
            if (insertedValues) {
              return {
                sequence: 1,
                item_id: String(insertedValues[0]),
                room_id: String(insertedValues[1]),
                author_person_id: String(insertedValues[2]),
                author_device_id: String(insertedValues[3]),
                text_content: String(insertedValues[4]),
                created_at: Number(insertedValues[5]),
                expires_at: Number(insertedValues[6]),
              } as T
            }
            return null
          }
          if (query.includes('FROM clipboard_changes') && query.includes('change_kind = ?3')) {
            return { sequence: 1 } as T
          }
          if (query.includes('FROM clipboard_changes') && query.includes('WHERE item_id = ?1')) return null
          if (query.includes('SELECT created_at') && query.includes('author_device_id')) return null
          if (query.includes('COUNT(*) AS count')) return { count: 0 } as T
          return null
        },
        async all<T>() {
          return { results: [] as T[] }
        },
        async run() {
          if (query.includes('INSERT INTO clipboard_items')) insertedValues = values
          return {}
        },
      }
      return statement
    },
    async batch() {
      return []
    },
  }

  return { database, getInsertedValues: () => insertedValues }
}

const roomId = 'gen_testroom'
const itemId = 'itm_1234567890abcdef'
const now = 1_700_000_000_000

test('store conserva exactamente expiresAt original y mantiene created_at del servidor', async () => {
  const originalExpiresAt = now + 30 * 60 * 1000
  const { database, getInsertedValues } = createDatabase()

  const result = await createClipboardTextItem(database, principal, {
    roomId,
    itemId,
    text: 'hola',
    now,
    expiresAt: originalExpiresAt,
  })

  assert.equal(result.created, true)
  assert.equal(result.item.createdAt, now)
  assert.equal(result.item.expiresAt, originalExpiresAt)
  const inserted = getInsertedValues()
  assert.ok(inserted)
  assert.equal(inserted[5], now)
  assert.equal(inserted[6], originalExpiresAt)
})

test('store cloud-first conserva expiración calculada por servidor', async () => {
  const { database } = createDatabase({ retentionSeconds: 60 * 60 })
  const result = await createClipboardTextItem(database, principal, { roomId, itemId, text: 'hola', now })
  assert.equal(result.item.expiresAt, now + 60 * 60 * 1000)
})

test('store rechaza expiración vencida antes de escribir contenido', async () => {
  const { database, getInsertedValues } = createDatabase()
  await assert.rejects(
    createClipboardTextItem(database, principal, { roomId, itemId, text: 'hola', now, expiresAt: now }),
    ClipboardExpiryError,
  )
  assert.equal(getInsertedValues(), null)
})

test('retry con expiresAt distinto al ya persistido entra en conflicto', async () => {
  const originalExpiresAt = now + 30 * 60 * 1000
  const { database } = createDatabase({ existingExpiresAt: originalExpiresAt })
  await assert.rejects(
    createClipboardTextItem(database, principal, {
      roomId,
      itemId,
      text: 'hola',
      now,
      expiresAt: originalExpiresAt + 1,
    }),
    ClipboardItemConflictError,
  )
})
