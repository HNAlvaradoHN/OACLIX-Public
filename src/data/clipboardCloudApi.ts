import { postSigned } from '../identity/signedRequest'

export type ClipboardTextSnapshot = {
  sequence: number
  id: string
  authorPersonId: string
  authorDeviceId: string
  text: string
  createdAt: number
  expiresAt: number
  /** Marca local: el item todavía no tiene una copia cloud confirmada. */
  directOnly?: true
}

export type ClipboardChange =
  | { sequence: number; type: 'upsert'; item: ClipboardTextSnapshot }
  | { sequence: number; type: 'delete'; itemId: string }

type CreateClipboardTextResponse = {
  version: 1
  item: ClipboardTextSnapshot
  created: boolean
  changeSequence: number
}

type DeleteClipboardTextResponse = {
  version: 1
  itemId: string
  deleted: boolean
  deletedAt: number
  changeSequence: number
}

type ListClipboardChangesResponse = {
  version: 1
  changes: ClipboardChange[]
  nextCursor: number
  hasMore: boolean
}

const CLIPBOARD_REQUEST_TIMEOUT_MS = 8_000

function createItemId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
  return `itm_${suffix}`
}

export async function createCloudClipboardTextWithItemId(roomId: string, itemId: string, text: string) {
  const payload = { roomId, itemId, text }
  return postSigned<typeof payload, CreateClipboardTextResponse>(
    '/api/clipboard/text/create',
    'clipboard.text.create',
    payload,
    { timeoutMs: CLIPBOARD_REQUEST_TIMEOUT_MS },
  )
}

/**
 * Variante reservada para materializar en cloud un item que nació direct-only.
 * Mantiene `expiresAt` dentro de la acción firmada sin cambiar todavía el flujo
 * cloud-first existente. Solo debe conectarse a producción cuando Worker/store
 * validen y persistan la misma expiración de forma atómica.
 */
export async function createCloudClipboardTextWithOriginalExpiry(
  roomId: string,
  itemId: string,
  text: string,
  expiresAt: number,
) {
  const payload = { roomId, itemId, text, expiresAt }
  return postSigned<typeof payload, CreateClipboardTextResponse>(
    '/api/clipboard/text/create',
    'clipboard.text.create',
    payload,
    { timeoutMs: CLIPBOARD_REQUEST_TIMEOUT_MS },
  )
}

export function createCloudClipboardText(roomId: string, text: string) {
  return createCloudClipboardTextWithItemId(roomId, createItemId(), text)
}

export async function deleteCloudClipboardText(roomId: string, itemId: string) {
  const payload = { roomId, itemId }
  return postSigned<typeof payload, DeleteClipboardTextResponse>(
    '/api/clipboard/text/delete',
    'clipboard.text.delete',
    payload,
    { timeoutMs: CLIPBOARD_REQUEST_TIMEOUT_MS },
  )
}

export async function listCloudClipboardChanges(roomId: string, after: number) {
  const payload = { roomId, after }
  return postSigned<typeof payload, ListClipboardChangesResponse>(
    '/api/clipboard/changes/list',
    'clipboard.changes.list',
    payload,
    { timeoutMs: CLIPBOARD_REQUEST_TIMEOUT_MS },
  )
}
