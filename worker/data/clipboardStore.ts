import type { D1DatabaseLike, DevicePrincipal } from './coreStore'
import { resolveClipboardCreateExpiry } from './clipboardCreateExpiry.ts'

const MAX_TEXT_LENGTH = 8_000
const MAX_ACTIVE_ITEMS_PER_ROOM = 200
const MIN_DEVICE_WRITE_INTERVAL_MS = 1_000
const PAGE_SIZE = 100

type RoomAccessRow = {
  retention_seconds: number
}

type ClipboardRow = {
  sequence: number
  item_id: string
  room_id: string
  author_person_id: string
  author_device_id: string
  text_content: string
  created_at: number
  expires_at: number
  deleted_at?: number | null
}

type ClipboardDeleteRow = {
  item_id: string
  room_id: string
  author_person_id: string
}

type ClipboardChangeRow = {
  change_sequence: number
  change_kind: 'upsert' | 'delete'
  item_id: string
  item_sequence: number | null
  author_person_id: string | null
  author_device_id: string | null
  text_content: string | null
  created_at: number | null
  expires_at: number | null
  deleted_at: number | null
}

export type ClipboardTextItem = {
  sequence: number
  id: string
  authorPersonId: string
  authorDeviceId: string
  text: string
  createdAt: number
  expiresAt: number
}

export type ClipboardChange =
  | { sequence: number; type: 'upsert'; item: ClipboardTextItem }
  | { sequence: number; type: 'delete'; itemId: string }

export class ClipboardAccessError extends Error {
  constructor() {
    super('Sala o elemento no disponible para este dispositivo')
    this.name = 'ClipboardAccessError'
  }
}

export class ClipboardLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClipboardLimitError'
  }
}

export class ClipboardItemConflictError extends Error {
  constructor() {
    super('El identificador del elemento ya está en uso')
    this.name = 'ClipboardItemConflictError'
  }
}

export class ClipboardExpiryError extends Error {
  constructor() {
    super('La expiración original del elemento no es válida')
    this.name = 'ClipboardExpiryError'
  }
}

export function normalizeClipboardItemId(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^itm_[A-Za-z0-9_-]{16,80}$/.test(normalized)) return null
  return normalized
}

export function normalizeClipboardText(value: unknown) {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > MAX_TEXT_LENGTH || value.trim().length === 0) return null
  return value
}

export function normalizeClipboardCursor(value: unknown) {
  if (value == null) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  return value
}

async function getGeneralRoomAccess(database: D1DatabaseLike, principal: DevicePrincipal, roomId: string) {
  const room = await database
    .prepare(`SELECT r.retention_seconds
      FROM rooms r
      INNER JOIN room_memberships m ON m.room_id = r.id
      WHERE r.id = ?1
        AND r.kind = 'general'
        AND r.closed_at IS NULL
        AND m.person_id = ?2
      LIMIT 1`)
    .bind(roomId, principal.personId)
    .first<RoomAccessRow>()

  if (!room) throw new ClipboardAccessError()
  return room
}

async function getClipboardChangeSequence(
  database: D1DatabaseLike,
  input: { roomId: string; itemId: string; kind: 'upsert' | 'delete' },
) {
  const row = await database
    .prepare(`SELECT sequence
      FROM clipboard_changes
      WHERE room_id = ?1
        AND item_id = ?2
        AND change_kind = ?3
      ORDER BY sequence DESC
      LIMIT 1`)
    .bind(input.roomId, input.itemId, input.kind)
    .first<{ sequence: number }>()

  if (!row || !Number.isSafeInteger(row.sequence) || row.sequence <= 0) {
    throw new Error('clipboard-change-sequence')
  }

  return row.sequence
}

function mapRow(row: ClipboardRow) {
  return {
    sequence: row.sequence,
    id: row.item_id,
    authorPersonId: row.author_person_id,
    authorDeviceId: row.author_device_id,
    text: row.text_content,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  } satisfies ClipboardTextItem
}

export async function createClipboardTextItem(
  database: D1DatabaseLike,
  principal: DevicePrincipal,
  input: { roomId: string; itemId: string; text: string; now: number; expiresAt?: number },
) {
  const room = await getGeneralRoomAccess(database, principal, input.roomId)
  const expiryDecision = resolveClipboardCreateExpiry(input.expiresAt, input.now, room.retention_seconds)
  if (expiryDecision.status !== 'accepted') throw new ClipboardExpiryError()

  const existing = await database
    .prepare(`SELECT sequence, item_id, room_id, author_person_id, author_device_id, text_content, created_at, expires_at
      FROM clipboard_items
      WHERE item_id = ?1
      LIMIT 1`)
    .bind(input.itemId)
    .first<ClipboardRow>()

  if (existing) {
    if (
      existing.room_id !== input.roomId
      || existing.author_person_id !== principal.personId
      || existing.author_device_id !== principal.deviceId
      || existing.text_content !== input.text
      || (input.expiresAt !== undefined && existing.expires_at !== expiryDecision.expiresAt)
    ) throw new ClipboardItemConflictError()

    const changeSequence = await getClipboardChangeSequence(database, {
      roomId: input.roomId,
      itemId: input.itemId,
      kind: 'upsert',
    })
    return { item: mapRow(existing), created: false, changeSequence }
  }

  const usedItemId = await database
    .prepare(`SELECT sequence
      FROM clipboard_changes
      WHERE item_id = ?1
      LIMIT 1`)
    .bind(input.itemId)
    .first<{ sequence: number }>()

  if (usedItemId) throw new ClipboardItemConflictError()

  const latest = await database
    .prepare(`SELECT created_at
      FROM clipboard_items
      WHERE author_device_id = ?1
      ORDER BY created_at DESC
      LIMIT 1`)
    .bind(principal.deviceId)
    .first<{ created_at: number }>()

  if (latest && input.now - latest.created_at < MIN_DEVICE_WRITE_INTERVAL_MS) {
    throw new ClipboardLimitError('Espere un momento antes de enviar otro texto')
  }

  const activeCount = await database
    .prepare(`SELECT COUNT(*) AS count
      FROM clipboard_items
      WHERE room_id = ?1
        AND deleted_at IS NULL
        AND expires_at > ?2`)
    .bind(input.roomId, input.now)
    .first<{ count: number }>()

  if ((activeCount?.count ?? 0) >= MAX_ACTIVE_ITEMS_PER_ROOM) {
    throw new ClipboardLimitError('General alcanzó temporalmente su límite de elementos activos')
  }

  await database
    .prepare(`INSERT INTO clipboard_items (
        item_id, room_id, author_person_id, author_device_id, kind,
        text_content, created_at, expires_at, deleted_at
      ) VALUES (?1, ?2, ?3, ?4, 'text', ?5, ?6, ?7, NULL)`)
    .bind(
      input.itemId,
      input.roomId,
      principal.personId,
      principal.deviceId,
      input.text,
      input.now,
      expiryDecision.expiresAt,
    )
    .run()

  const created = await database
    .prepare(`SELECT sequence, item_id, room_id, author_person_id, author_device_id, text_content, created_at, expires_at
      FROM clipboard_items
      WHERE item_id = ?1
      LIMIT 1`)
    .bind(input.itemId)
    .first<ClipboardRow>()

  if (!created) throw new Error('clipboard-insert')
  const changeSequence = await getClipboardChangeSequence(database, {
    roomId: input.roomId,
    itemId: input.itemId,
    kind: 'upsert',
  })
  return { item: mapRow(created), created: true, changeSequence }
}

export async function deleteClipboardTextItem(
  database: D1DatabaseLike,
  principal: DevicePrincipal,
  input: { roomId: string; itemId: string; now: number },
) {
  await getGeneralRoomAccess(database, principal, input.roomId)

  const existing = await database
    .prepare(`SELECT item_id, room_id, author_person_id
      FROM clipboard_items
      WHERE item_id = ?1
      LIMIT 1`)
    .bind(input.itemId)
    .first<ClipboardDeleteRow>()

  if (!existing) {
    const priorDelete = await database
      .prepare(`SELECT sequence, changed_at
        FROM clipboard_changes
        WHERE room_id = ?1
          AND item_id = ?2
          AND change_kind = 'delete'
        ORDER BY sequence DESC
        LIMIT 1`)
      .bind(input.roomId, input.itemId)
      .first<{ sequence: number; changed_at: number }>()

    if (priorDelete) {
      return {
        itemId: input.itemId,
        deleted: false,
        deletedAt: priorDelete.changed_at,
        changeSequence: priorDelete.sequence,
      }
    }
    throw new ClipboardAccessError()
  }

  if (existing.room_id !== input.roomId || existing.author_person_id !== principal.personId) {
    throw new ClipboardAccessError()
  }

  await database.batch([
    database
      .prepare(`INSERT INTO clipboard_changes (room_id, item_id, change_kind, changed_at)
        SELECT room_id, item_id, 'delete', ?1
        FROM clipboard_items
        WHERE item_id = ?2
          AND room_id = ?3
          AND author_person_id = ?4
          AND NOT EXISTS (
            SELECT 1
            FROM clipboard_changes
            WHERE item_id = ?2
              AND change_kind = 'delete'
          )`)
      .bind(input.now, input.itemId, input.roomId, principal.personId),
    database
      .prepare(`DELETE FROM clipboard_items
        WHERE item_id = ?1
          AND room_id = ?2
          AND author_person_id = ?3`)
      .bind(input.itemId, input.roomId, principal.personId),
  ])

  const changeSequence = await getClipboardChangeSequence(database, {
    roomId: input.roomId,
    itemId: input.itemId,
    kind: 'delete',
  })
  return { itemId: input.itemId, deleted: true, deletedAt: input.now, changeSequence }
}

export async function listClipboardTextItems(
  database: D1DatabaseLike,
  principal: DevicePrincipal,
  input: { roomId: string; after: number; now: number },
) {
  await getGeneralRoomAccess(database, principal, input.roomId)

  const result = await database
    .prepare(`SELECT sequence, item_id, room_id, author_person_id, author_device_id, text_content, created_at, expires_at, deleted_at
      FROM clipboard_items
      WHERE room_id = ?1
        AND sequence > ?2
      ORDER BY sequence ASC
      LIMIT ?3`)
    .bind(input.roomId, input.after, PAGE_SIZE + 1)
    .all<ClipboardRow>()

  const rows = result.results ?? []
  const hasMore = rows.length > PAGE_SIZE
  const scannedRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const items = scannedRows
    .filter((row) => row.deleted_at == null && row.expires_at > input.now)
    .map(mapRow)
  const nextCursor = scannedRows.length > 0 ? scannedRows[scannedRows.length - 1].sequence : input.after

  return { items, nextCursor, hasMore }
}

export async function listClipboardChanges(
  database: D1DatabaseLike,
  principal: DevicePrincipal,
  input: { roomId: string; after: number; now: number },
) {
  await getGeneralRoomAccess(database, principal, input.roomId)

  const result = await database
    .prepare(`SELECT
        c.sequence AS change_sequence,
        c.change_kind,
        c.item_id,
        i.sequence AS item_sequence,
        i.author_person_id,
        i.author_device_id,
        i.text_content,
        i.created_at,
        i.expires_at,
        i.deleted_at
      FROM clipboard_changes c
      LEFT JOIN clipboard_items i ON i.item_id = c.item_id
      WHERE c.room_id = ?1
        AND c.sequence > ?2
      ORDER BY c.sequence ASC
      LIMIT ?3`)
    .bind(input.roomId, input.after, PAGE_SIZE + 1)
    .all<ClipboardChangeRow>()

  const rows = result.results ?? []
  const hasMore = rows.length > PAGE_SIZE
  const scannedRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const changes: ClipboardChange[] = []

  for (const row of scannedRows) {
    if (row.change_kind === 'delete') {
      changes.push({ sequence: row.change_sequence, type: 'delete', itemId: row.item_id })
      continue
    }

    if (
      row.item_sequence == null
      || row.author_person_id == null
      || row.author_device_id == null
      || row.text_content == null
      || row.created_at == null
      || row.expires_at == null
      || row.deleted_at != null
      || row.expires_at <= input.now
    ) continue

    changes.push({
      sequence: row.change_sequence,
      type: 'upsert',
      item: {
        sequence: row.item_sequence,
        id: row.item_id,
        authorPersonId: row.author_person_id,
        authorDeviceId: row.author_device_id,
        text: row.text_content,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      },
    })
  }

  const nextCursor = scannedRows.length > 0 ? scannedRows[scannedRows.length - 1].change_sequence : input.after
  return { changes, nextCursor, hasMore }
}
