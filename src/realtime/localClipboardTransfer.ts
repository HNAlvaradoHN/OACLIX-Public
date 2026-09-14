export type LocalClipboardTransferItem = {
  id: string
  text: string
  createdAt: number
  expiresAt: number
}

export type LocalClipboardTransfer = {
  version: 1
  type: 'local-clipboard-transfer'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  item: LocalClipboardTransferItem
}

export type LocalClipboardTransferAck = {
  version: 1
  type: 'local-clipboard-transfer-ack'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  itemId: string
  status: 'stored' | 'expired' | 'rejected'
}

export type LocalClipboardDirectSender = {
  getValidatedPeerIds(): string[]
  sendLocalClipboardTransfer(remoteDeviceId: string, transfer: LocalClipboardTransfer): boolean
  sendLocalClipboardTransferAck(remoteDeviceId: string, ack: LocalClipboardTransferAck): boolean
}

type TransferListener = (transfer: LocalClipboardTransfer, remoteDeviceId: string) => void
type AckListener = (ack: LocalClipboardTransferAck, remoteDeviceId: string) => void

const transferListenersByRoom = new Map<string, Set<TransferListener>>()
const ackListenersByRoom = new Map<string, Set<AckListener>>()
const directSendersByRoom = new Map<string, LocalClipboardDirectSender>()
const TRANSFER_ID_PATTERN = /^xfr_[a-f0-9]{24}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const MAX_TEXT_LENGTH = 8_000
const MAX_RETENTION_MS = 21_600_000

function randomTransferId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `xfr_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function validTransferItem(value: unknown): value is LocalClipboardTransferItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LocalClipboardTransferItem>
  return typeof item.id === 'string'
    && ITEM_ID_PATTERN.test(item.id)
    && typeof item.text === 'string'
    && item.text.length > 0
    && item.text.length <= MAX_TEXT_LENGTH
    && item.text.trim().length > 0
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) <= MAX_RETENTION_MS
}

export function createLocalClipboardTransfer(
  item: LocalClipboardTransferItem,
  senderDeviceId: string,
  receiverDeviceId: string,
  transferId = randomTransferId(),
): LocalClipboardTransfer {
  const transfer: LocalClipboardTransfer = {
    version: 1,
    type: 'local-clipboard-transfer',
    transferId,
    senderDeviceId,
    receiverDeviceId,
    item: {
      id: item.id,
      text: item.text,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
    },
  }
  if (!validLocalClipboardTransfer(transfer)) throw new Error('Transferencia local inválida')
  if (senderDeviceId === receiverDeviceId) throw new Error('El destino debe ser otro dispositivo')
  return transfer
}

export function createLocalClipboardTransferAck(
  transfer: LocalClipboardTransfer,
  status: LocalClipboardTransferAck['status'],
): LocalClipboardTransferAck {
  return {
    version: 1,
    type: 'local-clipboard-transfer-ack',
    transferId: transfer.transferId,
    senderDeviceId: transfer.senderDeviceId,
    receiverDeviceId: transfer.receiverDeviceId,
    itemId: transfer.item.id,
    status,
  }
}

export function validLocalClipboardTransfer(value: unknown): value is LocalClipboardTransfer {
  if (!value || typeof value !== 'object') return false
  const transfer = value as Partial<LocalClipboardTransfer>
  return transfer.version === 1
    && transfer.type === 'local-clipboard-transfer'
    && typeof transfer.transferId === 'string'
    && TRANSFER_ID_PATTERN.test(transfer.transferId)
    && typeof transfer.senderDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(transfer.senderDeviceId)
    && typeof transfer.receiverDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(transfer.receiverDeviceId)
    && transfer.senderDeviceId !== transfer.receiverDeviceId
    && validTransferItem(transfer.item)
}

export function validLocalClipboardTransferAck(value: unknown): value is LocalClipboardTransferAck {
  if (!value || typeof value !== 'object') return false
  const ack = value as Partial<LocalClipboardTransferAck>
  return ack.version === 1
    && ack.type === 'local-clipboard-transfer-ack'
    && typeof ack.transferId === 'string'
    && TRANSFER_ID_PATTERN.test(ack.transferId)
    && typeof ack.senderDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(ack.senderDeviceId)
    && typeof ack.receiverDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(ack.receiverDeviceId)
    && ack.senderDeviceId !== ack.receiverDeviceId
    && typeof ack.itemId === 'string'
    && ITEM_ID_PATTERN.test(ack.itemId)
    && (ack.status === 'stored' || ack.status === 'expired' || ack.status === 'rejected')
}

export function registerLocalClipboardDirectSender(roomId: string, sender: LocalClipboardDirectSender) {
  directSendersByRoom.set(roomId, sender)
}

export function getLocalClipboardDirectSender(roomId: string) {
  return directSendersByRoom.get(roomId) ?? null
}

export function subscribeLanLocalClipboardTransfers(roomId: string, listener: TransferListener) {
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

export function subscribeLanLocalClipboardTransferAcks(roomId: string, listener: AckListener) {
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

export function publishLanLocalClipboardTransfer(
  roomId: string,
  transfer: LocalClipboardTransfer,
  remoteDeviceId: string,
) {
  for (const listener of transferListenersByRoom.get(roomId) ?? []) listener(transfer, remoteDeviceId)
}

export function publishLanLocalClipboardTransferAck(
  roomId: string,
  ack: LocalClipboardTransferAck,
  remoteDeviceId: string,
) {
  for (const listener of ackListenersByRoom.get(roomId) ?? []) listener(ack, remoteDeviceId)
}
