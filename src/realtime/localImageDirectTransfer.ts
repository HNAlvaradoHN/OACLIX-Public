import { LOCAL_IMAGE_RETENTION_MS } from '../shared/localImageTransferCore'

export const DIRECT_IMAGE_CHUNK_BYTES = 64 * 1024

export type LocalImageDirectItem = {
  id: string
  mimeType: string
  byteSize: number
  createdAt: number
  expiresAt: number
}

export type LocalImageDirectTransfer = {
  version: 1
  type: 'local-image-direct-start'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  chunkSize: number
  chunkCount: number
  item: LocalImageDirectItem
}

export type LocalImageDirectTransferAck = {
  version: 1
  type: 'local-image-direct-ack'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  itemId: string
  status: 'stored' | 'expired' | 'rejected'
}

export type LocalImageDirectPayload = {
  transfer: LocalImageDirectTransfer
  blob: Blob
}

export type LocalImageDirectSender = {
  getImageDirectPeerIds(): string[]
  sendLocalImageDirect(remoteDeviceId: string, transfer: LocalImageDirectTransfer, blob: Blob): Promise<boolean>
  sendLocalImageDirectAck(remoteDeviceId: string, ack: LocalImageDirectTransferAck): boolean
}

type TransferListener = (payload: LocalImageDirectPayload, remoteDeviceId: string) => void
type AckListener = (ack: LocalImageDirectTransferAck, remoteDeviceId: string) => void

const transferListenersByRoom = new Map<string, Set<TransferListener>>()
const ackListenersByRoom = new Map<string, Set<AckListener>>()
const directSendersByRoom = new Map<string, LocalImageDirectSender>()
const TRANSFER_ID_PATTERN = /^ixf_[a-f0-9]{24}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function randomTransferId() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `ixf_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
}

function validItem(value: unknown): value is LocalImageDirectItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LocalImageDirectItem>
  return typeof item.id === 'string'
    && ITEM_ID_PATTERN.test(item.id)
    && typeof item.mimeType === 'string'
    && SUPPORTED_MIME_TYPES.has(item.mimeType)
    && Number.isSafeInteger(item.byteSize)
    && Number(item.byteSize) > 0
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) <= LOCAL_IMAGE_RETENTION_MS
}

export function createLocalImageDirectTransfer(
  item: LocalImageDirectItem,
  senderDeviceId: string,
  receiverDeviceId: string,
  transferId = randomTransferId(),
): LocalImageDirectTransfer {
  const transfer: LocalImageDirectTransfer = {
    version: 1,
    type: 'local-image-direct-start',
    transferId,
    senderDeviceId,
    receiverDeviceId,
    chunkSize: DIRECT_IMAGE_CHUNK_BYTES,
    chunkCount: Math.ceil(item.byteSize / DIRECT_IMAGE_CHUNK_BYTES),
    item: { ...item },
  }
  if (!validLocalImageDirectTransfer(transfer)) throw new Error('Transferencia Directo de imagen inválida')
  return transfer
}

export function createLocalImageDirectTransferAck(
  transfer: LocalImageDirectTransfer,
  status: LocalImageDirectTransferAck['status'],
): LocalImageDirectTransferAck {
  return {
    version: 1,
    type: 'local-image-direct-ack',
    transferId: transfer.transferId,
    senderDeviceId: transfer.senderDeviceId,
    receiverDeviceId: transfer.receiverDeviceId,
    itemId: transfer.item.id,
    status,
  }
}

export function validLocalImageDirectTransfer(value: unknown): value is LocalImageDirectTransfer {
  if (!value || typeof value !== 'object') return false
  const transfer = value as Partial<LocalImageDirectTransfer>
  if (transfer.version !== 1
    || transfer.type !== 'local-image-direct-start'
    || typeof transfer.transferId !== 'string'
    || !TRANSFER_ID_PATTERN.test(transfer.transferId)
    || typeof transfer.senderDeviceId !== 'string'
    || !DEVICE_ID_PATTERN.test(transfer.senderDeviceId)
    || typeof transfer.receiverDeviceId !== 'string'
    || !DEVICE_ID_PATTERN.test(transfer.receiverDeviceId)
    || transfer.senderDeviceId === transfer.receiverDeviceId
    || transfer.chunkSize !== DIRECT_IMAGE_CHUNK_BYTES
    || !Number.isSafeInteger(transfer.chunkCount)
    || Number(transfer.chunkCount) <= 0
    || !validItem(transfer.item)) return false

  return transfer.chunkCount === Math.ceil(transfer.item.byteSize / transfer.chunkSize)
}

export function validLocalImageDirectTransferAck(value: unknown): value is LocalImageDirectTransferAck {
  if (!value || typeof value !== 'object') return false
  const ack = value as Partial<LocalImageDirectTransferAck>
  return ack.version === 1
    && ack.type === 'local-image-direct-ack'
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

export function expectedDirectImageChunkBytes(transfer: LocalImageDirectTransfer, chunkIndex: number) {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= transfer.chunkCount) return 0
  if (chunkIndex < transfer.chunkCount - 1) return transfer.chunkSize
  return transfer.item.byteSize - transfer.chunkSize * (transfer.chunkCount - 1)
}

export function registerLocalImageDirectSender(roomId: string, sender: LocalImageDirectSender) {
  directSendersByRoom.set(roomId, sender)
}

export function getLocalImageDirectSender(roomId: string) {
  return directSendersByRoom.get(roomId) ?? null
}

export function subscribeLanLocalImageDirectTransfers(roomId: string, listener: TransferListener) {
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

export function subscribeLanLocalImageDirectTransferAcks(roomId: string, listener: AckListener) {
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

export function publishLanLocalImageDirectTransfer(
  roomId: string,
  payload: LocalImageDirectPayload,
  remoteDeviceId: string,
) {
  for (const listener of transferListenersByRoom.get(roomId) ?? []) listener(payload, remoteDeviceId)
}

export function publishLanLocalImageDirectTransferAck(
  roomId: string,
  ack: LocalImageDirectTransferAck,
  remoteDeviceId: string,
) {
  for (const listener of ackListenersByRoom.get(roomId) ?? []) listener(ack, remoteDeviceId)
}
