import type { LocalClipboardTransfer, LocalClipboardTransferAck } from './localClipboardTransfer'
import type { LocalImageTransfer, LocalImageTransferAck } from './localImageTransfer'

type TransferListener = (transfer: LocalClipboardTransfer, remoteDeviceId: string) => void
type AckListener = (ack: LocalClipboardTransferAck, remoteDeviceId: string) => void
type TransferSender = (targetDeviceId: string, transfer: LocalClipboardTransfer) => boolean
type AckSender = (targetDeviceId: string, ack: LocalClipboardTransferAck) => boolean
type ImageTransferListener = (transfer: LocalImageTransfer, remoteDeviceId: string) => void
type ImageAckListener = (ack: LocalImageTransferAck, remoteDeviceId: string) => void
type ImageAckSender = (targetDeviceId: string, ack: LocalImageTransferAck) => boolean

const transferListenersByRoom = new Map<string, Set<TransferListener>>()
const ackListenersByRoom = new Map<string, Set<AckListener>>()
const transferSendersByRoom = new Map<string, TransferSender>()
const ackSendersByRoom = new Map<string, AckSender>()
const imageTransferListenersByRoom = new Map<string, Set<ImageTransferListener>>()
const imageAckListenersByRoom = new Map<string, Set<ImageAckListener>>()
const imageAckSendersByRoom = new Map<string, ImageAckSender>()

export function registerDeviceRelaySender(roomId: string, sender: TransferSender) {
  transferSendersByRoom.set(roomId, sender)
}

export function sendDeviceRelayTransfer(roomId: string, targetDeviceId: string, transfer: LocalClipboardTransfer) {
  return transferSendersByRoom.get(roomId)?.(targetDeviceId, transfer) ?? false
}

export function registerDeviceRelayAckSender(roomId: string, sender: AckSender) {
  ackSendersByRoom.set(roomId, sender)
}

export function sendDeviceRelayAck(roomId: string, targetDeviceId: string, ack: LocalClipboardTransferAck) {
  return ackSendersByRoom.get(roomId)?.(targetDeviceId, ack) ?? false
}

export function registerDeviceImageRelayAckSender(roomId: string, sender: ImageAckSender) {
  imageAckSendersByRoom.set(roomId, sender)
}

export function sendDeviceImageRelayAck(roomId: string, targetDeviceId: string, ack: LocalImageTransferAck) {
  return imageAckSendersByRoom.get(roomId)?.(targetDeviceId, ack) ?? false
}

export function subscribeDeviceRelayTransfers(roomId: string, listener: TransferListener) {
  let listeners = transferListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    transferListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) transferListenersByRoom.delete(roomId)
  }
}

export function subscribeDeviceRelayAcks(roomId: string, listener: AckListener) {
  let listeners = ackListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    ackListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) ackListenersByRoom.delete(roomId)
  }
}

export function subscribeDeviceImageRelayTransfers(roomId: string, listener: ImageTransferListener) {
  let listeners = imageTransferListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    imageTransferListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) imageTransferListenersByRoom.delete(roomId)
  }
}

export function subscribeDeviceImageRelayAcks(roomId: string, listener: ImageAckListener) {
  let listeners = imageAckListenersByRoom.get(roomId)
  if (!listeners) {
    listeners = new Set()
    imageAckListenersByRoom.set(roomId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) imageAckListenersByRoom.delete(roomId)
  }
}

export function publishDeviceRelayTransfer(roomId: string, transfer: LocalClipboardTransfer, remoteDeviceId: string) {
  for (const listener of transferListenersByRoom.get(roomId) ?? []) listener(transfer, remoteDeviceId)
}

export function publishDeviceRelayAck(roomId: string, ack: LocalClipboardTransferAck, remoteDeviceId: string) {
  for (const listener of ackListenersByRoom.get(roomId) ?? []) listener(ack, remoteDeviceId)
}

export function publishDeviceImageRelayTransfer(roomId: string, transfer: LocalImageTransfer, remoteDeviceId: string) {
  for (const listener of imageTransferListenersByRoom.get(roomId) ?? []) listener(transfer, remoteDeviceId)
}

export function publishDeviceImageRelayAck(roomId: string, ack: LocalImageTransferAck, remoteDeviceId: string) {
  for (const listener of imageAckListenersByRoom.get(roomId) ?? []) listener(ack, remoteDeviceId)
}
