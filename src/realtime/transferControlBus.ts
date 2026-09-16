import type { TransferControlMessage } from '../shared/transferControlProtocol'

type TransferControlListener = (message: TransferControlMessage, remoteDeviceId: string) => void
type TransferControlSender = (targetDeviceId: string, message: TransferControlMessage) => boolean

const listenersByRoom = new Map<string, Set<TransferControlListener>>()
const sendersByRoom = new Map<string, TransferControlSender>()

export function registerTransferControlSender(roomId: string, sender: TransferControlSender) {
  sendersByRoom.set(roomId, sender)
}

export function sendTransferControl(
  roomId: string,
  targetDeviceId: string,
  message: TransferControlMessage,
) {
  return sendersByRoom.get(roomId)?.(targetDeviceId, message) ?? false
}

export function subscribeTransferControl(
  roomId: string,
  listener: TransferControlListener,
) {
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

export function publishTransferControl(
  roomId: string,
  message: TransferControlMessage,
  remoteDeviceId: string,
) {
  for (const listener of listenersByRoom.get(roomId) ?? []) {
    listener(message, remoteDeviceId)
  }
}
