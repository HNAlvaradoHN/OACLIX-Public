import { DIRECT_TEXT_RETENTION_MS, validDirectOnlyExpiration } from '../transport/directFirstTombstonePolicy.ts'

export type DirectFirstCloudExpiryDecision =
  | { status: 'materialize'; expiresAt: number }
  | { status: 'expired' }
  | { status: 'invalid' }

/**
 * Regla compartida cliente/Worker para materializar un item direct-only en cloud
 * sin regalarle una nueva ventana de retención.
 */
export function decideDirectFirstCloudExpiry(
  createdAt: number,
  expiresAt: number,
  now: number,
): DirectFirstCloudExpiryDecision {
  if (!validDirectOnlyExpiration(createdAt, expiresAt)) return { status: 'invalid' }
  if (!Number.isSafeInteger(now) || now <= 0) return { status: 'invalid' }
  if (now >= expiresAt) return { status: 'expired' }
  return { status: 'materialize', expiresAt }
}

/**
 * Límite de servidor para una expiración solicitada durante fallback.
 * La fecha debe seguir en el futuro y nunca superar la retención concreta de la sala.
 */
export function serverAllowsRequestedExpiry(
  requestedExpiresAt: number,
  now: number,
  retentionMs = DIRECT_TEXT_RETENTION_MS,
) {
  if (!Number.isSafeInteger(requestedExpiresAt) || requestedExpiresAt <= 0) return false
  if (!Number.isSafeInteger(now) || now <= 0) return false
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) return false
  return requestedExpiresAt > now && requestedExpiresAt <= now + retentionMs
}
