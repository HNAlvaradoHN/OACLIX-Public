import { clipboardTransport, type ClipboardDeleteOptions } from '../transport/clipboardTransport'
import {
  ensureClipboardRoomConnectivity as ensureRoomContentConnectivity,
  ensureClipboardRoomControlConnectivity as ensureRoomControlConnectivity,
  suspendClipboardRoomConnectivity as suspendRoomConnectivity,
} from '../transport/clipboardTransport'

export type { ClipboardChange, ClipboardTextSnapshot } from './clipboardCloudApi'
export type { DirectClipboardChange } from '../transport/clipboardTransport'

const contentConnectivityRooms = new Set<string>()
const controlConnectivityRooms = new Set<string>()
const foregroundReceiverRooms = new Set<string>()

function reconcileRoomConnectivity(roomId: string) {
  if (contentConnectivityRooms.has(roomId)) {
    ensureRoomContentConnectivity(roomId)
    return
  }
  if (controlConnectivityRooms.has(roomId) || foregroundReceiverRooms.has(roomId)) {
    ensureRoomControlConnectivity(roomId)
    return
  }
  suspendRoomConnectivity(roomId)
}

export function ensureClipboardRoomConnectivity(roomId: string) {
  contentConnectivityRooms.add(roomId)
  controlConnectivityRooms.delete(roomId)
  reconcileRoomConnectivity(roomId)
}

export function ensureClipboardRoomControlConnectivity(roomId: string) {
  controlConnectivityRooms.add(roomId)
  contentConnectivityRooms.delete(roomId)
  reconcileRoomConnectivity(roomId)
}

export function suspendClipboardRoomConnectivity(roomId: string) {
  contentConnectivityRooms.delete(roomId)
  controlConnectivityRooms.delete(roomId)
  reconcileRoomConnectivity(roomId)
}

export function ensureClipboardRoomForegroundReception(roomId: string) {
  foregroundReceiverRooms.add(roomId)
  reconcileRoomConnectivity(roomId)
}

export function suspendClipboardRoomForegroundReception(roomId: string) {
  foregroundReceiverRooms.delete(roomId)
  reconcileRoomConnectivity(roomId)
}

export function createClipboardText(roomId: string, text: string) {
  return clipboardTransport.createText(roomId, text)
}

export function deleteClipboardText(roomId: string, itemId: string, options?: ClipboardDeleteOptions) {
  return clipboardTransport.deleteText(roomId, itemId, options)
}

export function listClipboardChanges(roomId: string, after: number) {
  return clipboardTransport.listChanges(roomId, after)
}

export function subscribeDirectClipboardChanges(
  roomId: string,
  listener: Parameters<typeof clipboardTransport.subscribeDirectChanges>[1],
) {
  return clipboardTransport.subscribeDirectChanges(roomId, listener)
}

export function subscribeCloudClipboardSyncHints(
  roomId: string,
  listener: Parameters<typeof clipboardTransport.subscribeCloudSyncHints>[1],
) {
  return clipboardTransport.subscribeCloudSyncHints(roomId, listener)
}
