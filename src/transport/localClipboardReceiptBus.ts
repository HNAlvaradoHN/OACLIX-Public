import type { LocalClipboardTextSnapshot } from '../data/localClipboard'

type ReceiptListener = (item: LocalClipboardTextSnapshot) => void

const receiptListenersByRoom = new Map<string, Set<ReceiptListener>>()

export function publishLocalClipboardReceipt(roomId: string, item: LocalClipboardTextSnapshot) {
  for (const listener of receiptListenersByRoom.get(roomId) ?? []) listener(item)
}

export function subscribeLocalClipboardReceipts(roomId: string, listener: ReceiptListener) {
  let listeners = receiptListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    receiptListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) receiptListenersByRoom.delete(roomId)
  }
}
