export const DIRECT_TEXT_RETENTION_MS = 6 * 60 * 60 * 1000

function positiveSafeTimestamp(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

/**
 * Invariante necesaria para que una poda temporal de tombstones sea segura:
 * un upsert direct-only nunca puede declarar una vida mayor que la retención
 * máxima del producto.
 */
export function validDirectOnlyExpiration(createdAt: number, expiresAt: number) {
  return positiveSafeTimestamp(createdAt)
    && positiveSafeTimestamp(expiresAt)
    && expiresAt > createdAt
    && expiresAt - createdAt <= DIRECT_TEXT_RETENTION_MS
}

/**
 * Frontera conservadora para un item borrado. Si el item existía antes del
 * delete y todo upsert direct-only respeta la retención máxima, ningún replay
 * legítimo de ese item puede seguir visible después de esta marca.
 */
export function directTombstoneRetainUntil(deleteCreatedAt: number) {
  if (!positiveSafeTimestamp(deleteCreatedAt)) throw new Error('createdAt de delete inválido')
  const retainUntil = deleteCreatedAt + DIRECT_TEXT_RETENTION_MS
  if (!Number.isSafeInteger(retainUntil)) throw new Error('Frontera de tombstone fuera de rango')
  return retainUntil
}

export function canCompactDirectTombstone(retainUntil: number, now: number) {
  if (!positiveSafeTimestamp(retainUntil) || !positiveSafeTimestamp(now)) {
    throw new Error('Timestamp de compactación inválido')
  }
  return now >= retainUntil
}

/**
 * Prueba la condición que justifica la poda: un upsert anterior al delete,
 * limitado por la retención máxima, ya no puede sobrevivir a retainUntil.
 */
export function replayCannotOutliveTombstone(
  upsertCreatedAt: number,
  upsertExpiresAt: number,
  deleteCreatedAt: number,
) {
  if (!validDirectOnlyExpiration(upsertCreatedAt, upsertExpiresAt)) return false
  if (!positiveSafeTimestamp(deleteCreatedAt) || upsertCreatedAt > deleteCreatedAt) return false
  return upsertExpiresAt <= directTombstoneRetainUntil(deleteCreatedAt)
}
