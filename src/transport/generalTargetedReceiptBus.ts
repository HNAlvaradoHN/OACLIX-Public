import type { GeneralTargetedInboxItem } from '../data/generalTargetedInbox'

export type GeneralTargetedReceipt = {
  item: GeneralTargetedInboxItem
  delivery: 'direct' | 'cloud'
}

type Listener = (receipt: GeneralTargetedReceipt) => void
const listenersByRoom = new Map<string, Set<Listener>>()

export function publishGeneralTargetedReceipt(
  roomId: string,
  item: GeneralTargetedInboxItem,
  delivery: GeneralTargetedReceipt['delivery'],
) {
  for (const listener of listenersByRoom.get(roomId) ?? []) listener({ item, delivery })
}

export function subscribeGeneralTargetedReceipts(roomId: string, listener: Listener) {
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
