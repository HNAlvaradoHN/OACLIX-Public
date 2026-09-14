import type { D1DatabaseLike } from './coreStore'

const MAX_CONTENT_RETENTION_MS = 6 * 60 * 60 * 1000
const CHANGE_LOG_SAFETY_MS = 60 * 60 * 1000
const ITEM_BATCH_SIZE = 128
const CHANGE_BATCH_SIZE = 256
const CLEANUP_PASSES = 2

export async function cleanupExpiredClipboardData(database: D1DatabaseLike, now: number) {
  const changeCutoff = now - MAX_CONTENT_RETENTION_MS - CHANGE_LOG_SAFETY_MS
  const statements = []

  for (let pass = 0; pass < CLEANUP_PASSES; pass += 1) {
    statements.push(
      database
        .prepare(`DELETE FROM clipboard_items
          WHERE sequence IN (
            SELECT sequence
            FROM clipboard_items
            WHERE expires_at <= ?1
            ORDER BY expires_at ASC
            LIMIT ?2
          )`)
        .bind(now, ITEM_BATCH_SIZE),
      database
        .prepare(`DELETE FROM clipboard_changes
          WHERE sequence IN (
            SELECT sequence
            FROM clipboard_changes
            WHERE changed_at <= ?1
            ORDER BY changed_at ASC
            LIMIT ?2
          )`)
        .bind(changeCutoff, CHANGE_BATCH_SIZE),
    )
  }

  await database.batch(statements)
}
