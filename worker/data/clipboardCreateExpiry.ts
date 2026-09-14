import { serverAllowsRequestedExpiry } from './clipboardExpiryPolicy.ts'

export type ClipboardCreateExpiryDecision =
  | { status: 'accepted'; expiresAt: number; source: 'server' | 'original' }
  | { status: 'invalid' }

/**
 * Resuelve la expiración que D1 debe guardar para un create de texto.
 *
 * - Cloud-first no envía expiración: el servidor calcula `now + retención`.
 * - Direct-first fallback envía la expiración original firmada: se conserva
 *   exactamente, pero solo si todavía está vigente y cabe en la retención real
 *   de la sala desde el momento de materialización.
 *
 * `createdAt` deliberadamente no participa: el timestamp operativo sigue siendo
 * autoridad del servidor y no se debilita el rate limit existente.
 */
export function resolveClipboardCreateExpiry(
  requestedExpiresAt: unknown,
  now: number,
  retentionSeconds: number,
): ClipboardCreateExpiryDecision {
  if (!Number.isSafeInteger(now) || now <= 0) return { status: 'invalid' }
  if (!Number.isSafeInteger(retentionSeconds) || retentionSeconds <= 0) return { status: 'invalid' }

  const retentionMs = retentionSeconds * 1000
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) return { status: 'invalid' }

  if (requestedExpiresAt === undefined) {
    const expiresAt = now + retentionMs
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return { status: 'invalid' }
    return { status: 'accepted', expiresAt, source: 'server' }
  }

  if (
    typeof requestedExpiresAt !== 'number'
    || !serverAllowsRequestedExpiry(requestedExpiresAt, now, retentionMs)
  ) {
    return { status: 'invalid' }
  }

  return { status: 'accepted', expiresAt: requestedExpiresAt, source: 'original' }
}
