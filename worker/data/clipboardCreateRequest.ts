import { normalizeClipboardItemId, normalizeClipboardText } from './clipboardStore.ts'

export type ClipboardCreateSignedPayload = {
  roomId: string
  itemId: string
  text: string
  expiresAt?: number
}

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{8,96}$/

function normalizeRoomId(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return ROOM_ID_PATTERN.test(normalized) ? normalized : null
}

/**
 * Normaliza exactamente el payload que debe verificarse como acción firmada.
 *
 * Compatibilidad importante:
 * - cloud-first omite `expiresAt`, por lo que la propiedad tampoco se añade al
 *   payload normalizado que se usa para verificar la firma;
 * - direct-first fallback incluye un `expiresAt` entero seguro y positivo, que
 *   queda dentro de la firma y luego debe pasar al store para la validación
 *   contra la retención real de la sala.
 */
export function normalizeClipboardCreateSignedPayload(input: unknown): ClipboardCreateSignedPayload | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Record<string, unknown>

  const roomId = normalizeRoomId(candidate.roomId)
  const itemId = normalizeClipboardItemId(candidate.itemId)
  const text = normalizeClipboardText(candidate.text)
  if (!roomId || !itemId || text == null) return null

  if (!Object.prototype.hasOwnProperty.call(candidate, 'expiresAt')) {
    return { roomId, itemId, text }
  }

  const expiresAt = candidate.expiresAt
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null

  return { roomId, itemId, text, expiresAt }
}
