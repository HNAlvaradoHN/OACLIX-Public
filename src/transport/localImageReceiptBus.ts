import type { LocalImageClipboardSnapshot } from '../data/localImageClipboard'

type Listener = (item: LocalImageClipboardSnapshot) => void
const listenersByRoom = new Map<string, Set<Listener>>()
const allListeners = new Set<Listener>()

export function subscribeLocalImageReceipts(roomId: string, listener: Listener) {
  let listeners = listenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    listenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) listenersByRoom.delete(roomId)
  }
}

/**
 * UI-only subscription for local image history. It carries no network state or
 * room metadata; the image was already stored before this notification is published.
 */
export function subscribeAllLocalImageReceipts(listener: Listener) {
  allListeners.add(listener)
  return () => { allListeners.delete(listener) }
}

export function publishLocalImageMutation(item: LocalImageClipboardSnapshot) {
  for (const listener of allListeners) listener(item)
}

export function publishLocalImageReceipt(roomId: string, item: LocalImageClipboardSnapshot) {
  for (const listener of listenersByRoom.get(roomId) ?? []) listener(item)
  publishLocalImageMutation(item)
}
