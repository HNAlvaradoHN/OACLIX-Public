export const CLOUD_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const LOCAL_IMAGE_RETENTION_MS = 6 * 60 * 60 * 1000

const DEVICE_ID_PATTERN = /^dev_[A-Za-z0-9_-]{16,64}$/
const TRANSFER_ID_PATTERN = /^xfr_[a-f0-9]{24}$/
const ITEM_ID_PATTERN = /^itm_[a-f0-9]{32}$/
const SUPPORTED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export type LocalImageTransferItem = {
  id: string
  mimeType: string
  byteSize: number
  base64Data: string
  createdAt: number
  expiresAt: number
}

export type LocalImageTransfer = {
  version: 1
  type: 'local-image-transfer'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  item: LocalImageTransferItem
}

export type LocalImageTransferAck = {
  version: 1
  type: 'local-image-transfer-ack'
  transferId: string
  senderDeviceId: string
  receiverDeviceId: string
  itemId: string
  status: 'stored' | 'expired' | 'rejected'
}

function decodedBase64Length(value: string) {
  if (value.length === 0 || value.length % 4 !== 0) return -1
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

export function validImageBase64(value: string, declaredBytes: number) {
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0 || declaredBytes > CLOUD_IMAGE_MAX_BYTES) return false
  if (value.length > Math.ceil(CLOUD_IMAGE_MAX_BYTES / 3) * 4 + 4) return false
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false
  return decodedBase64Length(value) === declaredBytes
}

export function validLocalImageTransfer(value: unknown): value is LocalImageTransfer {
  if (!value || typeof value !== 'object') return false
  const transfer = value as Partial<LocalImageTransfer>
  const item = transfer.item as Partial<LocalImageTransferItem> | undefined
  return transfer.version === 1
    && transfer.type === 'local-image-transfer'
    && typeof transfer.transferId === 'string'
    && TRANSFER_ID_PATTERN.test(transfer.transferId)
    && typeof transfer.senderDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(transfer.senderDeviceId)
    && typeof transfer.receiverDeviceId === 'string'
    && DEVICE_ID_PATTERN.test(transfer.receiverDeviceId)
    && transfer.senderDeviceId !== transfer.receiverDeviceId
    && Boolean(item)
    && typeof item?.id === 'string'
    && ITEM_ID_PATTERN.test(item.id)
    && typeof item.mimeType === 'string'
    && SUPPORTED_MIME_TYPES.has(item.mimeType)
    && typeof item.byteSize === 'number'
    && typeof item.base64Data === 'string'
    && validImageBase64(item.base64Data, item.byteSize)
    && Number.isSafeInteger(item.createdAt)
    && Number.isSafeInteger(item.expiresAt)
    && Number(item.expiresAt) > Number(item.createdAt)
    && Number(item.expiresAt) - Number(item.createdAt) <= LOCAL_IMAGE_RETENTION_MS
}

export function validLocalImageTransferAck(value: unknown): value is LocalImageTransferAck {
  if (!value || typeof value !== 'object') return false
  const ack = value as Partial<LocalImageTransferAck>
  return ack.version === 1
    && ack.type === 'local-image-transfer-ack'
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

export function createLocalImageTransferAck(
  transfer: LocalImageTransfer,
  status: LocalImageTransferAck['status'],
): LocalImageTransferAck {
  return {
    version: 1,
    type: 'local-image-transfer-ack',
    transferId: transfer.transferId,
    senderDeviceId: transfer.senderDeviceId,
    receiverDeviceId: transfer.receiverDeviceId,
    itemId: transfer.item.id,
    status,
  }
}
